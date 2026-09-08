import assert from 'node:assert/strict';
import test from 'node:test';
import { convertToBricks } from '../src/construction.js';
import { measureBrickDifference } from '../src/construction-differences.js';

const SCALE = { mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 };
const raw = (cells) => ({ version: 1, kind: 'voxels', cells });
const cell = (x, y, z, color = 'red') => ({ x, y, z, color });
const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks, scale = SCALE) => ({ version: 1, kind: 'bricks', bricks, meta: { scale } });

const METRIC_FIELDS = [
  'mappedCellCount',
  'addedVolumeVoxelEquivalent',
  'removedVolumeVoxelEquivalent',
  'recoloredVolumeVoxelEquivalent',
  'relativeVolumeChange',
  'geometryDifferenceRatio',
  'colorDifferenceRatio',
];

test('direct measurement matches existing compact converter metrics', () => {
  const source = raw([cell(2, 2, 4), cell(2, 3, 4)]);
  const converted = convertToBricks({ rawModel: source });
  const beforeRaw = structuredClone(source);
  const beforeBricks = structuredClone(converted.brickModel);
  const measured = measureBrickDifference(source, converted.brickModel);

  for (const field of METRIC_FIELDS) assert.equal(measured[field], converted.metrics[field], field);
  assert.deepEqual(source, beforeRaw);
  assert.deepEqual(converted.brickModel, beforeBricks);
});

test('a post-resampling course can partly restore missing raw volume', () => {
  const result = measureBrickDifference(
    raw([cell(0, 3, 0)]),
    model([brick(0, 2, 0)]),
  );

  assert.equal(result.mappedCellCount, 1);
  assert.equal(result.addedVolumeVoxelEquivalent, 0.6);
  assert.equal(result.removedVolumeVoxelEquivalent, 0.4);
  assert.equal(result.recoloredVolumeVoxelEquivalent, 0);
  assert.ok(Math.abs(result.relativeVolumeChange - 0.2) < Number.EPSILON);
  assert.equal(result.geometryDifferenceRatio, 1);
  assert.deepEqual(result.colorVolumeDeltas, { red: 0.2 });
});

test('geometry outside source occupancy is measured as genuine added volume', () => {
  const result = measureBrickDifference(
    raw([cell(0, 0, 0)]),
    model([brick(0, 0, 0), brick(1, 0, 0)]),
  );

  assert.equal(result.mappedCellCount, 2);
  assert.equal(result.addedVolumeVoxelEquivalent, 1.4);
  assert.equal(result.removedVolumeVoxelEquivalent, 0);
  assert.equal(result.relativeVolumeChange, 1.4);
  assert.equal(result.geometryDifferenceRatio, 1.4);
  assert.deepEqual(result.colorVolumeDeltas, { red: 1.4 });
});

test('color changes are measured only where brick and raw geometry intersect', () => {
  const source = raw([cell(0, 0, 0, 'red'), cell(0, 1, 0, 'blue')]);
  const result = measureBrickDifference(source, model([
    brick(0, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'blue'),
  ]));

  assert.equal(result.addedVolumeVoxelEquivalent, 0.4);
  assert.equal(result.removedVolumeVoxelEquivalent, 0);
  assert.equal(result.recoloredVolumeVoxelEquivalent, 0.2);
  assert.equal(result.colorDifferenceRatio, 0.1);
  assert.deepEqual(result.colorVolumeDeltas, { blue: 0.2, red: 0.2 });
});

test('overlaps, duplicate source cells, malformed coordinates, and other scales fail explicitly', () => {
  const source = raw([cell(0, 0, 0)]);
  assert.throws(() => measureBrickDifference(source, model([
    brick(0, 0, 0, 2, 1),
    brick(1, 0, 0),
  ])), /overlap at stud-course cell/);
  assert.throws(() => measureBrickDifference(raw([cell(0, 0, 0), cell(0, 0, 0)]), model([])), /duplicate position/);
  assert.throws(() => measureBrickDifference(source, model([brick(-1, 0, 0)])), /boundary/);
  assert.throws(() => measureBrickDifference(source, model([], { ...SCALE, coursesPerVoxel: 1 })), /supports only compact scale/);
});
