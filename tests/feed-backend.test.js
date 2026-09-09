import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createResultStore } from '../server/result-store.js';
import { createCachedGenerationService, createGenerationCacheKey, createGenerationVersion, normalizeCachePrompt } from '../server/cached-generation-service.js';
import { createFeedMiddleware } from '../server/feed-middleware.js';

const model = { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red', private: true }], meta: { id: 'private-receipt', prompt: 'Cat!', usage: { secret: true }, scale: { voxelMm: 8 } } };
const diagnostics = { valid: true };

async function storeFixture() {
  const root = await mkdtemp(join(tmpdir(), 'blawx-feed-'));
  let next = 0;
  return createResultStore({ databasePath: join(root, 'results.sqlite'), id: () => `result-${++next}` });
}

function record(index, overrides = {}) {
  return {
    cacheKey: `key-${index}`, generationVersion: 'v1', normalizedPrompt: `prompt ${index}`,
    options: {}, prompt: `Prompt ${index}`, createdAt: `2026-09-08T00:00:${String(index).padStart(2, '0')}.000Z`,
    model, diagnostics, receiptRef: `private-${index}`, provenance: { method: 'voxel-loft' }, ...overrides,
  };
}

test('SQLite store persists, pages nine stably, strips private metadata, and hidden keys regenerate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-feed-restart-'));
  const databasePath = join(root, 'results.sqlite');
  let next = 0;
  let store = await createResultStore({ databasePath, id: () => `result-${++next}` });
  assert.equal((await stat(root)).mode & 0o777, 0o700);
  assert.equal((await stat(databasePath)).mode & 0o777, 0o600);
  for (let index = 0; index < 11; index += 1) store.saveSuccess(record(index));
  store.close();
  store = await createResultStore({ databasePath, id: () => `result-${++next}` });
  const first = store.listVisible();
  assert.equal(first.items.length, 9);
  assert.ok(first.nextCursor);
  const second = store.listVisible({ cursor: first.nextCursor });
  assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 11);
  const result = store.getVisible(first.items[0].id);
  assert.deepEqual(Object.keys(result).sort(), ['createdAt', 'id', 'model', 'prompt', 'provenance']);
  assert.equal(result.model.meta.usage, undefined);
  assert.equal(result.model.meta.id, undefined);
  assert.equal(result.model.cells[0].private, undefined);
  const hidden = store.findReusable('key-10');
  assert.equal(store.hide(hidden.id), true);
  assert.equal(store.findReusable('key-10'), null);
  const replacement = store.saveSuccess(record(10, { prompt: 'Replacement' }));
  assert.notEqual(replacement.id, hidden.id);
  store.close();
});

test('result database rejects application-tree storage before creating a file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-feed-private-root-'));
  await assert.rejects(
    createResultStore({ sourceRoot: root, databasePath: join(root, 'app-data', 'results.sqlite') }),
    /outside the application source tree/,
  );
});

test('cache identity normalizes only case/whitespace and includes version and options', () => {
  assert.equal(normalizeCachePrompt('  Orange   CAT?! '), 'orange cat?!');
  const base = createGenerationCacheKey({ prompt: ' Orange CAT?! ', generationVersion: 'v1', options: { b: 2, a: 1 } });
  assert.equal(base, createGenerationCacheKey({ prompt: 'orange cat?!', generationVersion: 'v1', options: { a: 1, b: 2 } }));
  assert.notEqual(base, createGenerationCacheKey({ prompt: 'orange cat.', generationVersion: 'v1', options: { a: 1, b: 2 } }));
  assert.notEqual(base, createGenerationCacheKey({ prompt: 'orange cat?!', generationVersion: 'v2', options: { a: 1, b: 2 } }));
  assert.notEqual(base, createGenerationCacheKey({ prompt: 'orange cat?!', generationVersion: 'v1', options: { a: 1, b: 3 } }));
});

