import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillInterior, alignBboxes, liftVote } from './maskOps.ts';
import type { Mask } from './encodings.ts';

const empty = (size: number): Mask =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(false));

test('fillInterior fills an outline ring into a solid disc', () => {
  const ring = empty(6);
  for (let c = 1; c <= 4; c++) { ring[1][c] = true; ring[4][c] = true; }
  for (let r = 1; r <= 4; r++) { ring[r][1] = true; ring[r][4] = true; }
  const { mask, filled } = fillInterior(ring);
  assert.equal(filled, 4); // the 2x2 hole at rows/cols 2-3
  for (let r = 1; r <= 4; r++) {
    for (let c = 1; c <= 4; c++) assert.equal(mask[r][c], true);
  }
});

test('fillInterior leaves an open C-shape unchanged', () => {
  const c = empty(6);
  for (let r = 1; r <= 4; r++) c[r][1] = true;
  c[1][2] = true; c[1][3] = true; c[4][2] = true; c[4][3] = true;
  const { mask, filled } = fillInterior(c);
  assert.equal(filled, 0);
  assert.deepEqual(mask, c);
});

test('fillInterior on an all-empty mask changes nothing', () => {
  const m = empty(4);
  const { mask, filled } = fillInterior(m);
  assert.equal(filled, 0);
  assert.deepEqual(mask, m);
});

test('alignBboxes remaps an offset view onto the shared union range', () => {
  const size = 6;
  // front occupies x in [1,2]; top occupies x in [3,4] -> shared range [1,4]
  const front = empty(size);
  for (let r = 0; r < size; r++) { front[r][1] = true; front[r][2] = true; }
  const top = empty(size);
  for (let r = 0; r < size; r++) { top[r][3] = true; top[r][4] = true; }
  const side = empty(size);
  for (let r = 0; r < size; r++) side[r][0] = true;

  const { front: fOut, top: tOut, info } = alignBboxes(front, side, top, size);
  assert.equal(info.remapped.front.x, true);
  assert.equal(info.remapped.top.x, true);
  // both views now occupy the full union range [1,4] on every row
  for (let r = 0; r < size; r++) {
    for (let c = 1; c <= 4; c++) {
      assert.equal(fOut[r][c], true, `front row ${r} col ${c}`);
      assert.equal(tOut[r][c], true, `top row ${r} col ${c}`);
    }
    assert.equal(fOut[r][0], false);
    assert.equal(fOut[r][5], false);
  }
});

test('alignBboxes leaves views untouched when ranges already match', () => {
  const size = 4;
  const front = empty(size);
  front[0][1] = true; front[0][2] = true;
  const side = empty(size);
  side[0][0] = true;
  const top = empty(size);
  top[3][1] = true; top[3][2] = true; // top row = size-1-z, z=0 -> row 3
  const { info } = alignBboxes(front, side, top, size);
  assert.deepEqual(info.remapped.front, {});
  assert.deepEqual(info.remapped.top, {});
});

test('alignBboxes skips the x axis when front is empty on it', () => {
  const size = 4;
  const front = empty(size); // empty everywhere -> no x range, no y range either
  const side = empty(size); // also empty -> no y or z range
  const top = empty(size);
  top[0][1] = true; // z range only (top row 0 -> z = size-1)
  const { front: fOut, side: sOut, top: tOut, info } = alignBboxes(front, side, top, size);
  assert.deepEqual(fOut, front);
  assert.deepEqual(sOut, side);
  assert.deepEqual(tOut, top);
  assert.equal(info.remapped.front.x, undefined);
  assert.equal(info.remapped.top.x, undefined);
  assert.equal(info.remapped.top.z, undefined);
});

test('liftVote: 2-of-3 lifts a voxel that strict intersection would drop', () => {
  const size = 2;
  const full = (): Mask => [[true, true], [true, true]];
  const front = full();
  const side = full();
  const top = empty(size); // top disagrees entirely
  const { voxels, reprojectionLoss } = liftVote(front, side, top, size);
  // front+side alone satisfy the 2-vote threshold at every (x,y,z) — strict
  // liftHull would produce zero voxels here since top never agrees.
  assert.equal(voxels.length, 8);
  assert.equal(reprojectionLoss.top, 0); // top had nothing set, so no loss
  assert.equal(reprojectionLoss.front, 0);
});

test('liftVote drops a voxel only one view supports', () => {
  const size = 2;
  const front = empty(size); front[1][0] = true; // x=0,y=0
  const side = empty(size); // no support
  const top = empty(size); // no support
  const { voxels } = liftVote(front, side, top, size);
  assert.equal(voxels.length, 0);
});
