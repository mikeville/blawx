import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { inspectConstruction } from '../src/construction.js';
import { packingProfile, packingRejectionReasons, unresolvedCells } from '../src/refine-construction.js';
import { refineConstructionRoots } from '../src/root-refinement.js';

const brick = (x, y, z, w = 1, d = 1, color = 'orange') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function resultFor(bricks, metrics = {}) {
  const brickModel = model(bricks);
  return {
    brickModel,
    diagnostics: inspectConstruction(brickModel),
    assemblyPlan: createAssemblyPlan({ brickModel }),
    metrics: { mappedCellCount: bricks.reduce((sum, item) => sum + item.w * item.d, 0), structuralAddedMappedCellCount: 0, ...metrics },
    packingRefinement: { localOrdering: { selected: false } },
  };
}

function occupied(bricks) {
  const cells = new Map();
  for (const item of bricks) for (let x = item.x; x < item.x + item.w; x += 1) for (let z = item.z; z < item.z + item.d; z += 1) {
    cells.set(`${x},${item.y},${z}`, item.color);
  }
  return cells;
}

function rotate(bricks, turns, dx, dz, color) {
  return bricks.map((source) => {
    let item = { ...source, color };
    for (let turn = 0; turn < turns; turn += 1) item = {
      ...item, x: -item.z - item.d, z: item.x, w: item.d, d: item.w,
    };
    return { ...item, x: item.x + dx, z: item.z + dz };
  });
}

test('dedicated exact phase fixes translated and rotated root interfaces without changing cells', () => {
  const source = [
    brick(0, 0, 0),
    brick(0, 1, 0, 2, 2),
    brick(0, 1, 2, 2, 2),
    brick(0, 2, 0, 2, 4),
  ];
  for (const turns of [0, 1, 2, 3]) {
    const input = resultFor(rotate(source, turns, 17, -9, 'blue'));
    const saved = JSON.stringify(input);
    const refined = refineConstructionRoots(input);
    assert.equal(refined.rootRefinement.before.rootFailureCount, 1);
    assert.equal(refined.rootRefinement.after.rootFailureCount, 0);
    assert.ok(refined.rootRefinement.after.unresolvedOldCellCount < refined.rootRefinement.before.unresolvedOldCellCount);
    assert.equal(refined.rootRefinement.exact.accepted.length, 1);
    assert.equal(refined.rootRefinement.extension.evaluations, 0);
    assert.deepEqual(packingRejectionReasons(
      packingProfile(input.brickModel.bricks), packingProfile(refined.brickModel.bricks),
    ), []);
    assert.deepEqual(occupied(refined.brickModel.bricks), occupied(input.brickModel.bricks));
    assert.equal(JSON.stringify(input), saved);
  }
});

test('extensions are opt-in, concealed, color-preserving and resolve old occupied cells', () => {
  const input = resultFor([
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(1, 1, 0, 1, 1, 'orange'),
    brick(0, 2, 0, 2, 1, 'blue'),
  ], { mappedCellCount: 200 });
  const exactOnly = refineConstructionRoots(input);
  assert.deepEqual(exactOnly.brickModel.bricks, input.brickModel.bricks);
  assert.equal(exactOnly.rootRefinement.after.rootFailureCount, 1);

  const refined = refineConstructionRoots(input, { allowExtensions: true });
  assert.equal(refined.rootRefinement.before.rootFailureCount, 1);
  assert.equal(refined.rootRefinement.after.rootFailureCount, 0);
  assert.equal(refined.rootRefinement.extension.accepted.length, 1);
  assert.deepEqual(refined.rootRefinement.addedCells, [{ x: 1, y: 0, z: 0, color: 'blue' }]);
  assert.equal(unresolvedCells(refined.assemblyPlan).has('1,0,0'), false);
  assert.equal(refined.brickModel.bricks.find(({ x, y }) => x === 1 && y === 1).color, 'orange');
  for (const [key, color] of occupied(input.brickModel.bricks)) assert.equal(occupied(refined.brickModel.bricks).get(key), color);
});

