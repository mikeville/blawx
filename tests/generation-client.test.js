import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationClient, createStaticGenerationClient, GenerationClientError } from '../src/generation-client.js';

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

test('accepts a job receipt and polls with short requests until the saved set is ready', async () => {
  const calls = [];
  const responses = [
    response({ requestId: 'request-1', status: 'pending' }, { status: 202 }),
    response({ requestId: 'request-1', status: 'pending' }, { status: 202 }),
    response({ ...success, resultId: 'request-1', cacheHit: false, saveStatus: 'saved' }),
  ];
  const client = createGenerationClient(async (url, options) => {
    calls.push({ url, method: options.method });
    return responses.shift();
  }, '/api/generate', {
    pollIntervalMs: 0,
    statusEndpoint: (requestId) => `/api/generations/${requestId}`,
  });

  const result = await client.generate('cat');
  assert.equal(result.resultId, 'request-1');
  assert.deepEqual(calls, [
    { url: '/api/generate', method: 'POST' },
    { url: '/api/generations/request-1', method: 'GET' },
    { url: '/api/generations/request-1', method: 'GET' },
  ]);
});

test('resumes an accepted job with status GETs and never starts another build', async () => {
  const calls = [];
  const client = createGenerationClient(async (url, options) => {
    calls.push({ url, method: options.method });
    return response({ ...success, resultId: 'request-1', cacheHit: false, saveStatus: 'saved' });
  }, '/api/generate', {
    pollIntervalMs: 0,
    statusEndpoint: (requestId) => `/api/generations/${requestId}`,
  });

  const result = await client.resume('request-1');
  assert.equal(result.resultId, 'request-1');
  assert.deepEqual(calls, [{ url: '/api/generations/request-1', method: 'GET' }]);
});

test('retries a transient unreadable status response without starting another build', async () => {
  let calls = 0;
  const client = createGenerationClient(async () => {
    calls += 1;
    if (calls === 1) return response({ requestId: 'request-1', status: 'pending' }, { status: 202 });
    if (calls === 2) return { ok: false, status: 502, text: async () => '<html>proxy reset</html>' };
    if (calls === 3) return response({ requestId: 'request-1', error: { code: 'status-unavailable', message: 'Temporary.' } }, { ok: false, status: 503 });
    return response(success);
  }, '/api/generate', { pollIntervalMs: 0, statusEndpoint: () => '/api/generations/request-1' });

  assert.equal(await client.generate('cat'), success);
  assert.equal(calls, 4);
});

test('cancelling while polling stops browser checks without changing the accepted job', async () => {
  const controller = new AbortController();
  const client = createGenerationClient(
    async () => response({ requestId: 'request-1', status: 'pending' }, { status: 202 }),
    '/api/generate',
    { pollIntervalMs: 1000, statusEndpoint: () => '/api/generations/request-1' },
  );
  const pending = client.generate('cat', { signal: controller.signal });
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
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

test('accepts public cached results without exposing a private source program', async () => {
  const { sourceProgram: _privateProgram, ...publicResult } = success;
  const cached = { ...publicResult, resultId: 'set-1', cacheHit: true, submittedPrompt: 'CAT', saveStatus: 'saved', metadata: { cacheHit: true } };
  const client = createGenerationClient(async () => response(cached));
  const result = await client.generate('CAT');
  assert.equal(result.resultId, 'set-1');
  assert.equal(result.cacheHit, true);
  assert.equal(result.sourceProgram, undefined);
  assert.equal(result.metadata.generationMs, undefined);
});

test('accepts a usable result when persistence failed, but rejects malformed cache fields', async () => {
  const unsaved = { ...success, sourceProgram: null, resultId: null, cacheHit: false, saveStatus: 'failed' };
  assert.equal(await createGenerationClient(async () => response(unsaved)).generate('cat'), unsaved);
  for (const patch of [{ cacheHit: 'yes' }, { resultId: 123 }, { saveStatus: 'maybe' }, { sourceProgram: [] }]) {
    await assert.rejects(createGenerationClient(async () => response({ ...success, ...patch })).generate('cat'), { code: 'malformed-response' });
  }
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

test('explains a non-JSON platform failure and whether the attempt may count', async () => {
  const client = createGenerationClient(async () => ({
    ok: false,
    status: 502,
    text: async () => '<html>Bad gateway</html>',
  }));
  await assert.rejects(client.generate('pipe organ'), (error) => {
    assert.equal(error.code, 'malformed-response');
    assert.equal(error.status, 502);
    assert.match(error.message, /stopped before it could return/i);
    assert.match(error.message, /may have counted/i);
    return true;
  });
});

test('reports network errors and rejects invalid prompts before fetch', async () => {
  let calls = 0;
  const client = createGenerationClient(async () => { calls += 1; throw new TypeError('offline'); });
  await assert.rejects(client.generate('cat'), (error) => error instanceof GenerationClientError && error.code === 'network-error');
  await assert.rejects(client.generate('   '), { code: 'invalid-prompt' });
  await assert.rejects(client.generate('x'.repeat(281)), { code: 'prompt-too-long' });
  assert.equal(calls, 1);
});

test('static generation is explicitly gated without making a request', async () => {
  await assert.rejects(createStaticGenerationClient().generate('cat'), error => {
    assert.equal(error.code, 'static-demo');
    assert.match(error.message, /saved sets/i);
    assert.match(error.message, /clone the repo/i);
    return true;
  });
});