test('generation version changes with template, settings, and schema identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'blawx-version-'));
  const templatePath = join(root, 'template.txt');
  await writeFile(templatePath, 'USER PROMPT: old\n');
  const baseline = await createGenerationVersion({ templatePath, settings: { model: 'a' }, schemaVersion: 'one' });
  await writeFile(templatePath, 'changed USER PROMPT: old\n');
  assert.notEqual(await createGenerationVersion({ templatePath, settings: { model: 'a' }, schemaVersion: 'one' }), baseline);
  await writeFile(templatePath, 'USER PROMPT: old\n');
  assert.notEqual(await createGenerationVersion({ templatePath, settings: { model: 'b' }, schemaVersion: 'one' }), baseline);
  assert.notEqual(await createGenerationVersion({ templatePath, settings: { model: 'a' }, schemaVersion: 'two' }), baseline);
});

test('cursor remains stable for equal timestamps, intervening inserts, and hidden rows', async () => {
  const store = await storeFixture();
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    store.saveSuccess(record(id, { id, cacheKey: `same-${id}`, createdAt: '2026-09-08T01:00:00.000Z' }));
  }
  const first = store.listVisible();
  assert.deepEqual(first.items.map(item => item.id), ['j', 'i', 'h', 'g', 'f', 'e', 'd', 'c', 'b']);
  store.saveSuccess(record('z', { id: 'z', cacheKey: 'same-z', createdAt: '2026-09-08T02:00:00.000Z' }));
  store.hide('a');
  const second = store.listVisible({ cursor: first.nextCursor });
  assert.deepEqual(second.items, []);
  store.close();
});

test('same-key callers share generation, retain request IDs, and one cancellation does not abort the survivor', async () => {
  const store = await storeFixture();
  let calls = 0;
  let release;
  let providerAborted = false;
  const generator = { generate: (_prompt, { signal }) => new Promise((resolve, reject) => {
    calls += 1;
    release = () => resolve({ requestId: 'private-run', prompt: 'Cat', model, diagnostics, sourceProgram: { private: true }, metadata: { runtime: 'mock' } });
    signal.addEventListener('abort', () => { providerAborted = true; reject(signal.reason); }, { once: true });
  }) };
  let request = 0;
  const service = createCachedGenerationService({ generator, store, generationVersion: 'v1', id: () => `request-${++request}` });
  const firstAbort = new AbortController();
  const first = service.generate(' cat ', { signal: firstAbort.signal });
  const second = service.generate('CAT');
  firstAbort.abort(new DOMException('gone', 'AbortError'));
  await assert.rejects(first, error => error.name === 'AbortError');
  assert.equal(providerAborted, false);
  release();
  const result = await second;
  assert.equal(calls, 1);
  assert.equal(result.requestId, 'request-2');
  assert.equal(result.resultId, 'result-1');
  assert.equal(result.sourceProgram, undefined);
  const hit = await service.generate('Cat');
  assert.equal(hit.cacheHit, true);
  assert.equal(hit.metadata.generationMs, null);
  assert.equal(calls, 1);
  store.close();
});

test('last detached caller aborts the shared provider and save failure returns an uncached model', async () => {
  let aborted = false;
  const generator = { generate: (_prompt, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
    aborted = true; reject(signal.reason);
  }, { once: true })) };
  const store = { findReusable: () => null, saveSuccess: () => { throw new Error('disk full'); } };
  const service = createCachedGenerationService({ generator, store, generationVersion: 'v1' });
  const controller = new AbortController();
  const pending = service.generate('cat', { signal: controller.signal });
  controller.abort(new DOMException('gone', 'AbortError'));
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(aborted, true);

  const unsavedService = createCachedGenerationService({
    generator: { generate: async () => ({ requestId: 'private', prompt: 'Dog', model, diagnostics, sourceProgram: {}, metadata: {} }) },
    store, generationVersion: 'v1', id: () => 'public',
  });
  const result = await unsavedService.generate('dog');
  assert.equal(result.saveStatus, 'failed');
  assert.equal(result.resultId, null);
  assert.deepEqual(result.model.cells, [{ x: 0, y: 0, z: 0, color: 'red' }]);
  assert.equal(result.model.meta.usage, undefined);
  assert.equal('sourceProgram' in result, false);
});

