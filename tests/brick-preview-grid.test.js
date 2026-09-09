import assert from 'node:assert/strict';
import test from 'node:test';
import { brickPreviewData } from '../src/brick-preview.js';
import { createStudRenderSettings } from '../src/stud-appearance.js';

const SCALE = { studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 };

function modelWithAdjacentBricks() {
  return {
    meta: { scale: SCALE },
    bricks: [
      { id: 'wide', x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
      { id: 'x-neighbor', x: 2, y: 0, z: 0, w: 1, d: 2, color: 'blue' },
      { id: 'z-neighbor', x: 0, y: 0, z: 1, w: 1, d: 2, color: 'green' },
    ],
  };
}

function studFor(studs, id, x, z) {
  return studs.find((stud) => stud.id === id && stud.x === x && stud.z === z);
}

test('adjacent differently sized bricks share the regular 8 mm stud grid across x and z edges', () => {
  const { studs } = brickPreviewData(modelWithAdjacentBricks());
  const edgeStud = studFor(studs, 'wide', 1.5, 0.5);
  const acrossX = studFor(studs, 'x-neighbor', 2.5, 0.5);
  const acrossZ = studFor(studs, 'z-neighbor', 0.5, 1.5);
  const zOrigin = studFor(studs, 'wide', 0.5, 0.5);
  const xNeighborNext = studFor(studs, 'x-neighbor', 2.5, 1.5);

  assert.ok(edgeStud && acrossX && acrossZ && zOrigin && xNeighborNext);
  assert.equal((edgeStud.x - zOrigin.x) * SCALE.voxelMm, 8, 'within a wide brick on x');
  assert.equal((xNeighborNext.z - acrossX.z) * SCALE.voxelMm, 8, 'within a deep brick on z');
  assert.equal((acrossX.x - edgeStud.x) * SCALE.voxelMm, 8);
  assert.equal((acrossZ.z - zOrigin.z) * SCALE.voxelMm, 8);
});

test('brick bodies leave a 3.9 mm exterior inset to stud centers and a 0.2 mm seam', () => {
  const { bodies, studs } = brickPreviewData(modelWithAdjacentBricks());
  const wide = bodies.find((body) => body.id === 'wide');
  const xNeighbor = bodies.find((body) => body.id === 'x-neighbor');
  const zNeighbor = bodies.find((body) => body.id === 'z-neighbor');
  const firstStud = studFor(studs, 'wide', 0.5, 0.5);

  const wideLeft = wide.x - wide.w / 2;
  const wideRight = wide.x + wide.w / 2;
  const wideBack = wide.z + wide.d / 2;
  const neighborLeft = xNeighbor.x - xNeighbor.w / 2;
  const neighborFront = zNeighbor.z - zNeighbor.d / 2;

  assert.ok(Math.abs((firstStud.x - wideLeft) * SCALE.voxelMm - 3.9) < 1e-12);
  assert.ok(Math.abs((firstStud.z - (wide.z - wide.d / 2)) * SCALE.voxelMm - 3.9) < 1e-12);
  assert.ok(Math.abs((neighborLeft - wideRight) * SCALE.voxelMm - 0.2) < 1e-12);
  assert.ok(Math.abs((neighborFront - wideBack) * SCALE.voxelMm - 0.2) < 1e-12);
});

test('89% diameter and 50% height preserve every stud x/z grid position', () => {
  const { studs } = brickPreviewData(modelWithAdjacentBricks());
  const rendered = createStudRenderSettings(studs, SCALE.voxelMm, { diameter: 0.89, height: 0.5 });

  assert.equal(rendered.appearance.diameter, 0.89);
  assert.equal(rendered.appearance.height, 0.5);
  assert.deepEqual(
    rendered.studs.map(({ x, z }) => ({ x, z })),
    studs.map(({ x, z }) => ({ x, z })),
  );
});
