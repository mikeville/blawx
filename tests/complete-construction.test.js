import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { assessAssemblyQuality, orderQualityRejections } from '../src/assembly-quality.js';
import { completeConstruction, repairPreparedConstruction } from '../src/complete-construction.js';
import { inspectConstruction } from '../src/construction.js';
import { measureBrickDifference } from '../src/construction-differences.js';
import { packingProfile, packingRejectionReasons } from '../src/refine-construction.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';

const SCALE = Object.freeze({ mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 });
const brick = (x, y, z, w = 1, d = 1, color = 'blue') => ({ x, y, z, w, d, color });
const raw = (cells) => ({ version: 1, kind: 'voxels', cells });

function cellsForBricks(bricks) {
  const cells = [];
  for (const item of bricks) for (let dz = 0; dz < item.d; dz += 1) for (let dx = 0; dx < item.w; dx += 1) {
    cells.push({ x: item.x + dx, y: item.y, z: item.z + dz, color: item.color });
  }
  return cells;
}

function occupied(bricks) {
  const cells = new Map();
  for (const item of bricks) for (let dz = 0; dz < item.d; dz += 1) for (let dx = 0; dx < item.w; dx += 1) {
    const key = `${item.x + dx},${item.y},${item.z + dz}`;
    assert.equal(cells.has(key), false, `unexpected collision at ${key}`);
    cells.set(key, item.color);
  }
  return cells;
}

