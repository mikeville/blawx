import { validateVoxels } from './voxels.js';
import { appResourcePath } from './app-path.js';
import { MAX_PROMPT_CHARACTERS, PROMPT_TOO_LONG_MESSAGE, promptCharacterCount } from './prompt-policy.js';

export class GenerationClientError extends Error {
  constructor(message, { code = 'generation-failed', status = null, requestId = null, cause } = {}) {
    super(message, { cause });
    this.name = 'GenerationClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const DEFAULT_POLL_INTERVAL_MS = 750;
const DEFAULT_POLL_TIMEOUT_MS = 70_000;

async function readJson(response) {
  try {
    if (typeof response.text === 'function') {
      const text = await response.text();
      return JSON.parse(text);
    }
    return await response.json();
  } catch (cause) {
    const message = response.status >= 500
      ? 'The build service stopped before it could return a result. If generation had already started, this attempt may have counted. Wait a moment before trying again.'
      : 'The build service returned an unreadable response, so no set was loaded.';
    throw new GenerationClientError(message, {
      code: 'malformed-response', status: response.status, cause,
    });
  }
}

function abortableDelay(ms, signal) {
  if (signal?.aborted) return Promise.reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function pendingReceipt(payload, requestId = null) {
  return isRecord(payload)
    && payload.status === 'pending'
    && typeof payload.requestId === 'string'
    && (!requestId || payload.requestId === requestId);
}

function throwHttpError(response, payload) {
  const error = isRecord(payload?.error) ? payload.error : {};
  throw new GenerationClientError(
    typeof error.message === 'string' && error.message.trim() ? error.message : 'The set could not be generated.',
    {
      code: typeof error.code === 'string' ? error.code : 'generation-failed',
      status: response.status,
      requestId: typeof payload?.requestId === 'string' ? payload.requestId : null,
    },
  );
}

function validateResult(response, payload) {
  if (!isRecord(payload) || typeof payload.requestId !== 'string' || typeof payload.prompt !== 'string' || !isRecord(payload.model)
    || (payload.sourceProgram != null && !isRecord(payload.sourceProgram)) || !isRecord(payload.diagnostics) || !isRecord(payload.metadata)
    || (payload.resultId != null && typeof payload.resultId !== 'string')
    || (payload.cacheHit != null && typeof payload.cacheHit !== 'boolean')
    || (payload.saveStatus != null && !['saved', 'failed'].includes(payload.saveStatus))) {
    throw new GenerationClientError('The generator returned an incomplete result.', { code: 'malformed-response', status: response.status });
  }
  const validation = validateVoxels(payload.model);
  if (!validation.valid) {
    throw new GenerationClientError('The generated shape was not safe to preview.', { code: 'invalid-model', status: response.status, requestId: payload.requestId });
  }
  return payload;
}

export function createGenerationClient(
  fetchImpl = fetch,
  endpoint = appResourcePath('api/generate'),
  {
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    statusEndpoint = (requestId) => appResourcePath(`api/generations/${encodeURIComponent(requestId)}`),
    now = () => Date.now(),
  } = {},
) {
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 0
      || !Number.isFinite(pollTimeoutMs) || pollTimeoutMs <= 0
      || typeof statusEndpoint !== 'function' || typeof now !== 'function') {
    throw new TypeError('Invalid generation polling configuration.');
  }
  return {
    async generate(prompt, { signal } = {}) {
      const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
      if (!normalizedPrompt) throw new GenerationClientError('Enter a name for your set.', { code: 'invalid-prompt' });
      if (promptCharacterCount(normalizedPrompt) > MAX_PROMPT_CHARACTERS) {
        throw new GenerationClientError(PROMPT_TOO_LONG_MESSAGE, { code: 'prompt-too-long' });
      }

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: normalizedPrompt }),
          signal,
        });
      } catch (cause) {
        if (cause?.name === 'AbortError') throw cause;
        throw new GenerationClientError('The build service could not be reached. Check your connection and try again.', { code: 'network-error', cause });
      }

      let payload = await readJson(response);
      if (!response.ok) throwHttpError(response, payload);

      if (response.status === 202) {
        if (!pendingReceipt(payload)) {
          throw new GenerationClientError('The build service returned an invalid job receipt.', { code: 'malformed-response', status: response.status });
        }
        const requestId = payload.requestId;
        const deadline = now() + pollTimeoutMs;
        while (true) {
          if (now() >= deadline) {
            throw new GenerationClientError(
              'The build is still taking longer than expected. It may finish and appear in Recently made; wait a moment before trying again.',
              { code: 'generation-status-timeout', status: 504, requestId },
            );
          }
          await abortableDelay(pollIntervalMs, signal);
          try {
            response = await fetchImpl(statusEndpoint(requestId), {
              method: 'GET',
              headers: { accept: 'application/json' },
              signal,
            });
            payload = await readJson(response);
          } catch (cause) {
            if (cause?.name === 'AbortError') throw cause;
            if (now() < deadline) continue;
            throw new GenerationClientError(
              'Blawx could not check whether the build finished. It may still appear in Recently made; wait a moment before trying again.',
              { code: 'generation-status-unavailable', requestId, cause },
            );
          }
          if (response.status === 202) {
            if (!pendingReceipt(payload, requestId)) {
              throw new GenerationClientError('The build service returned an invalid job status.', { code: 'malformed-response', status: response.status, requestId });
            }
            continue;
          }
          if (response.status === 503 && payload?.error?.code === 'status-unavailable' && now() < deadline) {
            continue;
          }
          if (!response.ok) throwHttpError(response, payload);
          break;
        }
      }
      return validateResult(response, payload);
    },
  };
}

export function createStaticGenerationClient() {
  return {
    async generate() {
      throw new GenerationClientError(
        'Live generation is being prepared. Explore the saved sets below, or clone the repo and use your own API key to generate freely.',
        { code: 'static-demo' },
      );
    },
  };
}
