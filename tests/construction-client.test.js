import test from 'node:test';
import assert from 'node:assert/strict';
import { createConstructionClient } from '../src/construction-client.js';
import { brickPreviewData } from '../src/brick-preview.js';

function fakeWorker() {
  return { terminated: false, postMessage(input) { this.input = input; }, terminate() { this.terminated = true; } };
}
test('conversion worker returns independent derived output and terminates', async () => {
  const worker = fakeWorker();
  const input = { rawModel: { cells: [] }, adjustments: false };
  const pending = createConstructionClient(() => worker).convert(input);
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
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(worker.terminated);
  await assert.rejects(createConstructionClient(() => { throw new Error('Must not launch'); }).convert({}, { signal: controller.signal }), { name: 'AbortError' });
});
test('worker conversion errors and deadlines terminate without a retry', async () => {
  const worker = fakeWorker();
  const pending = createConstructionClient(() => worker).convert({});
  worker.onmessage({ data: { error: 'Too much geometry' } });
  await assert.rejects(pending, /Too much geometry/);
  assert.ok(worker.terminated);
  const slow = fakeWorker();
  await assert.rejects(createConstructionClient(() => slow, 5).convert({}), /local limit/);
  assert.ok(slow.terminated);
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
