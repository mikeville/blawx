import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertToBricks, inspectConstruction } from '../src/construction.js';
import { FOOTPRINTS } from '../src/geometry.js';

const raw = (cells, meta = {}) => ({ version: 1, kind: 'voxels', cells, meta });
const cell = (x, y, z, color = 'red') => ({ x, y, z, color });
const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function expandedBrickCells(bricks) {
  const cells = new Map();
  for (const item of bricks) for (let dz = 0; dz < item.d; dz += 1) for (let dx = 0; dx < item.w; dx += 1) {
    const key = `${item.x + dx},${item.y},${item.z + dz}`;
    assert.equal(cells.has(key), false, `unexpected collision at ${key}`);
    cells.set(key, item.color);
  }
  return cells;
}

function expectedCompactCells(cells) {
  const expected = new Map();
  for (const item of cells) {
    const startY = Math.round(item.y * 5 / 6);
    const endY = Math.round((item.y + 1) * 5 / 6);
    for (let y = startY; y < endY; y += 1) expected.set(`${item.x},${y},${item.z}`, item.color);
  }
  return expected;
}

test('converter maps source voxels to one stud with rounded five-sixths course boundaries', () => {
  const sourceCells = [cell(2, 2, 4), cell(2, 3, 4)];
  const result = convertToBricks({ rawModel: raw(sourceCells) });
  assert.deepEqual(result.metrics.scale, { mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 });
  assert.equal(result.brickModel.kind, 'bricks');
  const occupied = expandedBrickCells(result.brickModel.bricks);
  assert.deepEqual(occupied, expectedCompactCells(sourceCells));
  assert.equal(result.metrics.addedVolumeVoxelEquivalent, 0);
  assert.equal(result.metrics.removedVolumeVoxelEquivalent, 0.8);
  assert.equal(result.metrics.recoloredVolumeVoxelEquivalent, 0);
});

test('baseline conversion preserves source geometry, colors, metadata, and input object', () => {
  const source = raw([
    cell(0, 0, 0, 'red'),
    cell(1, 0, 0, 'blue'),
    cell(0, 1, 0, 'yellow'),
  ], { prompt: 'primary stack' });
  const before = structuredClone(source);
  const result = convertToBricks({ rawModel: source, sourceProgram: { ops: [] } });
  assert.deepEqual(source, before);
  assert.deepEqual(expandedBrickCells(result.brickModel.bricks), expectedCompactCells(source.cells));
  assert.deepEqual(result.brickModel.meta.sourceMeta, { prompt: 'primary stack' });
  assert.equal(result.brickModel.meta.sourceProgramAvailable, true);
  assert.deepEqual(result.adjustments, []);
  assert.equal(result.metrics.assemblyFeedback, null);
  assert.equal(Object.hasOwn(result, 'assemblyPlan'), false);
});

test('packing is deterministic and uses only ordinary declared footprints', () => {
  const source = raw([
    cell(0, 0, 0), cell(1, 0, 0), cell(0, 1, 0), cell(1, 1, 0),
  ]);
  const first = convertToBricks({ rawModel: source }).brickModel.bricks;
  const second = convertToBricks({ rawModel: structuredClone(source) }).brickModel.bricks;
  assert.deepEqual(first, second);
  const legal = new Set(FOOTPRINTS.map(({ w, d }) => `${w}x${d}`));
  assert.equal(first.every(({ w, d }) => legal.has(`${w}x${d}`)), true);
});

test('interlock-aware compact packing crosses seams on successive courses', () => {
  const cells = [];
  for (let y = 0; y < 2; y += 1) for (let z = 0; z < 4; z += 1) for (let x = 0; x < 4; x += 1) cells.push(cell(x, y, z));
  const result = convertToBricks({ rawModel: raw(cells) });
  assert.equal(result.diagnostics.stats.componentCount, 1);
  assert.ok(result.diagnostics.stats.bridgingBrickCount >= 2);
  assert.ok((result.metrics.partHistogram['2x2'] ?? 0) + (result.metrics.partHistogram['2x4'] ?? 0)
    > (result.metrics.partHistogram['1x4'] ?? 0) + (result.metrics.partHistogram['2x3'] ?? 0));
  assert.equal(result.brickModel.bricks.every(({ w, d }) => Math.max(w, d) <= 4), true);
});

