import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, silhouetteToAscii } from './projections.ts';
import { sampleDuck } from './sampleDuck.ts';
import type { VoxelGrid } from './types.ts';

test('single voxel projects to a single cell in each view', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [{ x: 3, y: 5, z: 4, color: 'red' }],
  };
  const p = project(g);
  // front: row 0 = y=7, row 7 = y=0. So y=5 is row 2.
  assert.equal(p.front[2][3], 'red');
  assert.equal(p.front[2][2], null);
  // side: at (z=4, y=5) → row 2, col 4
  assert.equal(p.side[2][4], 'red');
  // top: at (z=4, x=3). Row 0 = z=0, so z=4 is row 4.
  assert.equal(p.top[4][3], 'red');
});

test('overlap along projection axis: outermost voxel wins', () => {
  // Two voxels at same (x, y), different z. Front view (max-z) picks the larger.
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 3, y: 4, z: 2, color: 'blue' },  // back
      { x: 3, y: 4, z: 5, color: 'yellow' }, // front
    ],
  };
  const p = project(g);
  // front view at (x=3, y=4) is row 3 (since y=4 is 7-4=3 rows from top)
  assert.equal(p.front[3][3], 'yellow');
});

test('sample duck silhouettes are self-consistent and recognizable', () => {
  const p = project(sampleDuck);
  // Duck eye is at (4,4,4) in sampleDuck. Front view at (x=4, y=4) → row 3, col 4.
  // Eye is at max-z (z=4 vs (4,4,3) which is also yellow). Color should be black.
  assert.equal(p.front[3][4], 'black');
  // Beak at (5,4,3..4) is red — front view at (x=5, y=4) should be red.
  assert.equal(p.front[3][5], 'red');
  // Body at y=0 spans x=2..5 with yellow voxels — front row 7 (y=0).
  for (let x = 2; x <= 5; x++) assert.equal(p.front[7][x], 'yellow');
  // Top view of beak: at (x=5, z=3), max-y is y=4 (the red beak top), red.
  assert.equal(p.top[3][5], 'red');
  // Top view of body center (x=3, z=3): max-y is y=5 (head top, yellow).
  assert.equal(p.top[3][3], 'yellow');
});

test('silhouetteToAscii produces expected palette letters', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 0, z: 0, color: 'red' },
      { x: 1, y: 0, z: 0, color: 'yellow' },
      { x: 2, y: 0, z: 0, color: 'black' },
    ],
  };
  const p = project(g);
  const front = silhouetteToAscii(p.front);
  // Row 7 (y=0) starts with RYK
  const rows = front.split('\n');
  assert.equal(rows[7].slice(0, 3), 'RYK');
});