test('different keys stay busy and invalid successful output is never cached', async () => {
  let release;
  const rows = [];
  const store = {
    findReusable: () => null,
    saveSuccess: row => { rows.push(row); return { id: 'saved', ...row }; },
  };
  const generator = { generate: prompt => prompt === 'invalid'
    ? Promise.resolve({ requestId: 'bad', prompt, model: { version: 1, kind: 'voxels', cells: [] }, diagnostics: {}, metadata: {} })
    : new Promise(resolve => { release = () => resolve({ requestId: 'run', prompt, model, diagnostics, metadata: {} }); }) };
  const service = createCachedGenerationService({ generator, store, generationVersion: 'v1', id: () => 'request' });
  const first = service.generate('cat');
  await assert.rejects(service.generate('dog'), error => error.code === 'busy');
  release();
  await first;
  await assert.rejects(service.generate('invalid'), error => error.code === 'invalid-output');
  assert.equal(rows.length, 1);
});

test('provider failure releases the key for retry', async () => {
  const store = await storeFixture();
  let calls = 0;
  const service = createCachedGenerationService({
    generator: { generate: async prompt => {
      if (++calls === 1) throw new Error('temporary failure');
      return { requestId: 'receipt', prompt, model, diagnostics, metadata: {} };
    } },
    store, generationVersion: 'v1',
  });
  await assert.rejects(service.generate('cat'), /temporary failure/);
  assert.equal((await service.generate('cat')).saveStatus, 'saved');
  assert.equal(calls, 2);
  store.close();
});

test('last cancellation cannot save an ignored-provider success and close rejects new work', async () => {
  const saved = [];
  let finish;
  const store = { findReusable: () => null, saveSuccess: row => { saved.push(row); return { id: 'saved', ...row }; } };
  const service = createCachedGenerationService({
    generator: { generate: () => new Promise(resolve => { finish = () => resolve({ requestId: 'receipt', prompt: 'cat', model, diagnostics, metadata: {} }); }) },
    store, generationVersion: 'v1',
  });
  const controller = new AbortController();
  const pending = service.generate('cat', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  finish();
  await service.close();
  assert.equal(saved.length, 0);
  await assert.rejects(service.generate('cat'), error => error.code === 'unavailable');
});

async function requestMiddleware(store, url, { method = 'GET', headers = {} } = {}) {
  const request = Readable.from([]);
  request.method = method; request.url = url; request.headers = { host: '127.0.0.1:5178', ...headers };
  const response = new EventEmitter();
  response.headers = {}; response.destroyed = false; response.writableEnded = false;
  response.setHeader = (key, value) => { response.headers[key] = value; };
  const finished = new Promise(resolve => { response.end = value => resolve({ status: response.statusCode, body: value ? JSON.parse(value) : null }); });
  createFeedMiddleware(store)(request, response, () => response.end());
  return finished;
}

test('read middleware allowlists exact feed/result routes without invoking generation', async () => {
  const store = await storeFixture();
  const saved = store.saveSuccess(record(1));
  assert.equal((await requestMiddleware(store, '/api/feed')).status, 200);
  const detail = await requestMiddleware(store, `/api/results/${saved.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.receiptRef, undefined);
  assert.equal((await requestMiddleware(store, '/api/feed?extra=1')).status, 400);
  assert.equal((await requestMiddleware(store, '/api/feed?cursor=a&cursor=b')).status, 400);
  assert.equal((await requestMiddleware(store, '/api/feed', { method: 'POST' })).status, 405);
  assert.equal((await requestMiddleware(store, '/api/feed', { headers: { host: 'evil.test' } })).status, 403);
  assert.equal((await requestMiddleware(store, '/api/feed', { headers: { origin: 'https://evil.test' } })).status, 403);
  assert.equal((await requestMiddleware(store, '/api/results/../secret')).status, 404);
  store.hide(saved.id);
  assert.equal((await requestMiddleware(store, `/api/results/${saved.id}`)).status, 404);
  store.close();
});

test('read middleware hides database exception details and passes unrelated routes onward', async () => {
  const failing = {
    listVisible() { throw new Error('/private/results.sqlite exploded'); },
    getVisible() { throw new Error('secret row'); },
  };
  const feed = await requestMiddleware(failing, '/api/feed');
  assert.equal(feed.status, 500);
  assert.doesNotMatch(JSON.stringify(feed.body), /private|sqlite|exploded/i);
  const detail = await requestMiddleware(failing, '/api/results/safe');
  assert.equal(detail.status, 500);
  assert.doesNotMatch(JSON.stringify(detail.body), /secret row/i);
  const unrelated = await requestMiddleware(failing, '/api/other');
  assert.equal(unrelated.status, undefined);
});
