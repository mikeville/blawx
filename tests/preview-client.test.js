import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewClient } from '../src/preview-client.js';

const raw = id => ({ version: 1, kind: 'voxels', id, cells: [{ x: 0, y: 0, z: 0, color: 'red' }] });

test('preview conversion is shared per model, serialized, and caller cancellation is isolated', async () => {
  const pending = [];
  let active = 0;
  let maximum = 0;
  const converter = { convert: model => new Promise(resolve => {
    active += 1; maximum = Math.max(maximum, active);
    pending.push(() => { active -= 1; resolve({ version: 1, kind: 'bricks', source: model.id }); });
  }) };
  const client = createPreviewClient(converter);
  const firstModel = raw('one');
  const controller = new AbortController();
  const cancelled = client.prepare(firstModel, { signal: controller.signal });
  const shared = client.prepare(firstModel);
  const queued = client.prepare(raw('two'));
  controller.abort();
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  assert.equal(pending.length, 1);
  pending.shift()();
  assert.equal((await shared).source, 'one');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 1);
  pending.shift()();
  assert.equal((await queued).source, 'two');
  assert.equal(maximum, 1);
});

test('preview failure falls back to raw geometry and dispose aborts active work', async () => {
  let observedAbort = false;
  const failing = createPreviewClient({ convert: async () => { throw new Error('failed'); } });
  const source = raw('fallback');
  assert.equal(await failing.prepare(source), source);

  const client = createPreviewClient({ convert: (_model, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => { observedAbort = true; reject(signal.reason); }, { once: true });
  }) });
  const pending = client.prepare(raw('active'));
  client.dispose();
  assert.equal((await pending).kind, 'voxels');
  assert.equal(observedAbort, true);
  assert.equal((await client.prepare(raw('later'))).kind, 'voxels');
});

test('last waiter cancellation removes queued work and evicts active work for retry', async () => {
  const starts = [];
  const finishes = [];
  const converter = { convert: (model, { signal }) => new Promise((resolve, reject) => {
    starts.push(model.id);
    finishes.push(() => resolve({ version: 1, kind: 'bricks', source: model.id }));
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) };
  const client = createPreviewClient(converter);
  const blocker = client.prepare(raw('blocker'));
  const queuedModel = raw('queued');
  const queuedAbort = new AbortController();
  const queued = client.prepare(queuedModel, { signal: queuedAbort.signal });
  queuedAbort.abort();
  await assert.rejects(queued, error => error.name === 'AbortError');
  finishes.shift()();
  await blocker;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(starts, ['blocker']);

  const activeModel = raw('active-retry');
  const activeAbort = new AbortController();
  const cancelled = client.prepare(activeModel, { signal: activeAbort.signal });
  activeAbort.abort();
  await assert.rejects(cancelled, error => error.name === 'AbortError');
  await new Promise(resolve => setImmediate(resolve));
  const retry = client.prepare(activeModel);
  assert.deepEqual(starts, ['blocker', 'active-retry', 'active-retry']);
  finishes.at(-1)();
  assert.equal((await retry).source, 'active-retry');
});
