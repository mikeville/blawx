import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from './analyze.ts';
import type { VoxelGrid } from './types.ts';

test('L-shape: one component, touches ground, one unsupported voxel by gravity', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 0, z: 0, color: 'red' },
      { x: 0, y: 1, z: 0, color: 'red' },
      // (1,1,0) has no voxel at (1,0,0) below it, but is connected
      // to (0,1,0) sideways.
      { x: 1, y: 1, z: 0, color: 'red' },
    ],
  };
  const r = analyze(g);
  assert.equal(r.components, 1);
  assert.equal(r.largestComponent, 3);
  assert.equal(r.touchesGround, true);
  assert.equal(r.floatingCount, 1);
});

test('two disconnected piles', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 0, z: 0, color: 'red' },
      { x: 5, y: 0, z: 5, color: 'blue' },
    ],
  };
  const r = analyze(g);
  assert.equal(r.components, 2);
  assert.equal(r.largestComponent, 1);
  assert.equal(r.floatingCount, 0);
  assert.equal(r.touchesGround, true);
});

test('floating voxel with no support below', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 0, z: 0, color: 'red' },
      { x: 3, y: 3, z: 3, color: 'blue' },
    ],
  };
  const r = analyze(g);
  assert.equal(r.components, 2);
  assert.equal(r.floatingCount, 1);
});

test('arch — top connects two columns horizontally, ground touched', () => {
  // Two pillars at x=0 and x=2 going up to y=2, then a bridge voxel at (1,2,0)
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 0, z: 0, color: 'red' },
      { x: 0, y: 1, z: 0, color: 'red' },
      { x: 0, y: 2, z: 0, color: 'red' },
      { x: 1, y: 2, z: 0, color: 'red' },
      { x: 2, y: 2, z: 0, color: 'red' },
      { x: 2, y: 1, z: 0, color: 'red' },
      { x: 2, y: 0, z: 0, color: 'red' },
    ],
  };
  const r = analyze(g);
  assert.equal(r.components, 1);
  assert.equal(r.touchesGround, true);
  // (1,2,0) at y=2 has no voxel at (1,1,0). One unsupported voxel.
  assert.equal(r.floatingCount, 1);
});

test('no voxels at y=0 → does not touch ground', () => {
  const g: VoxelGrid = {
    size: 8,
    voxels: [
      { x: 0, y: 1, z: 0, color: 'red' },
      { x: 0, y: 2, z: 0, color: 'red' },
    ],
  };
  const r = analyze(g);
  assert.equal(r.touchesGround, false);
});
