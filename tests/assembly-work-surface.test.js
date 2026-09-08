import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';

const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function withoutTiming(plan) {
  const copy = structuredClone(plan);
  delete copy.stats.planningMs;
  return copy;
}

function idsMatching(plan, predicate) {
  return plan.bricks.filter(predicate).map(({ id }) => id);
}

function introducedOnce(plan) {
  const introduced = plan.steps.flatMap(({ newBrickIds }) => newBrickIds);
  return introduced.length === plan.bricks.length && new Set(introduced).size === plan.bricks.length;
}

test('a connected work-surface bridge joins separate grounded feet and continues in place', () => {
  const source = model([
    brick(0, 0, 0), brick(2, 0, 0),
    brick(0, 1, 0), brick(2, 1, 0),
    brick(0, 2, 0, 3, 1),
    brick(0, 3, 0, 3, 1),
  ]);
  const before = structuredClone(source);
  const baseline = createAssemblyPlan({ brickModel: source });
  const explicitDefault = createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: null });
  const bandIds = idsMatching(baseline, ({ y }) => y === 1 || y === 2);
  const plan = createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: bandIds });

  assert.deepEqual(source, before);
  assert.deepEqual(withoutTiming(explicitDefault), withoutTiming(baseline));
  assert.deepEqual(plan.bricks, baseline.bricks);
  assert.deepEqual(plan.inventory, baseline.inventory);
  assert.deepEqual(plan.modules.map(({ kind, groupType }) => ({ kind, groupType })), [
    { kind: 'grounded', groupType: undefined },
    { kind: 'detail', groupType: 'work-surface' },
    { kind: 'grounded', groupType: 'continuation' },
  ]);

  const workSurface = plan.modules[1];
  const continuation = plan.modules[2];
  assert.deepEqual(workSurface.brickIds, bandIds);
  assert.deepEqual(workSurface.buildContext, { kind: 'work-surface', floorY: 1 });
  assert.deepEqual(workSurface.joinContext, {
    direction: 'down',
    supportGroups: [
      {
        brickIds: [plan.modules[0].brickIds[0]],
        contacts: [{ supportBrickId: plan.modules[0].brickIds[0], bandBrickId: bandIds[0], studs: 1 }],
      },
      {
        brickIds: [plan.modules[0].brickIds[1]],
        contacts: [{ supportBrickId: plan.modules[0].brickIds[1], bandBrickId: bandIds[1], studs: 1 }],
      },
    ],
    requiresAlignment: true,
  });

  const bandSteps = plan.steps.filter(({ moduleId }) => moduleId === workSurface.id);
  const join = bandSteps.at(-1);
  assert.equal(join.kind, 'join');
  assert.deepEqual(join.joinContext, workSurface.joinContext);
  assert.equal(bandSteps.slice(0, -1).every(({ visibleBrickIds }) => visibleBrickIds.every((id) => bandIds.includes(id))), true);
  assert.equal(bandSteps.some(({ issues }) => issues.some(({ code }) => code === 'temporary-hold')), false);
  assert.equal(idsMatching(plan, ({ y }) => y === 1).every((id) => bandSteps.some((step) =>
    step.kind === 'build' && step.newBrickIds.includes(id))), true);
  assert.deepEqual(new Set(join.visibleBrickIds), new Set([...plan.modules[0].brickIds, ...bandIds]));

  const continuationSteps = plan.steps.filter(({ moduleId }) => moduleId === continuation.id);
  assert.equal(continuationSteps.every(({ kind }) => kind === 'build'), true);
  assert.equal(continuationSteps.every(({ issues }) => issues.length === 0), true);
  assert.deepEqual(
    new Set(continuationSteps[0].visibleBrickIds),
    new Set([...plan.modules[0].brickIds, ...bandIds, ...continuation.brickIds]),
  );
  assert.equal(plan.stats.validJoinCount, 1);
  assert.equal(plan.stats.joinStudCount, 2);
  assert.equal(plan.stats.rootFailureCount, 0);
  assert.equal(plan.stats.temporaryHoldStepCount, 0);
  assert.equal(plan.stats.coverageComplete, true);
  assert.equal(introducedOnce(plan), true);
});

