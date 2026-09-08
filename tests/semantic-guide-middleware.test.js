import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createSemanticGuideMiddleware } from '../server/semantic-guide-middleware.js';
import { SemanticGuideError } from '../server/semantic-guide-service.js';

const fingerprint = 'a'.repeat(64);

async function requestMiddleware(service, {
  method = 'POST',
  headers = {},
  body = '',
  url = '/api/semantic-guide',
} = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = { host: '127.0.0.1:5178', ...headers };
  const response = new EventEmitter();
  response.headers = {};
  response.destroyed = false;
  response.writableEnded = false;
  response.setHeader = (key, value) => { response.headers[key] = value; };
  const finished = new Promise((resolve) => {
    response.end = (value = '') => {
      response.writableEnded = true;
      resolve({ status: response.statusCode, body: value ? JSON.parse(value) : null, headers: response.headers });
    };
  });
  createSemanticGuideMiddleware(service)(request, response, () => response.end());
  return finished;
}

test('HTTP adapter routes GET cache lookup and returns null for a miss without inference', async () => {
  const calls = [];
  const envelope = { annotation: { fingerprint }, metadata: { cacheHit: true } };
  const service = {
    lookup: async (value) => { calls.push(value); return value === fingerprint ? envelope : null; },
    annotate: async () => { throw new Error('must not infer'); },
  };
  const hit = await requestMiddleware(service, { method: 'GET', url: `/api/semantic-guide?fingerprint=${fingerprint}` });
  assert.equal(hit.status, 200);
  assert.deepEqual(hit.body, envelope);
  assert.equal(hit.headers['Cache-Control'], 'no-store');
  const miss = await requestMiddleware(service, { method: 'GET', url: `/api/semantic-guide?fingerprint=${'b'.repeat(64)}` });
  assert.equal(miss.status, 200);
  assert.equal(miss.body, null);
  assert.deepEqual(calls, [fingerprint, 'b'.repeat(64)]);
});

test('HTTP adapter enforces route, method, localhost, same-origin, query, content type, and 2 MiB limit', async () => {
  const service = { lookup: async () => null, annotate: async (body) => ({ body }) };
  assert.equal((await requestMiddleware(service, { url: '/elsewhere' })).status, undefined);
  assert.equal((await requestMiddleware(service, { method: 'DELETE' })).status, 405);
  assert.equal((await requestMiddleware(service, { method: 'GET' })).status, 400);
  assert.equal((await requestMiddleware(service, { method: 'GET', url: `/api/semantic-guide?fingerprint=${fingerprint}&extra=1` })).status, 400);
  assert.equal((await requestMiddleware(service, { headers: { host: 'example.com', 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await requestMiddleware(service, {
    headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}',
  })).status, 403);
  assert.equal((await requestMiddleware(service, { body: '{}' })).status, 415);
  assert.equal((await requestMiddleware(service, {
    headers: { 'content-type': 'application/json', 'content-length': String(2 * 1024 * 1024 + 1) }, body: '{}',
  })).status, 413);
  assert.equal((await requestMiddleware(service, {
    headers: { 'content-type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024 + 1),
  })).status, 413);
  assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: '{' })).status, 400);
});

test('POST delegates strict validation and maps typed failures with sanitized messages', async () => {
  let mode = 'success';
  const service = {
    lookup: async () => null,
    annotate: async (body) => {
      if (mode === 'validation') throw new TypeError('Semantic guide input contains unknown fields.');
      if (mode === 'busy') throw new SemanticGuideError('busy', 'internal busy details');
      if (mode === 'timeout') throw new SemanticGuideError('timeout', 'internal timeout details', '123e4567-e89b-42d3-a456-426614174001');
      if (mode === 'unavailable') throw new SemanticGuideError('unavailable', 'authorization token=secret');
      if (mode === 'unknown') throw new Error('API_KEY=secret');
      return { received: body };
    },
  };
  const options = { headers: { 'content-type': 'application/json; charset=utf-8' }, body: '{"version":1}' };
  assert.deepEqual((await requestMiddleware(service, options)).body, { received: { version: 1 } });
  mode = 'validation';
  assert.equal((await requestMiddleware(service, options)).status, 400);
  mode = 'busy';
  assert.equal((await requestMiddleware(service, options)).status, 409);
  mode = 'timeout';
  const timedOut = await requestMiddleware(service, options);
  assert.equal(timedOut.status, 504);
  assert.equal(timedOut.body.requestId, '123e4567-e89b-42d3-a456-426614174001');
  assert.equal(timedOut.body.error.message, 'Semantic annotation exceeded the 90 second limit.');
  mode = 'unavailable';
  const unavailable = await requestMiddleware(service, options);
  assert.equal(unavailable.status, 503);
  assert.equal(JSON.stringify(unavailable.body).includes('secret'), false);
  mode = 'unknown';
  const unknown = await requestMiddleware(service, options);
  assert.equal(unknown.status, 502);
  assert.deepEqual(unknown.body.error, { code: 'annotator-failed', message: 'Semantic annotator failed.' });
});

test('semantic HTTP errors never echo adversarial validation text or non-UUID request IDs', async () => {
  const sentinel = '/Users/private/project/.env?token=secret';
  const options = { headers: { 'content-type': 'application/json' }, body: '{"version":1}' };
  const response = await requestMiddleware({
    lookup: async () => null,
    annotate: async () => { throw Object.assign(new TypeError(`Semantic guide input is invalid: ${sentinel}`), { requestId: sentinel }); },
  }, options);
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: { code: 'bad-request', message: 'Invalid semantic guide request.' } });
  assert.doesNotMatch(JSON.stringify(response.body), /Users|token|secret/);
});

test('response disconnect aborts the active annotation', async () => {
  let observedAbort = false;
  const service = {
    annotate: (_body, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        observedAbort = true;
        reject(new SemanticGuideError('cancelled', 'cancelled', 'gone'));
      }, { once: true });
    }),
  };
  const request = Readable.from([Buffer.from('{}')]);
  request.method = 'POST';
  request.url = '/api/semantic-guide';
  request.headers = { host: '127.0.0.1:5178', 'content-type': 'application/json' };
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.setHeader = () => {};
  response.end = () => { response.writableEnded = true; };
  const serving = createSemanticGuideMiddleware(service)(request, response, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  response.destroyed = true;
  response.emit('close');
  await serving;
  assert.equal(observedAbort, true);
});
