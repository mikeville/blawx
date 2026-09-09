import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { repairAttachmentInterfaces } from '../src/attachment-repair.js';
import { inspectConstruction } from '../src/construction.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { packingProfile, unresolvedCells } from '../src/refine-construction.js';

const SCALE = Object.freeze({ mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 });
const brick = (x, y, z, w = 1, d = 1, color = 'blue') => ({ x, y, z, w, d, color });

function cellsFor(bricks) {
  return bricks.flatMap(item => {
    const cells = [];
    for (let x = item.x; x < item.x + item.w; x += 1) for (let z = item.z; z < item.z + item.d; z += 1) {
      cells.push({ x, y: item.y, z, color: item.color });
    }
    return cells;
  });
}

function fixture(bricks, { mappedCellCount = cellsFor(bricks).length, priorAdded = 0 } = {}) {
  const brickModel = { version: 1, kind: 'bricks', bricks, meta: { scale: { ...SCALE } } };
  const rawModel = { version: 1, kind: 'voxels', cells: cellsFor(bricks) };
  const result = prepareAssemblyGuide({
    brickModel,
    assemblyPlan: createAssemblyPlan({ brickModel }),
    diagnostics: inspectConstruction(brickModel),
    metrics: { conversionMs: 7, mappedCellCount, structuralAddedMappedCellCount: priorAdded, stageTiming: { priorMs: 7 } },
  });
  return { result, rawModel };
}

function transform(bricks, { turns, dx, dz, colors }) {
  return bricks.map(item => {
    let next = { ...item };
    for (let turn = 0; turn < turns; turn += 1) next = { ...next, x: -next.z - next.d, z: next.x, w: next.d, d: next.w };
    return { ...next, x: next.x + dx, z: next.z + dz, color: colors[next.color] ?? next.color };
  });
}

function withoutTiming(value) {
  const copy = structuredClone(value);
  delete copy.attachmentRefinement.stageMs;
  delete copy.assemblyPlan.stats.planningMs;
  delete copy.instructionPlan.stats.planningMs;
  copy.metrics.conversionMs = 0;
  delete copy.metrics.stageTiming.attachmentRepairMs;
  for (const search of copy.attachmentRefinement.searches) delete search.generationMs;
  return copy;
}

test('exactly retiles a missing interface across rotations, translations, and color palettes', () => {
  const source = [brick(2, 0, 0, 1, 1, 'support'), brick(1, 1, 0, 1, 1, 'body'), brick(2, 1, 0, 1, 1, 'body')];
  for (let turns = 0; turns < 4; turns += 1) {
    const bricks = transform(source, { turns, dx: 12, dz: 12, colors: { support: turns % 2 ? 'black' : 'red', body: turns % 2 ? 'tan' : 'blue' } });
    const { result, rawModel } = fixture(bricks);
    const snapshot = structuredClone({ result, rawModel });
    const oldProfile = packingProfile(result.brickModel.bricks);
    const repaired = repairAttachmentInterfaces(result, { rawModel });

    assert.equal(repaired.attachmentRefinement.selected, true, `quarter turns: ${turns}`);
    assert.deepEqual(repaired.attachmentRefinement.accepted.map(entry => entry.phase), ['exact']);
    assert.equal(repaired.attachmentRefinement.addedCellCount, 0);
    assert.ok(repaired.attachmentRefinement.after.unresolvedCellCount < repaired.attachmentRefinement.before.unresolvedCellCount);
    assert.equal(unresolvedCells(repaired.assemblyPlan).size, 0);
    assert.ok(repaired.brickModel.bricks.length < result.brickModel.bricks.length);
    const nextProfile = packingProfile(repaired.brickModel.bricks);
    for (const [key, cell] of oldProfile.cells) assert.equal(nextProfile.cells.get(key)?.color, cell.color);
    assert.deepEqual({ result, rawModel }, snapshot, 'input result and raw model remain immutable');
  }
});