test('compact mapping is the default, keeps one stud per source voxel, and measures vertical rounding', () => {
  const source = raw([cell(0, 0, 0), cell(0, 3, 0)]);
  const before = structuredClone(source);
  const result = convertToBricks({ rawModel: source });
  assert.deepEqual(result.metrics.scale, { mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 });
  assert.equal(result.metrics.mappedCellCount, 1);
  assert.equal(result.metrics.removedVolumeVoxelEquivalent, 1);
  assert.equal(result.metrics.addedVolumeVoxelEquivalent, 0.2);
  assert.equal(result.metrics.geometryDifferenceRatio, 0.6);
  assert.deepEqual(result.metrics.partHistogram, { '1x1': 1 });
  assert.deepEqual(source, before);
});

test('compact conversion fails explicitly when vertical rounding removes the entire shape', () => {
  assert.throws(() => convertToBricks({ rawModel: raw([cell(0, 3, 0)]) }), /removed every source cell/);
});

test('compact metrics measure deterministic color-boundary displacement', () => {
  const result = convertToBricks({ rawModel: raw([cell(0, 0, 0, 'red'), cell(0, 1, 0, 'blue')]) });
  assert.equal(result.metrics.addedVolumeVoxelEquivalent, 0.4);
  assert.equal(result.metrics.removedVolumeVoxelEquivalent, 0);
  assert.equal(result.metrics.recoloredVolumeVoxelEquivalent, 0.2);
  assert.equal(result.metrics.colorDifferenceRatio, 0.1);
});

test('compact packing prefers a 2x2 plus small fit brick over a nominal 2x3', () => {
  const cells = [];
  for (let z = 0; z < 2; z += 1) for (let x = 0; x < 3; x += 1) cells.push(cell(x, 0, z));
  const result = convertToBricks({ rawModel: raw(cells) });
  assert.deepEqual(result.metrics.partHistogram, { '1x2': 1, '2x2': 1 });
});

test('converter rejects invalid voxel input and removed legacy scale modes', () => {
  assert.throws(() => convertToBricks({ rawModel: raw([cell(0, -1, 0)]) }), /Invalid raw voxel model/);
  assert.throws(() => convertToBricks({ rawModel: raw([cell(0, 0, 0)]), scaleMode: 'exact' }), /only mode/);
  assert.deepEqual(
    convertToBricks({ rawModel: raw([cell(0, 0, 0)]), scaleMode: 'compact' }).brickModel,
    convertToBricks({ rawModel: raw([cell(0, 0, 0)]) }).brickModel,
  );
});

test('inspection distinguishes collisions, side touch, and vertical stud engagement', () => {
  const collision = inspectConstruction(model([brick(0, 0, 0, 2, 2), brick(1, 0, 1, 1, 1)]));
  assert.equal(collision.checks.noCollisions, false);
  assert.equal(collision.stats.collisionPairCount, 1);

  const side = inspectConstruction(model([brick(0, 0, 0), brick(1, 0, 0)]));
  assert.equal(side.stats.sideTouchPairCount, 1);
  assert.equal(side.stats.studConnectionCount, 0);
  assert.equal(side.stats.componentCount, 2);

  const engaged = inspectConstruction(model([brick(0, 0, 0, 2, 2), brick(1, 1, 1)]));
  assert.equal(engaged.stats.studConnectionCount, 1);
  assert.equal(engaged.stats.componentCount, 1);
  assert.equal(engaged.stats.groundlessComponentCount, 0);
});

test('inspection reports illegal footprints, groundless components, no support, and weak support', () => {
  const illegal = inspectConstruction(model([brick(20, 0, 20, 3, 3)]));
  assert.equal(illegal.stats.illegalFootprintCount, 1);
  assert.equal(illegal.checks.legalFootprints, false);
  assert.equal(illegal.checks.noCollisions, null);

  const result = inspectConstruction(model([
    brick(0, 0, 0),
    brick(5, 1, 5),
    brick(10, 0, 10),
    brick(10, 1, 10, 2, 4),
  ]));
  assert.equal(result.stats.groundlessComponentCount, 1);
  assert.equal(result.stats.unsupportedBrickCount, 1);
  assert.equal(result.stats.weakSupportBrickCount, 1);
  assert.equal(result.checks.allComponentsGrounded, false);
});

test('inspection fails closed on malicious extents and bounds collision work', () => {
  const huge = inspectConstruction(model([{ x: 0, y: 0, z: 0, w: Number.MAX_SAFE_INTEGER, d: 1, color: 'red' }]));
  assert.equal(huge.valid, false);
  assert.equal(huge.checks.noCollisions, null);
  assert.equal(huge.stats.componentCount, null);

  const duplicates = inspectConstruction(model(Array.from({ length: 5_000 }, () => brick(0, 0, 0))));
  assert.equal(duplicates.valid, false);
  assert.equal(duplicates.checks.noCollisions, false);
  assert.equal(duplicates.stats.collisionCountTruncated, true);
  assert.equal(duplicates.checks.allComponentsGrounded, null);
});

