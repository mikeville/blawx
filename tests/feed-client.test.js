import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedClient } from '../src/feed-client.js';
import { createExampleClient } from '../src/example-client.js';
import { createSavedDemoClient } from '../src/demo-client.js';
import { appResourcePath } from '../src/app-path.js';

const model = { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }] };
const publicFields = { createdAt: '2026-09-08T12:00:00.000Z', provenance: { method: 'voxel-loft' } };
const response = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

test('feed client forwards cursors and shares result reads', async () => {
  const calls = [];
  const client = createFeedClient(async url => {
    calls.push(url);
    if (url.startsWith('/api/feed')) return response({ items: [{ id: 'one', prompt: 'cat', ...publicFields }], nextCursor: 'two' });
    return response({ id: 'one', prompt: 'cat', model, ...publicFields });
  });
  assert.equal((await client.list({ cursor: 'a b' })).nextCursor, 'two');
  const [first, second] = await Promise.all([client.getResult('one'), client.getResult('one')]);
  assert.equal(first, second);
  assert.deepEqual(calls, ['/api/feed?cursor=a%20b', '/api/results/one']);
});

test('failed result reads are evicted for retry', async () => {
  let attempts = 0;
  const client = createFeedClient(async () => {
    attempts += 1;
    return attempts === 1 ? response({}, false, 404) : response({ id: 'one', prompt: 'cat', model, ...publicFields });
  });
  await assert.rejects(client.getResult('one'), /no longer available/);
  assert.equal((await client.getResult('one')).id, 'one');
});

test('result cache has a short TTL, isolates caller aborts, validates DTOs, and remember shares results', async () => {
  let clock = 0;
  let calls = 0;
  let release;
  const fetchImpl = async () => {
    calls += 1;
    return new Promise(resolve => { release = () => resolve(response({ id: 'one', prompt: 'cat', model, ...publicFields })); });
  };
  const client = createFeedClient(fetchImpl, '/api', { now: () => clock, resultTtlMs: 10 });
  const controller = new AbortController();
  const cancelled = client.getResult('one', { signal: controller.signal });
  const survivor = client.getResult('one');
  controller.abort();
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  release();
  assert.equal((await survivor).id, 'one');
  assert.equal(calls, 1);
  clock = 11;
  const refreshed = client.getResult('one');
  release();
  await refreshed;
  assert.equal(calls, 2);
  client.remember({ id: 'remembered', prompt: 'dog', model, createdAt: publicFields.createdAt });
  assert.equal((await client.getResult('remembered')).prompt, 'dog');
  assert.throws(() => client.remember({ id: '../bad', prompt: 'bad', model, ...publicFields }), /previewed/);
});

test('invalid and failed payloads never enter the result cache', async () => {
  let calls = 0;
  const client = createFeedClient(async () => {
    calls += 1;
    return response({ id: 'one', prompt: 'cat', model });
  });
  await assert.rejects(client.getResult('one'), /previewed/);
  await assert.rejects(client.getResult('one'), /previewed/);
  assert.equal(calls, 2);
  await assert.rejects(client.list(), /Recent sets/);
});

test('examples remain separate stable ids without invented timestamps', async () => {
  const client = createExampleClient({ generate: async prompt => ({ example: { shape: 43, name: prompt }, model }) });
  const page = await client.list();
  assert.ok(page.items.every(item => item.id.startsWith('example-') && item.createdAt === undefined));
  assert.ok(page.items.every(item => !('title' in item)));
  assert.equal((await client.getResult('example-cat')).id, 'example-cat');
});

test('saved example records resolve root-absolute URLs through the configured app base', async () => {
  const calls = [];
  const saved = createSavedDemoClient(async url => {
    calls.push(url);
    if (url === './examples/index.json') return response([{ shape: 43, url: '/examples/shape-43.json' }]);
    return response(model);
  }, path => appResourcePath(path, './'));
  const result = await saved.generate('cat');
  assert.equal(result.model, model);
  assert.deepEqual(calls, ['./examples/index.json', './examples/shape-43.json']);
});