function histogram(bricks) {
  const result = {};
  for (const { w, d } of bricks) {
    const key = `${Math.min(w, d)}x${Math.max(w, d)}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function inventory(bricks) {
  const result = {};
  for (const { w, d, color } of bricks) {
    const key = `${Math.min(w, d)}x${Math.max(w, d)}:${color}`;
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

function preparedResult(bricks, rawModel) {
  const brickModel = { version: 1, kind: 'bricks', bricks, meta: { scale: { ...SCALE } } };
  const measured = measureBrickDifference(rawModel, brickModel);
  return prepareAssemblyGuide({
    brickModel,
    diagnostics: inspectConstruction(brickModel),
    assemblyPlan: createAssemblyPlan({ brickModel }),
    packingRefinement: { localOrdering: { selected: false } },
    metrics: {
      ...measured,
      conversionMs: 0,
      brickCount: bricks.length,
      partHistogram: histogram(bricks),
      structuralAddedMappedCellCount: 0,
      stageTiming: {},
    },
  });
}

function assertFinalArtifacts(result, rawModel) {
  assert.equal(result.assemblyPlan.stats.coverageComplete, true);
  assert.equal(result.instructionPlan.stats.coverageComplete, true);
  assert.equal(result.guide.stats.coverageComplete, true);
  assert.equal(result.guide.stats.brickCount, result.brickModel.bricks.length);
  assert.deepEqual(
    result.guide.sections.flatMap(({ stepIds }) => stepIds),
    result.instructionPlan.steps.map(({ id }) => id),
  );
  assert.deepEqual(
    result.instructionPlan.steps.flatMap(({ sourceStepIds }) => sourceStepIds),
    result.assemblyPlan.steps.map(({ id }) => id),
  );
  assert.deepEqual(result.assemblyEvaluation.after, assessAssemblyQuality(result.assemblyPlan));
  assert.equal(result.assemblyEvaluation.compaction.sourceStepCoverageComplete, true);
  assert.equal(result.assemblyEvaluation.compaction.brickCoverageComplete, true);

  assert.deepEqual(
    result.assemblyPlan.bricks.map(({ id: _id, ...geometry }) => geometry),
    result.brickModel.bricks,
  );
  assert.deepEqual(
    Object.fromEntries(result.assemblyPlan.inventory.map(({ key, count }) => [key, count])),
    inventory(result.brickModel.bricks),
  );
  assert.deepEqual(result.metrics.partHistogram, histogram(result.brickModel.bricks));
  assert.equal(result.metrics.brickCount, result.brickModel.bricks.length);

  const measured = measureBrickDifference(rawModel, result.brickModel);
  for (const key of [
    'mappedCellCount', 'addedVolumeVoxelEquivalent', 'removedVolumeVoxelEquivalent',
    'recoloredVolumeVoxelEquivalent', 'relativeVolumeChange', 'geometryDifferenceRatio', 'colorDifferenceRatio',
  ]) assert.equal(result.metrics[key], measured[key], `${key} must describe final geometry`);
  assert.deepEqual(result.metrics.colorVolumeDeltas, measured.colorVolumeDeltas);

  const diagnostics = inspectConstruction(result.brickModel);
  assert.deepEqual(result.diagnostics.checks, diagnostics.checks);
  assert.deepEqual(result.diagnostics.stats, diagnostics.stats);
}

test('complete pipeline leaves a baseline model unextended and keeps final plans, guide, metrics, and inventory aligned', () => {
  const cells = [];
  for (let y = 0; y < 2; y += 1) for (let z = 0; z < 2; z += 1) for (let x = 0; x < 4; x += 1) {
    cells.push({ x, y, z, color: y ? 'orange' : 'blue' });
  }
  const source = raw(cells);
  const before = structuredClone(source);
  const result = completeConstruction({ rawModel: source });

  assert.deepEqual(source, before);
  assert.equal(result.assemblyError, undefined);
  assert.equal(result.rootRefinement.selected, false);
  assert.deepEqual(result.rootRefinement.addedCells, []);
  assert.equal(result.rootRefinement.addedCellCount, 0);
  assert.equal(result.metrics.rootRepairAddedMappedCellCount, 0);
  assert.equal(result.metrics.structuralAddedMappedCellCount, 0);
  assert.deepEqual(result.adjustments, []);
  assertFinalArtifacts(result, source);
});

test('accepted exact root repair preserves occupied cells and rebuilds all derived assembly artifacts', () => {
  const bricks = [
    brick(0, 0, 0),
    brick(0, 1, 0, 2, 2),
    brick(0, 1, 2, 2, 2),
    brick(0, 2, 0, 2, 4),
  ];
  const source = raw(cellsForBricks(bricks));
  const prepared = preparedResult(bricks, source);
  const before = structuredClone(prepared);
  const result = repairPreparedConstruction(prepared, { rawModel: source });

  assert.deepEqual(prepared, before);
  assert.equal(result.rootRefinement.selected, true);
  assert.deepEqual(result.rootRefinement.accepted.map(({ phase }) => phase), ['exact']);
  assert.equal(result.rootRefinement.before.rootFailureCount, 1);
  assert.equal(result.rootRefinement.after.rootFailureCount, 0);
  assert.equal(result.rootRefinement.addedCellCount, 0);
  assert.equal(result.metrics.rootRepairAddedMappedCellCount, 0);
  assert.equal(result.metrics.structuralAddedMappedCellCount, 0);
  assert.deepEqual(occupied(result.brickModel.bricks), occupied(prepared.brickModel.bricks));
  assert.deepEqual(
    packingRejectionReasons(packingProfile(prepared.brickModel.bricks), packingProfile(result.brickModel.bricks)),
    [],
  );
  assert.deepEqual(orderQualityRejections(
    assessAssemblyQuality(prepared.assemblyPlan), assessAssemblyQuality(result.assemblyPlan),
  ), []);
  assertFinalArtifacts(result, source);
});

test('opt-in root extension adds only its reported support cell and remeasures final geometry', () => {
  const bricks = [
    brick(0, 0, 0),
    brick(0, 1, 0),
    brick(1, 1, 0, 1, 1, 'orange'),
    brick(0, 2, 0, 2, 1),
  ];
  for (let index = 0; index < 24; index += 1) {
    bricks.push(brick(20 + 2 * (index % 8), 0, 4 * Math.floor(index / 8), 2, 4));
  }
  bricks.push(brick(40, 0, 0, 1, 3));
  const source = raw(cellsForBricks(bricks));
  assert.equal(source.cells.length, 200);
  const prepared = preparedResult(bricks, source);
  const originalCells = occupied(prepared.brickModel.bricks);
  const result = repairPreparedConstruction(prepared, { rawModel: source, allowExtensions: true });
  const finalCells = occupied(result.brickModel.bricks);

  assert.equal(result.rootRefinement.selected, true);
  assert.deepEqual(result.rootRefinement.accepted.map(({ phase }) => phase), ['extension']);
  assert.deepEqual(result.rootRefinement.addedCells, [{ x: 1, y: 0, z: 0, color: 'blue' }]);
  assert.equal(result.rootRefinement.addedCellCount, 1);
  assert.equal(result.rootRefinement.before.rootFailureCount, 1);
  assert.equal(result.rootRefinement.after.rootFailureCount, 0);
  assert.equal(result.metrics.rootRepairAddedMappedCellCount, 1);
  assert.equal(result.metrics.structuralAddedMappedCellCount, 1);
  assert.equal(result.metrics.mappedCellCount, prepared.metrics.mappedCellCount + 1);
  assert.equal(finalCells.size, originalCells.size + 1);
  for (const [key, color] of originalCells) assert.equal(finalCells.get(key), color);
  assert.equal(finalCells.get('1,0,0'), 'blue');
  assert.deepEqual(orderQualityRejections(
    assessAssemblyQuality(prepared.assemblyPlan), assessAssemblyQuality(result.assemblyPlan),
  ), []);
  assertFinalArtifacts(result, source);
});