test('rejects a disconnected band instead of trusting caller-selected brick IDs', () => {
  const source = model([
    brick(0, 0, 0), brick(2, 0, 0),
    brick(0, 1, 0), brick(2, 1, 0),
    brick(0, 2, 0, 3, 1),
  ]);
  const baseline = createAssemblyPlan({ brickModel: source });
  const disconnected = idsMatching(baseline, ({ y }) => y === 1);

  assert.throws(
    () => createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: disconnected }),
    /internally stud-connected/,
  );
  assert.throws(
    () => createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: new Set(disconnected) }),
    /must be an array/,
  );
});

test('table support applies only at the selected floor and leaves an elevated internal root unresolved', () => {
  const source = model([
    brick(0, 0, 0),
    brick(0, 1, 0),
    brick(0, 2, 0), brick(2, 2, 0),
    brick(0, 3, 0, 3, 1),
    brick(0, 4, 0, 3, 1),
  ]);
  const baseline = createAssemblyPlan({ brickModel: source });
  const bandIds = idsMatching(baseline, ({ x, y }) => (x === 0 && y >= 1 && y <= 3) || x === 2 && y === 2);
  const elevatedRootId = idsMatching(baseline, ({ x, y }) => x === 2 && y === 2)[0];
  const plan = createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: bandIds });
  const workSurface = plan.modules.find(({ groupType }) => groupType === 'work-surface');
  const bandSteps = plan.steps.filter(({ moduleId }) => moduleId === workSurface.id);
  const elevatedStep = bandSteps.find(({ newBrickIds }) => newBrickIds.includes(elevatedRootId));

  assert.equal(workSurface.buildContext.floorY, 1);
  assert.equal(elevatedStep.kind, 'unresolved');
  assert.equal(elevatedStep.issues.some(({ code, brickIds }) =>
    code === 'unsupported-addition' && brickIds.includes(elevatedRootId)), true);
  assert.equal(bandSteps.some(({ issues }) => issues.some(({ code }) => code === 'temporary-hold')), false);
  assert.equal(bandSteps.at(-1).kind, 'unresolved');
  assert.equal(bandSteps.at(-1).issues.some(({ code }) => code === 'unresolved-prerequisite'), true);
  assert.ok(plan.stats.rootFailureCount >= 1);
  assert.equal(plan.stats.validJoinCount, 0);
  assert.equal(plan.stats.coverageComplete, true);
  assert.equal(introducedOnce(plan), true);
});

test('a prior overhead component blocks the full downward work-surface join sweep', () => {
  const source = model([
    brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0),
    brick(5, 0, 0, 1, 1, 'blue'),
    brick(5, 1, 0, 1, 1, 'blue'),
    brick(5, 2, 0, 1, 1, 'blue'),
    brick(5, 3, 0, 1, 1, 'blue'),
    brick(0, 4, 0, 6, 1, 'blue'),
  ]);
  const baseline = createAssemblyPlan({ brickModel: source });
  const bandIds = idsMatching(baseline, ({ x, y, color }) => x === 0 && color === 'red' && (y === 1 || y === 2));
  const plan = createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: bandIds });
  const workSurface = plan.modules.find(({ groupType }) => groupType === 'work-surface');
  const join = plan.steps.filter(({ moduleId }) => moduleId === workSurface.id).at(-1);

  assert.equal(join.kind, 'unresolved');
  assert.equal(join.issues.some(({ code }) => code === 'blocked-module-insertion'), true);
  assert.equal(plan.stats.blockedJoinCount, 1);
  assert.equal(plan.stats.validJoinCount, 0);
  assert.equal(plan.stats.coverageComplete, true);
  assert.equal(introducedOnce(plan), true);
});

