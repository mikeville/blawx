import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstructionClient } from '../src/construction-client.js';
import {
  CONSTRUCTION_PIPELINE_VERSION,
  createConstructionCache,
  createConstructionCacheKey,
} from '../src/construction-cache.js';
import { brickPreviewData } from '../src/brick-preview.js';

function fakeWorker() {
  return { terminated: false, postMessage(input) { this.input = input; }, terminate() { this.terminated = true; } };
}
test('conversion worker returns independent derived output and terminates', async () => {
  const worker = fakeWorker();
  const input = { rawModel: { cells: [] }, adjustments: false };
  const pending = createConstructionClient(() => worker).convert(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.input, input);
  worker.onmessage({ data: { result: { brickModel: { bricks: [] } } } });
  assert.deepEqual(await pending, { brickModel: { bricks: [] } });
  assert.ok(worker.terminated);
});
test('cancellation terminates active conversion and pre-abort never starts work', async () => {
  const worker = fakeWorker();
  const controller = new AbortController();
  const client = createConstructionClient(() => worker);
  const pending = client.convert({}, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(worker.terminated);
  await assert.rejects(createConstructionClient(() => { throw new Error('Must not launch'); }).convert({}, { signal: controller.signal }), { name: 'AbortError' });
});
test('worker conversion errors and deadlines terminate without a retry', async () => {
  const worker = fakeWorker();
  const pending = createConstructionClient(() => worker).convert({});
  await new Promise(resolve => setImmediate(resolve));
  worker.onmessage({ data: { error: 'Too much geometry' } });
  await assert.rejects(pending, /Too much geometry/);
  assert.ok(worker.terminated);
  const slow = fakeWorker();
  await assert.rejects(createConstructionClient(() => slow, 5).convert({}), /local limit/);
  assert.ok(slow.terminated);
});

function result(label) {
  const plan = { operations: [{ id: label }] };
  return {
    brickModel: { bricks: [{ x: 0, y: 0, z: 0, w: 2, d: 4, color: label }] },
    guide: { sections: [{ name: label, steps: [1] }] },
    assemblyPlan: plan,
    instructionPlan: plan,
    diagnostics: { label },
  };
}

function completingWorker(value, count) {
  return () => {
    count.value += 1;
    const worker = fakeWorker();
    worker.postMessage = input => {
      worker.input = input;
      queueMicrotask(() => worker.onmessage({ data: { result: value } }));
    };
    return worker;
  };
}

function persistentStorage(initial = []) {
  const records = new Map(initial);
  return {
    records,
    async get(key) { return structuredClone(records.get(key)); },
    async set(key, entry) { records.set(key, structuredClone(entry)); },
    async delete(key) { records.delete(key); },
    async prune(maxEntries) {
      const oldest = [...records.values()].sort((a, b) => a.accessedAt - b.accessedAt);
      for (const entry of oldest.slice(0, Math.max(0, records.size - maxEntries))) records.delete(entry.key);
    },
  };
}

test('successful full results hit memory without launching another worker', async () => {
  const count = { value: 0 };
  const expected = result('cached');
  const cache = createConstructionCache({ storage: null });
  const client = createConstructionClient(completingWorker(expected, count), 60_000, { cache });
  const input = { rawModel: { cells: [[0, 0, 0, 'red']] }, sourceProgram: { ops: [] }, adjustments: true };
  assert.deepEqual(await client.convert(input), expected);
  assert.deepEqual(await client.convert(input), expected);
  assert.equal(count.value, 1);
});

test('a new client instance restores the full result from persistent storage', async () => {
  const storage = persistentStorage();
  const firstCount = { value: 0 };
  const expected = result('persisted');
  const input = { rawModel: { cells: [[1, 2, 3, 'blue']] }, sourceProgram: { ops: [['box']] }, adjustments: true };
  const first = createConstructionClient(completingWorker(expected, firstCount), 60_000, {
    cache: createConstructionCache({ storage }),
  });
  assert.deepEqual(await first.convert(input), expected);
  await new Promise(resolve => setImmediate(resolve));

  const second = createConstructionClient(() => { throw new Error('cache miss'); }, 60_000, {
    cache: createConstructionCache({ storage }),
  });
  assert.deepEqual(await second.convert(input), expected);
  assert.equal(firstCount.value, 1);
});

test('cache keys cover raw geometry, source program, conversion options, and pipeline version', () => {
  const base = { rawModel: { cells: [[0, 0, 0, 'red']] }, sourceProgram: { ops: [] }, adjustments: false };
  const key = createConstructionCacheKey(base, 'pipeline-a');
  assert.equal(key, createConstructionCacheKey({ adjustments: false, sourceProgram: { ops: [] }, rawModel: { cells: [[0, 0, 0, 'red']] } }, 'pipeline-a'));
  assert.notEqual(key, createConstructionCacheKey({ ...base, rawModel: { cells: [[1, 0, 0, 'red']] } }, 'pipeline-a'));
  assert.notEqual(key, createConstructionCacheKey({ ...base, sourceProgram: { ops: [['box']] } }, 'pipeline-a'));
  assert.notEqual(key, createConstructionCacheKey({ ...base, adjustments: true }, 'pipeline-a'));
  assert.notEqual(key, createConstructionCacheKey({ ...base, scaleMode: 'compact' }, 'pipeline-a'));
  assert.notEqual(key, createConstructionCacheKey(base, 'pipeline-b'));
});

test('cancelled and failed worker results are not cached', async () => {
  const writes = [];
  const cache = { async get() {}, async set(key, value) { writes.push([key, value]); } };
  const cancelledWorker = fakeWorker();
  const controller = new AbortController();
  const cancelledPending = createConstructionClient(() => cancelledWorker, 60_000, { cache }).convert({ rawModel: {} }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort();
  await assert.rejects(cancelledPending, { name: 'AbortError' });

  const failedWorker = fakeWorker();
  const failedPending = createConstructionClient(() => failedWorker, 60_000, { cache }).convert({ rawModel: { cells: [] } });
  await new Promise(resolve => setImmediate(resolve));
  failedWorker.onmessage({ data: { error: 'bad construction' } });
  await assert.rejects(failedPending, /bad construction/);
  assert.deepEqual(writes, []);
});

test('corrupt and unavailable persistent storage degrade to worker conversion', async () => {
  let deleted = false;
  const corruptStorage = {
    async get(key) { return { key, schemaVersion: 1, pipelineVersion: CONSTRUCTION_PIPELINE_VERSION, value: { brickModel: { bricks: [] } } }; },
    async set() {},
    async delete() { deleted = true; },
    async prune() {},
  };
  const corruptCount = { value: 0 };
  const repaired = result('recomputed');
  const corruptClient = createConstructionClient(completingWorker(repaired, corruptCount), 60_000, {
    cache: createConstructionCache({ storage: corruptStorage }),
  });
  assert.deepEqual(await corruptClient.convert({ rawModel: { cells: [] } }), repaired);
  assert.equal(corruptCount.value, 1);
  assert.equal(deleted, true);

  const unavailableCount = { value: 0 };
  const unavailableCache = createConstructionCache({ storage: {
    async get() { throw new Error('IndexedDB unavailable'); },
    async set() { throw new Error('quota'); },
    async delete() {},
    async prune() {},
  } });
  assert.deepEqual(await createConstructionClient(completingWorker(repaired, unavailableCount), 60_000, { cache: unavailableCache }).convert({ rawModel: { cells: [1] } }), repaired);
  assert.equal(unavailableCount.value, 1);
});

test('invalid cache bounds fall back to safe finite limits', async () => {
  const cache = createConstructionCache({ storage: null, maxMemoryEntries: -1 });
  await cache.set('one', result('one'));
  assert.deepEqual(await cache.get('one'), result('one'));
});

test('persistent cache evicts its oldest entries at the configured bound', async () => {
  const storage = persistentStorage();
  const cache = createConstructionCache({ storage, maxMemoryEntries: 1, maxPersistentEntries: 2 });
  await cache.set('one', result('one'));
  await new Promise(resolve => setTimeout(resolve, 2));
  await cache.set('two', result('two'));
  await new Promise(resolve => setTimeout(resolve, 2));
  await cache.set('three', result('three'));
  assert.equal(storage.records.size, 2);
  assert.equal(storage.records.has('one'), false);
  assert.equal(storage.records.has('two'), true);
  assert.equal(storage.records.has('three'), true);
});
test('preview preserves physical proportions and hides engaged studs', () => {
  const model = { bricks: [
    { x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
    { x: 0, y: 1, z: 0, w: 1, d: 1, color: 'blue' },
  ] };
  const { bodies, studs } = brickPreviewData(model);
  assert.equal(bodies[0].x, 1);
  assert.equal(bodies[0].h, 9.52/8);
  assert.equal(bodies[0].w, 15.8/8);
  assert.ok(Math.abs(bodies[1].y - bodies[0].y - 1.2) < 1e-12);
  assert.equal(studs.length, 2);
  assert.equal(studs.filter(s => s.color === 'red').length, 1);
  assert.equal(studs.filter(s => s.color === 'blue').length, 1);
});

test('compact preview uses physical courses without multiplying the entire source height', () => {
  const { bodies, studs } = brickPreviewData({ meta: { scale: { studsPerVoxel: 1, coursesPerVoxel: 5/6, voxelMm: 8 } }, bricks: [
    { x: 2, y: 3, z: 4, w: 2, d: 4, color: 'red' },
  ] });
  assert.equal(bodies[0].x, 3);
  assert.equal(bodies[0].y, 3.5 / (5/6));
  assert.equal(bodies[0].w, 15.8 / 8);
  assert.equal(bodies[0].d, 31.8 / 8);
  assert.equal(studs[0].y, 4 / (5/6) + .9 / 8);
  assert.equal(studs.length, 8);
});
