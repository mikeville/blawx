import { MAX_PROMPT_CHARACTERS } from '../../../src/prompt-policy.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[0-9a-f]{64}$/i;
const TASK_VERSION = 1;
const MAX_TASK_BYTES = 4096;
const SIGNATURE_HEADER = 'x-blawx-worker-signature';
const SIGNATURE_CONTEXT = 'blawx-generation-worker-v1\n';

function validTask(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === 3
    && value.version === TASK_VERSION
    && typeof value.requestId === 'string' && UUID.test(value.requestId)
    && typeof value.prompt === 'string' && value.prompt === value.prompt.trim()
    && value.prompt.length > 0 && Array.from(value.prompt).length <= MAX_PROMPT_CHARACTERS
    && !/\p{Cc}|\p{Cf}/u.test(value.prompt);
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g) ?? [], byte => Number.parseInt(byte, 16));
}

async function signingKey(secret, usage) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('worker_secret_missing');
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usage,
  );
}

export function serializeGenerationTask({ requestId, submittedPrompt }) {
  const task = { version: TASK_VERSION, requestId, prompt: submittedPrompt };
  if (!validTask(task)) throw new Error('worker_task_invalid');
  const body = JSON.stringify(task);
  if (new TextEncoder().encode(body).byteLength > MAX_TASK_BYTES) throw new Error('worker_task_too_large');
  return body;
}

export async function signGenerationTask(body, secret) {
  if (typeof body !== 'string') throw new Error('worker_body_invalid');
  const key = await signingKey(secret, ['sign']);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(SIGNATURE_CONTEXT + body),
  );
  return bytesToHex(signature);
}

export async function parseSignedGenerationTask(request, secret) {
  if (request.method !== 'POST') throw new Error('worker_method_invalid');
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '')) {
    throw new Error('worker_content_type_invalid');
  }
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_TASK_BYTES) throw new Error('worker_task_too_large');
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_TASK_BYTES) throw new Error('worker_task_too_large');
  const supplied = request.headers.get(SIGNATURE_HEADER) ?? '';
  if (!SIGNATURE.test(supplied)) throw new Error('worker_signature_invalid');
  const key = await signingKey(secret, ['verify']);
  const verified = await crypto.subtle.verify(
    'HMAC',
    key,
    hexToBytes(supplied),
    new TextEncoder().encode(SIGNATURE_CONTEXT + body),
  );
  if (!verified) throw new Error('worker_signature_invalid');
  let task;
  try { task = JSON.parse(body); } catch { throw new Error('worker_task_invalid'); }
  if (!validTask(task)) throw new Error('worker_task_invalid');
  return task;
}

export function createBackgroundGenerationDispatcher({
  url,
  secret,
  fetchImpl = fetch,
  timeoutMs = 5_000,
} = {}) {
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('worker_url_invalid'); }
  if (endpoint.protocol !== 'https:' || typeof fetchImpl !== 'function'
      || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('worker_dispatch_invalid');
  }
  return async function dispatch(task) {
    const body = serializeGenerationTask(task);
    const signature = await signGenerationTask(body, secret);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('worker_dispatch_timeout')), timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: signature,
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 202) throw new Error('worker_dispatch_rejected');
    } finally {
      clearTimeout(timer);
    }
  };
}

export const backgroundGenerationTaskConfig = Object.freeze({
  signatureHeader: SIGNATURE_HEADER,
  maxTaskBytes: MAX_TASK_BYTES,
});