test('extensions are opt-in, obey the remaining one-percent budget, and resolve only declared added cells', () => {
  const bricks = [brick(0, 0, 0, 1, 1, 'red'), brick(1, 1, 0, 1, 1, 'blue')];
  const { result, rawModel } = fixture(bricks, { mappedCellCount: 200 });
  const exactOnly = repairAttachmentInterfaces(result, { rawModel });
  assert.equal(exactOnly.attachmentRefinement.selected, false);
  assert.deepEqual(exactOnly.brickModel, result.brickModel);
  assert.deepEqual(exactOnly.attachmentRefinement.addedCells, []);

  const repaired = repairAttachmentInterfaces(result, { rawModel, allowExtensions: true });
  assert.equal(repaired.attachmentRefinement.selected, true);
  assert.deepEqual(repaired.attachmentRefinement.accepted.map(entry => entry.phase), ['extension']);
  assert.equal(repaired.attachmentRefinement.addedCellCount, 1);
  assert.ok(repaired.attachmentRefinement.addedCellCount <= repaired.attachmentRefinement.budget.maxAddedCells);
  const oldCells = packingProfile(result.brickModel.bricks).cells;
  const nextCells = packingProfile(repaired.brickModel.bricks).cells;
  const actualAdded = [...nextCells].filter(([key]) => !oldCells.has(key)).map(([key, cell]) => ({ key, color: cell.color }));
  assert.deepEqual(actualAdded, repaired.attachmentRefinement.addedCells.map(cell => ({ key: `${cell.x},${cell.y},${cell.z}`, color: cell.color })));
  assert.equal(repaired.attachmentRefinement.addedCells.some(cell => unresolvedCells(repaired.assemblyPlan).has(`${cell.x},${cell.y},${cell.z}`)), false);

  const exhausted = fixture(bricks, { mappedCellCount: 200, priorAdded: 2 });
  const rejected = repairAttachmentInterfaces(exhausted.result, { rawModel: exhausted.rawModel, allowExtensions: true });
  assert.equal(rejected.attachmentRefinement.budget.maxAddedCells, 0);
  assert.equal(rejected.attachmentRefinement.selected, false);
  assert.deepEqual(rejected.brickModel, exhausted.result.brickModel);
});

test('repairs every interface in a bounded multi-course diagonal chain across rotations and translations', () => {
  const source = [[0, 0], [1, 1], [3, 2], [4, 3]]
    .map(([x, y]) => brick(x, y, 0, 1, 2, 'lightGray'));
  for (let turns = 0; turns < 4; turns += 1) {
    const bricks = transform(source, { turns, dx: 14, dz: 14, colors: { lightGray: turns % 2 ? 'tan' : 'lightGray' } });
    const { result, rawModel } = fixture(bricks, { mappedCellCount: 1600 });
    const originalCount = result.brickModel.bricks.length;
    const repaired = repairAttachmentInterfaces(result, { rawModel, allowExtensions: true });
    const report = repaired.attachmentRefinement;

    assert.equal(report.selected, true, `quarter turns: ${turns}`);
    assert.ok(report.accepted.length >= 2, `quarter turns: ${turns}`);
    assert.equal(report.after.unresolvedCellCount, 0);
    assert.equal(report.after.unresolvedBrickCount, 0);
    assert.equal(report.after.groundlessComponentCount, 0);
    assert.equal(report.addedCellCount, 8);
    assert.ok(report.addedCellCount <= report.budget.maxAddedCells);
    assert.equal(repaired.brickModel.bricks.length, originalCount);
    const unresolved = unresolvedCells(repaired.assemblyPlan);
    assert.equal(report.addedCells.some(cell => unresolved.has(`${cell.x},${cell.y},${cell.z}`)), false);
    const bricksById = new Map(repaired.assemblyPlan.bricks.map(item => [item.id, item]));
    const edgeIds = new Set(repaired.assemblyPlan.graph.edges.flatMap(({ a, b }) => [a, b]));
    const addedKeys = new Set(report.addedCells.map(cell => `${cell.x},${cell.y},${cell.z}`));
    const repairedParts = repaired.assemblyPlan.bricks.filter(item => {
      for (let x = item.x; x < item.x + item.w; x += 1) for (let z = item.z; z < item.z + item.d; z += 1) {
        if (addedKeys.has(`${x},${item.y},${z}`)) return true;
      }
      return false;
    });
    assert.equal(repairedParts.every(({ id }) => edgeIds.has(id)), true, 'every extended part has a real stud edge');
    assert.equal(repaired.assemblyPlan.graph.components.every(component => component.grounded), true);
    assert.equal([...edgeIds].every(id => bricksById.has(id)), true);
  }
});

test('resolved input is a bounded no-op and repair is deterministic apart from timing', () => {
  const { result, rawModel } = fixture([brick(0, 0, 0, 2, 1, 'green'), brick(0, 1, 0, 2, 1, 'yellow')]);
  const first = repairAttachmentInterfaces(result, { rawModel, allowExtensions: true });
  const second = repairAttachmentInterfaces(structuredClone(result), { rawModel: structuredClone(rawModel), allowExtensions: true });
  assert.equal(first.attachmentRefinement.selected, false);
  assert.equal(first.attachmentRefinement.attempts.length, 0);
  assert.deepEqual(first.attachmentRefinement.before, first.attachmentRefinement.after);
  assert.deepEqual(first.brickModel, result.brickModel);
  assert.deepEqual(withoutTiming(first), withoutTiming(second));
});

test('fails closed on malformed inputs and invalid options', () => {
  assert.throws(() => repairAttachmentInterfaces(), /prepared construction result/);
  const { result, rawModel } = fixture([brick(0, 0, 0)]);
  assert.throws(() => repairAttachmentInterfaces(result, { rawModel, allowExtensions: 'yes' }), /boolean/);
  assert.throws(() => repairAttachmentInterfaces(result, { rawModel: { version: 1, kind: 'voxels', cells: [] } }), /nonempty voxel model/);
});