test('extension phase fails closed for exhausted budget, invalid lower support and blocked rectangles', () => {
  const eligible = resultFor([brick(0, 0, 0), brick(1, 1, 0)], {
    mappedCellCount: 200,
    structuralAddedMappedCellCount: 2,
  });
  const exhausted = refineConstructionRoots(eligible, { allowExtensions: true });
  assert.equal(exhausted.rootRefinement.extension.addedCellBudget, 0);
  assert.deepEqual(exhausted.brickModel.bricks, eligible.brickModel.bricks);

  const floating = resultFor([brick(5, 0, 5), brick(0, 1, 0), brick(1, 2, 0)], { mappedCellCount: 200 });
  const invalid = refineConstructionRoots(floating, { allowExtensions: true });
  assert.equal(invalid.rootRefinement.extension.accepted.length, 0);
  assert.deepEqual(invalid.brickModel.bricks, floating.brickModel.bricks);

  const blocked = resultFor([
    brick(0, 0, 0, 2, 4, 'blue'),
    brick(0, 1, 1, 1, 1, 'blue'),
    brick(2, 1, 1, 1, 1, 'orange'),
    brick(0, 2, 1, 3, 1, 'blue'),
  ], { mappedCellCount: 200 });
  const noLegalRectangle = refineConstructionRoots(blocked, { allowExtensions: true });
  assert.equal(noLegalRectangle.rootRefinement.extension.accepted.length, 0);
  assert.deepEqual(noLegalRectangle.brickModel.bricks, blocked.brickModel.bricks);
});

test('does not reuse a brick whose cells are later reported by an unresolved module join', () => {
  const input = resultFor([
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(1, 1, 0, 1, 1, 'orange'),
    brick(0, 2, 0, 2, 1, 'blue'),
  ], { mappedCellCount: 200 });
  const lowerId = input.assemblyPlan.bricks.find(({ x, y }) => x === 0 && y === 0).id;
  input.assemblyPlan.steps.push({
    id: 'synthetic-failed-join',
    moduleId: 'module-review',
    label: 'Unresolved join',
    kind: 'unresolved',
    newBrickIds: [],
    visibleBrickIds: [lowerId],
    highlightBrickIds: [lowerId],
    issues: [{ code: 'no-stud-engagement', severity: 'error', message: 'Fixture join failure.', brickIds: [lowerId] }],
  });
  const refined = refineConstructionRoots(input, { allowExtensions: true });
  assert.equal(refined.rootRefinement.extension.evaluations, 0);
  assert.equal(refined.rootRefinement.extension.accepted.length, 0);
  assert.deepEqual(refined.brickModel.bricks, input.brickModel.bricks);
});

test('rejects larger root repairs that create a newly weak supporting brick', () => {
  const input = resultFor([
    brick(0, 0, 0, 1, 1, 'blue'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(0, 2, 0, 1, 1, 'blue'),
    brick(1, 2, 0, 1, 4, 'orange'),
    brick(0, 2, 1, 1, 3, 'orange'),
    brick(0, 3, 0, 2, 4, 'blue'),
  ], { mappedCellCount: 800 });
  assert.equal(input.assemblyPlan.stats.rootFailureCount > 0, true);
  assert.equal(input.diagnostics.stats.weakSupportBrickCount, 0);
  const refined = refineConstructionRoots(input, { allowExtensions: true });
  assert.equal(refined.rootRefinement.extension.accepted.length, 1);
  assert.ok((refined.rootRefinement.rejections['Weak-support brick count increased'] ?? 0) > 0);
  assert.equal(refined.rootRefinement.after.weakSupportBrickCount, 0);
  assert.ok(refined.rootRefinement.extension.attempts
    .filter(({ rejectionReasons }) => rejectionReasons.includes('Weak-support brick count increased'))
    .every(({ after }) => after[0].w * after[0].d > 4));
});

test('rejects invalid options and keeps all phase checks within deterministic bounds', () => {
  const input = resultFor([brick(0, 0, 0), brick(1, 1, 0)], { mappedCellCount: 200 });
  assert.throws(() => refineConstructionRoots(input, { allowExtensions: 'yes' }), /boolean/);
  const first = refineConstructionRoots(input, { allowExtensions: true });
  const second = refineConstructionRoots(structuredClone(input), { allowExtensions: true });
  assert.ok(first.rootRefinement.exact.evaluations <= 16);
  assert.ok(first.rootRefinement.extension.evaluations <= 16);
  assert.ok(first.rootRefinement.exact.accepted.length <= 2);
  assert.ok(first.rootRefinement.extension.accepted.length <= 2);
  const withoutTiming = (value) => {
    const copy = structuredClone(value);
    delete copy.rootRefinement.refinementMs;
    delete copy.assemblyPlan.stats.planningMs;
    return copy;
  };
  assert.deepEqual(withoutTiming(first), withoutTiming(second));
});
