import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationClient, GenerationClientError } from '../src/generation-client.js';

const model = { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }] };
const success = { requestId: 'request-1', prompt: 'cat', model, sourceProgram: { ops: [] }, diagnostics: {}, metadata: { runtime: 'codex-cli-subscription', generationMs: 1200 } };
const response = (body, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => body });

test('posts a trimmed prompt and preserves the complete generation result', async () => {
  let request;
  const client = createGenerationClient(async (url, options) => { request = { url, ...options }; return response(success); });
  const result = await client.generate('  cat  ');
  assert.equal(request.url, '/api/generate');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.body), { prompt: 'cat' });
  assert.equal(result, success);
});

test('passes AbortSignal to fetch and preserves abort errors for cancellation', async () => {
  const controller = new AbortController();
  const client = createGenerationClient(async (_url, { signal }) => new Promise((_resolve, reject) => {
    assert.equal(signal, controller.signal);
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  }));
  const pending = client.generate('cat', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('surfaces structured HTTP errors with status and request id', async () => {
  const client = createGenerationClient(async () => response({ requestId: 'request-2', error: { code: 'busy', message: 'Another set is being generated.' } }, { ok: false, status: 409 }));
  await assert.rejects(client.generate('cat'), (error) => {
    assert.equal(error.code, 'busy');
    assert.equal(error.status, 409);
    assert.equal(error.requestId, 'request-2');
    assert.match(error.message, /Another set/);
    return true;
  });
});

test('rejects unreadable, incomplete, and invalid-model success responses', async () => {
  const unreadable = createGenerationClient(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }));
  await assert.rejects(unreadable.generate('cat'), { code: 'malformed-response' });

  const incomplete = createGenerationClient(async () => response({ requestId: 'request-1', prompt: 'cat', model }));
  await assert.rejects(incomplete.generate('cat'), { code: 'malformed-response' });

  const invalid = createGenerationClient(async () => response({ ...success, model: { version: 1, kind: 'voxels', cells: [] } }));
  await assert.rejects(invalid.generate('cat'), { code: 'invalid-model' });
});

test('reports network errors and rejects invalid prompts before fetch', async () => {
  let calls = 0;
  const client = createGenerationClient(async () => { calls += 1; throw new TypeError('offline'); });
  await assert.rejects(client.generate('cat'), (error) => error instanceof GenerationClientError && error.code === 'network-error');
  await assert.rejects(client.generate('   '), { code: 'invalid-prompt' });
  await assert.rejects(client.generate('x'.repeat(501)), { code: 'prompt-too-long' });
  assert.equal(calls, 1);
});
