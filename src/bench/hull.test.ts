import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liftHull } from './hull.ts';
import type { Mask } from './encodings.ts';

const full = (size: number): Mask =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(true));
const empty = (size: number): Mask =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

test('fully consistent masks lift to a solid with zero loss', () => {
  const { voxels, reprojectionLoss } = liftHull(full(2), full(2), full(2), 2);
  assert.equal(voxels.length, 8);
  assert.deepEqual(reprojectionLoss, { front: 0, side: 0, top: 0 });
});

test('coordinate conventions: one consistent cell lifts to the right voxel', () => {
  // Target voxel (x=1, y=0, z=0):
  const front = empty(2); front[1][1] = true; // row = size-1-y = 1, col = x = 1
  const side = empty(2); side[1][0] = true;   // row 1, col = z = 0
  const top = empty(2); top[1][1] = true;     // row = size-1-z = 1, col = x = 1
  const { voxels, reprojectionLoss } = liftHull(front, side, top, 2);
  assert.deepEqual(voxels, [[1, 0, 0]]);
  assert.deepEqual(reprojectionLoss, { front: 0, side: 0, top: 0 });
});

test('contradictory views produce reprojection loss', () => {
  // Front claims the whole 2x2, but side is empty entirely: nothing lifts.
  const { voxels, reprojectionLoss } = liftHull(full(2), empty(2), full(2), 2);
  assert.equal(voxels.length, 0);
  assert.equal(reprojectionLoss.front, 1);
  assert.equal(reprojectionLoss.top, 1);
  assert.equal(reprojectionLoss.side, 0); // no set cells -> no loss
});

test('partial contradiction yields fractional loss', () => {
  // Side only supports z=0 on the bottom row; front wants both columns on
  // both rows; top only supports the front-left column.
  const front = full(2);
  const side = empty(2); side[1][0] = true;
  const top = empty(2); top[1][0] = true; // z=0, x=0
  const { voxels, reprojectionLoss } = liftHull(front, side, top, 2);
  assert.deepEqual(voxels, [[0, 0, 0]]);
  assert.equal(reprojectionLoss.front, 0.75); // only front[1][0] reproduced
});
