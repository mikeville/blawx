import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packLayer } from './pack.ts';
import type { Voxel } from './types.ts';

const Y = 0;
const v = (x: number, z: number, color: Voxel['color'] = 'yellow'): Voxel => ({ x, y: Y, z, color });

test('single voxel packs as one 1x1', () => {
  const out = packLayer([v(3, 4)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { x: 3, y: 0, z: 4, w: 1, d: 1, color: 'yellow' });
});

test('2x2 same-color cluster packs as one 2x2', () => {
  const out = packLayer([v(0, 0), v(1, 0), v(0, 1), v(1, 1)]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0], { x: 0, y: 0, z: 0, w: 2, d: 2, color: 'yellow' });
});

test('mixed-color 2x2 cluster stays four 1x1', () => {
  const out = packLayer([v(0, 0, 'yellow'), v(1, 0, 'red'), v(0, 1, 'yellow'), v(1, 1, 'yellow')]);
  assert.equal(out.length, 4);
  assert.ok(out.every(b => b.w === 1 && b.d === 1));
});

test('L-shape: three voxels => three 1x1 (no 2x2 possible)', () => {
  const out = packLayer([v(0, 0), v(1, 0), v(0, 1)]);
  assert.equal(out.length, 3);
  assert.ok(out.every(b => b.w === 1 && b.d === 1));
});

test('2x4 cluster packs into two 2x2 (deterministic top-left scan)', () => {
  const out = packLayer([
    v(0, 0), v(1, 0), v(0, 1), v(1, 1),
    v(2, 0), v(3, 0), v(2, 1), v(3, 1),
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.w, 2);
  assert.equal(out[1]!.w, 2);
  assert.equal(out[0]!.x, 0);
  assert.equal(out[1]!.x, 2);
});

test('3x3 cluster: one 2x2 in corner + five 1x1 fill', () => {
  const out = packLayer([
    v(0, 0), v(1, 0), v(2, 0),
    v(0, 1), v(1, 1), v(2, 1),
    v(0, 2), v(1, 2), v(2, 2),
  ]);
  const twoByTwos = out.filter(b => b.w === 2 && b.d === 2);
  const ones = out.filter(b => b.w === 1 && b.d === 1);
  assert.equal(twoByTwos.length, 1);
  assert.equal(ones.length, 5);
});