test('inspection counts an upper brick that joins lower bricks as a seam bridge', () => {
  const result = inspectConstruction(model([
    brick(0, 0, 0, 1, 2),
    brick(1, 0, 0, 1, 2),
    brick(0, 1, 0, 2, 2),
  ]));
  assert.equal(result.stats.bridgingBrickCount, 1);
  assert.equal(result.stats.studConnectionCount, 2);
  assert.equal(result.stats.componentCount, 1);
});

test('opt-in corrections add one local same-color raw-voxel bridge only when the stud graph improves', () => {
  const cells = [];
  for (let z = 0; z < 10; z += 1) for (let x = 0; x < 9; x += 1) cells.push(cell(x, 0, z));
  for (let x = 0; x < 9; x += 1) cells.push(cell(x, 1, 0));
  cells.push(cell(9, 2, 0));
  const source = raw(cells);
  const baseline = convertToBricks({ rawModel: source });
  const adjusted = convertToBricks({ rawModel: source, adjustments: true });
  assert.equal(baseline.diagnostics.stats.groundlessComponentCount, 1);
  assert.equal(adjusted.diagnostics.stats.groundlessComponentCount, 0);
  assert.equal(adjusted.adjustments.length, 1);
  assert.equal(adjusted.adjustments[0].cell.color, 'red');
  assert.equal(adjusted.metrics.structuralAddedVoxelCount, 1);
  assert.ok(adjusted.metrics.structuralAddedVoxelCount / adjusted.metrics.rawCellCount <= 0.01);
  assert.ok(adjusted.adjustments[0].addedStudCourseCells > 0);
  assert.deepEqual(source.cells, cells);
});

test('corrections can attach a color-boundary detail without recoloring either source cell', () => {
  const cells = [];
  for (let z = 0; z < 10; z += 1) for (let x = 0; x < 10; x += 1) cells.push(cell(x, 0, z, 'red'));
  cells.push(cell(10, 1, 9, 'blue'));
  const source = raw(cells);
  const before = structuredClone(source);
  const baseline = convertToBricks({ rawModel: source });
  const result = convertToBricks({ rawModel: source, adjustments: true });
  assert.equal(result.adjustments.length, 1);
  assert.deepEqual(result.adjustments[0].cell, cell(10, 0, 9, 'red'));
  assert.equal(result.adjustments[0].before.groundlessComponentCount, 1);
  assert.equal(result.adjustments[0].after.groundlessComponentCount, 0);
  assert.ok(result.diagnostics.stats.unsupportedBrickCount < baseline.diagnostics.stats.unsupportedBrickCount);
  assert.deepEqual(source, before);
  assert.equal(result.metrics.structuralAddedVoxelCount, 1);
  assert.ok(result.metrics.structuralAddedVoxelCount <= Math.min(32, Math.floor(cells.length * 0.01)));
});

test('corrections support an elevated side-touch-only detail through a neighboring color', () => {
  const cells = [];
  for (let z = 0; z < 10; z += 1) for (let x = 0; x < 9; x += 1) cells.push(cell(x, 0, z, 'red'));
  for (let y = 1; y <= 2; y += 1) for (let x = 0; x < 9; x += 1) cells.push(cell(x, y, 0, 'red'));
  cells.push(cell(9, 2, 0, 'blue'));
  const source = raw(cells);
  const baseline = convertToBricks({ rawModel: source });
  const adjusted = convertToBricks({ rawModel: source, adjustments: true });
  assert.ok(baseline.diagnostics.stats.sideTouchPairCount > 0);
  assert.equal(baseline.diagnostics.stats.groundlessComponentCount, 1);
  assert.equal(adjusted.diagnostics.stats.groundlessComponentCount, 0);
  assert.deepEqual(adjusted.adjustments.map(({ cell: added }) => added), [cell(9, 1, 0, 'red')]);
  assert.deepEqual(source.cells, cells);
});