test('continuation finishes the lowest feasible branch course before climbing nearby work', () => {
  const source = model([
    brick(0, 0, 0), brick(3, 0, 0),
    brick(0, 1, 0), brick(3, 1, 0),
    brick(0, 2, 0, 4, 1),
    brick(0, 3, 0), brick(3, 3, 0),
    brick(0, 4, 0),
  ]);
  const baseline = createAssemblyPlan({ brickModel: source });
  const bandIds = idsMatching(baseline, ({ y }) => y === 1 || y === 2);
  const plan = createAssemblyPlan({
    brickModel: source,
    workSurfaceBrickIds: bandIds,
    preferLocalProgress: true,
    preferLocalFoundations: true,
  });
  const continuation = plan.modules.find(({ groupType }) => groupType === 'continuation');
  const byId = new Map(plan.bricks.map((item) => [item.id, item]));
  const continuationCourses = plan.steps
    .filter(({ moduleId, newBrickIds }) => moduleId === continuation.id && newBrickIds.length)
    .map(({ newBrickIds }) => Math.min(...newBrickIds.map((id) => byId.get(id).y)));

  assert.deepEqual(continuationCourses, [3, 3, 4]);
  assert.equal(plan.steps.filter(({ moduleId }) => moduleId === continuation.id).every(({ kind }) => kind === 'build'), true);
  assert.equal(plan.stats.rootFailureCount, 0);
  assert.equal(plan.stats.unresolvedBrickCount, 0);
  assert.equal(plan.stats.coverageComplete, true);
});

test('guide preparation preserves the work-surface module and its distinct alignment join diagram', () => {
  const source = model([
    brick(0, 0, 0), brick(2, 0, 0),
    brick(0, 1, 0), brick(2, 1, 0),
    brick(0, 2, 0, 3, 1),
    brick(0, 3, 0, 3, 1),
  ]);
  const baseline = createAssemblyPlan({ brickModel: source });
  const bandIds = idsMatching(baseline, ({ y }) => y === 1 || y === 2);
  const assemblyPlan = createAssemblyPlan({ brickModel: source, workSurfaceBrickIds: bandIds });
  const prepared = prepareAssemblyGuide({
    brickModel: source,
    assemblyPlan,
    metrics: { conversionMs: 0, stageTiming: {} },
  });
  const workSurface = prepared.assemblyPlan.modules.find(({ groupType }) => groupType === 'work-surface');
  const sourceJoin = prepared.assemblyPlan.steps.find(({ moduleId, kind, newBrickIds }) =>
    moduleId === workSurface.id && kind === 'join' && newBrickIds.length === 0);
  const instructionWorkSurface = prepared.instructionPlan.modules.find(({ id }) => id === workSurface.id);
  const instructionJoin = prepared.instructionPlan.steps.find(({ sourceStepIds }) =>
    sourceStepIds.includes(sourceJoin.id));

  assert.deepEqual(workSurface.brickIds, bandIds);
  assert.deepEqual(instructionWorkSurface.buildContext, { kind: 'work-surface', floorY: 1 });
  assert.deepEqual(instructionWorkSurface.joinContext, workSurface.joinContext);
  assert.deepEqual(sourceJoin.joinContext, {
    direction: 'down',
    supportGroups: [
      {
        brickIds: [prepared.assemblyPlan.modules[0].brickIds[0]],
        contacts: [{
          supportBrickId: prepared.assemblyPlan.modules[0].brickIds[0],
          bandBrickId: bandIds[0],
          studs: 1,
        }],
      },
      {
        brickIds: [prepared.assemblyPlan.modules[0].brickIds[1]],
        contacts: [{
          supportBrickId: prepared.assemblyPlan.modules[0].brickIds[1],
          bandBrickId: bandIds[1],
          studs: 1,
        }],
      },
    ],
    requiresAlignment: true,
  });
  assert.deepEqual(instructionJoin.sourceStepIds, [sourceJoin.id]);
  assert.deepEqual(instructionJoin.newBrickIds, []);
  assert.deepEqual(instructionJoin.highlightBrickIds, bandIds);
  assert.deepEqual(instructionJoin.joinContext, sourceJoin.joinContext);
  assert.deepEqual(
    prepared.instructionPlan.steps.flatMap(({ sourceStepIds }) => sourceStepIds),
    prepared.assemblyPlan.steps.map(({ id }) => id),
  );
  assert.equal(introducedOnce(prepared.assemblyPlan), true);
  assert.equal(prepared.assemblyPlan.stats.coverageComplete, true);
  assert.equal(prepared.instructionPlan.stats.coverageComplete, true);
  assert.equal(prepared.guide.stats.coverageComplete, true);
  assert.equal(prepared.assemblyEvaluation.compaction.sourceStepCoverageComplete, true);
  assert.equal(prepared.assemblyEvaluation.compaction.brickCoverageComplete, true);
});
