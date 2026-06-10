import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapToPalette, voxelizeTriangles } from './voxelizeMesh.ts';
import type { Triangle, Vec3 } from './glb.ts';

const RED: [number, number, number] = [0.78, 0.06, 0.18];

/** 12-triangle closed box between two corners. */
function box(min: Vec3, max: Vec3, rgb: [number, number, number] = RED): Triangle[] {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p: Vec3[] = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const quads: [number, number, number, number][] = [
    [0, 1, 2, 3], [5, 4, 7, 6], // z faces
    [4, 0, 3, 7], [1, 5, 6, 2], // x faces
    [4, 5, 1, 0], [3, 2, 6, 7], // y faces
  ];
  const tris: Triangle[] = [];
  for (const [a, b, c, d] of quads) {
    tris.push({ a: p[a], b: p[b], c: p[c], rgb });
    tris.push({ a: p[a], b: p[c], c: p[d], rgb });
  }
  return tris;
}

test('closed cube fills the whole grid solid', () => {
  const { grid, stats } = voxelizeTriangles(box([0, 0, 0], [1, 1, 1]));
  assert.equal(grid.voxels.length, 512);
  assert.ok(stats.interiorFilled > 0, 'hollow interior should be filled');
  // center cell present
  assert.ok(grid.voxels.some(v => v.x === 4 && v.y === 4 && v.z === 4));
});

test('tall thin box occupies a column, grounded at y=0', () => {
  // 1×4×1 world units → longest axis (y) spans the grid.
  const { grid } = voxelizeTriangles(box([0, 0, 0], [1, 4, 1]));
  const ys = new Set(grid.voxels.map(v => v.y));
  assert.equal(Math.min(...ys), 0);
  assert.equal(Math.max(...ys), 7);
  const xs = new Set(grid.voxels.map(v => v.x));
  assert.ok(xs.size <= 3, `thin box should stay thin, got ${xs.size} x-values`);
});

test('floating mesh is shifted to the ground', () => {
  const { grid } = voxelizeTriangles(box([0, 10, 0], [1, 11, 0.2]));
  assert.ok(grid.voxels.some(v => v.y === 0));
});

test('disconnected fragments: only the largest component survives', () => {
  const big = box([0, 0, 0], [4, 4, 4]);
  const crumb = box([9, 0, 9], [9.5, 0.5, 9.5]);
  const { grid, stats } = voxelizeTriangles([...big, ...crumb]);
  assert.ok(stats.droppedCells > 0, 'crumb should be dropped');
  // big box spans 4 of 9.5 world units → about 3-4 cells; nothing near x=7
  assert.ok(grid.voxels.every(v => v.x < 6));
});

test('triangle color survives to the palette snap', () => {
  const { grid } = voxelizeTriangles(box([0, 0, 0], [1, 1, 1], RED));
  assert.ok(grid.voxels.every(v => v.color === 'red'));
});

test('snapToPalette picks sensible colors', () => {
  assert.equal(snapToPalette(1, 1, 1), 'white');
  assert.equal(snapToPalette(0, 0, 0), 'black');
  assert.equal(snapToPalette(0.95, 0.78, 0.05), 'yellow');
  assert.equal(snapToPalette(0.05, 0.25, 0.6), 'blue');
  assert.equal(snapToPalette(0.18, 0.5, 0.2), 'green');
});

test('empty input yields an empty grid', () => {
  const { grid } = voxelizeTriangles([]);
  assert.equal(grid.voxels.length, 0);
});
