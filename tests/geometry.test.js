import test from 'node:test';
import assert from 'node:assert/strict';
import { compileProgram, packVoxels, validateModel } from '../src/geometry.js';

const model = (bricks) => ({ version: 1, bricks, meta: {} });
const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });

test('validation rejects overlapping bricks', () => {
  const result = validateModel(model([brick(0, 0, 0, 2, 2), brick(1, 0, 1)]));
  assert.equal(result.valid, false);
  assert.equal(result.stats.overlapCount, 1);
});

test('sideways touching bricks are separate components', () => {
  const result = validateModel(model([brick(0, 0, 0), brick(1, 0, 0)]));
  assert.equal(result.valid, true);
  assert.equal(result.stats.componentCount, 2);
  assert.equal(result.stats.groundedComponents, 2);
});

test('a supported bridge is vertically connected to ground', () => {
  const result = validateModel(model([
    brick(0, 0, 0), brick(3, 0, 0), brick(0, 1, 0), brick(3, 1, 0), brick(0, 2, 0, 4, 1),
  ]));
  assert.equal(result.valid, true);
  assert.equal(result.stats.componentCount, 1);
  assert.equal(result.stats.unsupportedBricks, 0);
});

test('an elevated unsupported component is invalid', () => {
  const result = validateModel(model([brick(0, 2, 0)]));
  assert.equal(result.valid, false);
  assert.equal(result.stats.unsupportedBricks, 1);
  assert.match(result.errors[0], /no stud connection to ground/);
});

test('negative x and z coordinates are permitted', () => {
  assert.equal(validateModel(model([brick(-3, 0, -7, 2, 3)])).valid, true);
});

test('validation rejects empty and oversized models before geometry analysis', () => {
  assert.equal(validateModel(model([])).valid, false);
  const oversized = Array.from({ length: 5_001 }, (_, i) => brick(i % 100, 0, Math.floor(i / 100)));
  const result = validateModel(model(oversized));
  assert.equal(result.valid, false);
  assert.match(result.errors[0], /validation limit/);
  assert.equal(result.stats.componentCount, 0);
});

test('unsafe integers and out-of-bounds extents are rejected consistently', () => {
  assert.equal(validateModel(model([brick(Number.MAX_SAFE_INTEGER + 1, 0, 0)])).valid, false);
  assert.equal(validateModel(model([brick(9_999, 0, 0, 2, 1)])).valid, true);
  assert.equal(validateModel(model([brick(10_000, 0, 0, 2, 1)])).valid, false);
  assert.throws(() => packVoxels([{ x: -10_001, y: 0, z: 0, color: 'red' }]), /bounds/);
  assert.throws(() => compileProgram({ operations: [
    { type: 'box', x: 10_000, y: 0, z: 0, w: 2, h: 1, d: 1, color: 'red' },
  ] }), /bounds/);
});

test('compiler rejects huge expansion before iterating it', () => {
  assert.throws(() => compileProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 1_000_000_000, h: 1_000_000_000, d: 1_000_000_000, color: 'red' },
  ] }), /safety limit|bounds/);
});

test('later operations determine voxel color', () => {
  const output = compileProgram({ operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 2, h: 1, d: 1, color: 'red' },
    { type: 'box', x: 1, y: 0, z: 0, w: 1, h: 1, d: 1, color: 'blue' },
  ] });
  assert.deepEqual(output.bricks.map(({ x, color }) => [x, color]), [[0, 'red'], [1, 'blue']]);
});

test('packing conserves every occupied colored cell without overlap', () => {
  const cells = [];
  for (let z = -1; z < 3; z += 1) for (let x = -2; x < 4; x += 1) cells.push({ x, y: 0, z, color: x < 1 ? 'tan' : 'green' });
  const bricks = packVoxels(cells);
  const unpacked = new Map();
  for (const b of bricks) for (let dz = 0; dz < b.d; dz += 1) for (let dx = 0; dx < b.w; dx += 1) {
    const k = `${b.x + dx},${b.y},${b.z + dz}`;
    assert.equal(unpacked.has(k), false, `overlap at ${k}`);
    unpacked.set(k, b.color);
  }
  assert.equal(unpacked.size, cells.length);
  for (const cell of cells) assert.equal(unpacked.get(`${cell.x},${cell.y},${cell.z}`), cell.color);
});

test('packing throws instead of truncating on brick budget overflow', () => {
  assert.throws(() => packVoxels([
    { x: 0, y: 0, z: 0, color: 'red' }, { x: 20, y: 0, z: 0, color: 'red' },
  ], { maxBricks: 1 }), /budget/);
});

test('checks state that catalog, stability, and assembly remain unverified', () => {
  const result = validateModel(model([brick(0, 0, 0)]));
  assert.equal(result.checks.exactPartColorCatalog, false);
  assert.equal(result.checks.physicalStability, false);
  assert.equal(result.checks.assemblySequence, false);
});
