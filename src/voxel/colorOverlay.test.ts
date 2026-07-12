import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overlayRows, overlayToBricks, colorGridWithOverlay, LETTER_COLOR } from './colorOverlay.ts';
import type { VoxelGrid } from './types.ts';

const EMPTY_16 = '.'.repeat(256);

function withCell(base: string, r: number, c: number, letter: string, size = 16): string {
  const i = r * size + c;
  return base.slice(0, i) + letter + base.slice(i + 1);
}

test('overlayRows: wrong length is rejected', () => {
  assert.equal(overlayRows('.'.repeat(255)), null);
  assert.equal(overlayRows('.'.repeat(257)), null);
});

test('overlayRows: an out-of-legend character is rejected', () => {
  assert.equal(overlayRows(withCell(EMPTY_16, 0, 0, 'Z')), null);
});

test('overlayRows: a well-formed overlay splits into 16 rows of 16', () => {
  const rows = overlayRows(withCell(EMPTY_16, 5, 5, 'R'));
  assert.ok(rows);
  assert.equal(rows!.length, 16);
  assert.ok(rows!.every((row) => row.length === 16));
  assert.equal(rows![5]![5], 'R');
});

test('overlayToBricks: malformed input yields no bricks', () => {
  assert.deepEqual(overlayToBricks('.'.repeat(10)), []);
});

test('overlayToBricks: a letter at row r, col c maps to x=c, y=15-r, z=0 with the legend color', () => {
  const overlay = withCell(EMPTY_16, 2, 3, 'R');
  const bricks = overlayToBricks(overlay);
  assert.equal(bricks.length, 1);
  const b = bricks[0]!;
  assert.equal(b.x, 3);
  assert.equal(b.y, 15 - 2);
  assert.equal(b.z, 0);
  assert.equal(b.color, LETTER_COLOR['R']);
  assert.equal(b.color, 'red');
});

test('overlayToBricks: an empty overlay yields no bricks', () => {
  assert.deepEqual(overlayToBricks(EMPTY_16), []);
});

test('colorGridWithOverlay: recolors from the legend letter at the mirrored row', () => {
  const grid: VoxelGrid = {
    size: 16,
    voxels: [{ x: 3, y: 13, z: 0, color: 'lightGray' }],
  };
  const rows = overlayRows(withCell(EMPTY_16, 2, 3, 'B'))!;
  const out = colorGridWithOverlay(grid, rows, 'lightGray');
  assert.equal(out.voxels[0]!.color, 'blue');
  // Geometry is untouched.
  assert.equal(out.voxels[0]!.x, 3);
  assert.equal(out.voxels[0]!.y, 13);
});

test('colorGridWithOverlay: falls back when the mirrored cell is not a legend letter', () => {
  const grid: VoxelGrid = {
    size: 16,
    voxels: [{ x: 0, y: 0, z: 0, color: 'yellow' }],
  };
  const rows = overlayRows(EMPTY_16)!;
  const out = colorGridWithOverlay(grid, rows, 'tan');
  assert.equal(out.voxels[0]!.color, 'tan');
});

test('colorGridWithOverlay: falls back when the voxel is outside the overlay bounds', () => {
  const grid: VoxelGrid = {
    size: 16,
    voxels: [{ x: 0, y: 0, z: 0, color: 'yellow' }],
  };
  // Only 2 rows supplied — every real voxel's mirrored row is out of range.
  const shortRows = ['R'.repeat(16), '.'.repeat(16)];
  const out = colorGridWithOverlay(grid, shortRows, 'brown');
  assert.equal(out.voxels[0]!.color, 'brown');
});