test('corrections are deterministic, stay inside the source bounds, and report each accepted graph change', () => {
  const cells = [];
  for (let z = 0; z < 10; z += 1) for (let x = 0; x < 9; x += 1) cells.push(cell(x, 0, z));
  for (let x = 0; x < 9; x += 1) cells.push(cell(x, 1, 0));
  cells.push(cell(9, 2, 0));
  const source = raw(cells);
  const before = structuredClone(source);
  const first = convertToBricks({ rawModel: source, adjustments: true });
  const second = convertToBricks({ rawModel: source, adjustments: true });
  assert.deepEqual(first.brickModel, second.brickModel);
  assert.deepEqual(first.adjustments, second.adjustments);
  assert.deepEqual(source, before);
  for (const adjustment of first.adjustments) {
    assert.ok(adjustment.cell.x >= 0 && adjustment.cell.x <= 9);
    assert.ok(adjustment.cell.y >= 0 && adjustment.cell.y <= 2);
    assert.ok(adjustment.cell.z >= 0 && adjustment.cell.z <= 9);
    assert.match(adjustment.reason, /graph diagnostics|direct-support/);
    assert.ok(adjustment.after.groundlessComponentCount <= adjustment.before.groundlessComponentCount);
    assert.ok(adjustment.after.unsupportedBrickCount <= adjustment.before.unsupportedBrickCount);
  }
  assert.deepEqual(first.metrics.assemblyFeedback, second.metrics.assemblyFeedback);
  assert.ok(first.metrics.assemblyFeedback.evaluations <= first.metrics.assemblyFeedback.limit);
  assert.equal(first.assemblyPlan.stats.rootFailureCount, first.metrics.assemblyFeedback.final.rootFailureCount);
});

test('corrections do not join distinct grounded objects merely to reduce component count', () => {
  const cells = [];
  for (let z = 0; z < 10; z += 1) for (let x = 0; x < 5; x += 1) cells.push(cell(x, 0, z));
  for (let z = 0; z < 10; z += 1) for (let x = 6; x < 11; x += 1) cells.push(cell(x, 0, z));
  const result = convertToBricks({ rawModel: raw(cells), adjustments: true });
  assert.equal(result.diagnostics.stats.groundlessComponentCount, 0);
  assert.deepEqual(result.adjustments, []);
  assert.equal(result.metrics.structuralAddedVoxelCount, 0);
});

test('source occupancy indexing does not alias coordinates across a 64-cell row boundary', () => {
  const cells = [];
  for (let z = 0; z < 25; z += 1) for (let x = 60; x < 64; x += 1) cells.push(cell(x, 0, z));
  cells.push(cell(0, 0, 1));
  const result = convertToBricks({ rawModel: raw(cells), adjustments: true });
  assert.ok(result.diagnostics.stats.componentCount > 1);
  assert.equal(result.metrics.structuralAddedVoxelCount, 0);
});

test('assembly feedback rejects the saved TV graph repair regression', () => {
  const shape47 = JSON.parse(readFileSync(new URL(
    '../public/examples/shape-47.json',
    import.meta.url,
  ), 'utf8'));
  const before = structuredClone(shape47);
  const baseline = convertToBricks({ rawModel: shape47 });
  const adjusted = convertToBricks({ rawModel: shape47, adjustments: true });
  assert.deepEqual(adjusted.brickModel.bricks, baseline.brickModel.bricks);
  assert.deepEqual(adjusted.adjustments, []);
  assert.deepEqual(adjusted.metrics.assemblyFeedback.baseline, adjusted.metrics.assemblyFeedback.final);
  assert.equal(adjusted.metrics.assemblyFeedback.status, 'limit-reached');
  assert.equal(adjusted.metrics.assemblyFeedback.evaluations, adjusted.metrics.assemblyFeedback.limit);
  assert.equal(adjusted.metrics.assemblyFeedback.regressionRejections, adjusted.metrics.assemblyFeedback.evaluations);
  assert.equal(adjusted.metrics.assemblyFeedback.baseline.rootFailureCount, 25);
  assert.equal(adjusted.metrics.assemblyFeedback.baseline.unresolvedBrickCount, 921);
  assert.deepEqual(shape47, before);
});

test('assembly feedback fails closed when baseline packing exceeds planner bounds', () => {
  const cells = [];
  for (const y of [0, 2]) for (let z = 0; z < 64; z += 1) for (let x = 0; x < 64; x += 1) {
    cells.push(cell(x, y, z, (x + z) % 2 ? 'red' : 'blue'));
  }
  const source = raw(cells);
  const baseline = convertToBricks({ rawModel: source });
  const adjusted = convertToBricks({ rawModel: source, adjustments: true });
  assert.deepEqual(adjusted.brickModel.bricks, baseline.brickModel.bricks);
  assert.deepEqual(adjusted.adjustments, []);
  assert.equal(adjusted.assemblyPlan, null);
  assert.equal(adjusted.metrics.assemblyFeedback.status, 'baseline-planner-failed');
  assert.match(adjusted.metrics.assemblyFeedback.reason, /limited to 5000 bricks/);
  assert.equal(adjusted.metrics.assemblyFeedback.evaluations, 0);
  assert.equal(adjusted.metrics.adjustmentSearch.trialCount, 0);
});
