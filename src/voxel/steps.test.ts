import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSteps, STEP_BRICK_CAP } from './steps.ts';
import { GRID_SIZE } from './types.ts';
import type { Voxel, VoxelGrid } from './types.ts';

function gridOf(voxels: Voxel[]): VoxelGrid {
  return { size: GRID_SIZE, voxels };
}

test('empty layer is skipped', () => {
  const steps = buildSteps(gridOf([
    { x: 0, y: 0, z: 0, color: 'yellow' },
    { x: 0, y: 3, z: 0, color: 'yellow' },
  ]));
  assert.equal(steps.length, 2);
  assert.equal(steps[0]!.newBricks[0]!.y, 0);
  assert.equal(steps[1]!.newBricks[0]!.y, 3);
});

test('cumulative grows monotonically', () => {
  const steps = buildSteps(gridOf([
    { x: 0, y: 0, z: 0, color: 'yellow' },
    { x: 0, y: 1, z: 0, color: 'red' },
    { x: 1, y: 2, z: 0, color: 'blue' },
  ]));
  assert.equal(steps.length, 3);
  assert.equal(steps[0]!.cumulativeBricks.length, 0);
  assert.equal(steps[1]!.cumulativeBricks.length, 1);
  assert.equal(steps[2]!.cumulativeBricks.length, 2);
});

test('dense layer over cap splits into multiple steps', () => {
  const voxels: Voxel[] = [];
  for (let x = 0; x < 8; x++) {
    voxels.push({ x, y: 0, z: 0, color: 'red' });
    voxels.push({ x, y: 0, z: 1, color: 'green' });
  }
  const steps = buildSteps(gridOf(voxels));
  assert.ok(steps.length >= 2);
  for (const s of steps) {
    assert.ok(s.newBricks.length <= STEP_BRICK_CAP, `step has ${s.newBricks.length} > cap ${STEP_BRICK_CAP}`);
  }
});
