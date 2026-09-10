import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';

const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function withoutTiming(plan) {
  const copy = structuredClone(plan);
  delete copy.stats.planningMs;
  return copy;
}

test('assembly planning is repeatable, rotation-normalizes inventory, and introduces every brick once', () => {
  const source = model([
    brick(0, 0, 0, 2, 4, 'red'),
    brick(4, 0, 0, 4, 2, 'red'),
    brick(0, 1, 0, 2, 2, 'blue'),
  ]);
  const before = structuredClone(source);
  const first = createAssemblyPlan({ brickModel: source });
  const second = createAssemblyPlan({ brickModel: structuredClone(source) });

  assert.deepEqual(withoutTiming(first), withoutTiming(second));
  assert.deepEqual(source, before);
  assert.deepEqual(first.inventory, [
    { key: '2x2:blue', w: 2, d: 2, color: 'blue', count: 1 },
    { key: '2x4:red', w: 2, d: 4, color: 'red', count: 2 },
  ]);
  assert.equal(first.stats.coverageComplete, true);
  const introduced = first.steps.flatMap((step) => step.newBrickIds);
  assert.equal(introduced.length, first.bricks.length);
  assert.equal(new Set(introduced).size, first.bricks.length);
  assert.equal(first.steps.every((step) => step.newBrickIds.length <= 12), true);
  assert.equal(first.bricks.every(({ id }) => id.startsWith('b@')), true);
});

test('repetitive supported additions use bounded twelve-brick steps without collapsing dependencies', () => {
  const bricks = [
    brick(0, 0, 0, 2, 8), brick(2, 0, 0, 2, 8), brick(4, 0, 0, 2, 8),
  ];
  for (let z = 0; z < 8; z += 2) bricks.push(
    brick(0, 1, z, 1, 2), brick(1, 1, z, 2, 2), brick(3, 1, z, 2, 2), brick(5, 1, z, 1, 2),
  );
  const plan = createAssemblyPlan({ brickModel: model(bricks) });

  assert.deepEqual(plan.steps.map(({ newBrickIds }) => newBrickIds.length), [3, 12, 4]);
  assert.equal(plan.steps.every((step) => new Set(step.newBrickIds.map((id) => plan.bricks.find((item) => item.id === id).y)).size === 1), true);
  assert.equal(plan.stats.rootFailureCount, 0);
  assert.equal(plan.stats.unresolvedBrickCount, 0);
});

test('local progress starts with a larger touching base patch and finishes attached work before distant seeds', () => {
  const source = model([
    brick(0, 0, 0, 2, 4),
    brick(2, 0, 0, 2, 4),
    brick(1, 1, 0, 2, 2),
    brick(0, 0, -6, 1, 1, 'orange'),
    brick(0, 0, -5, 1, 1, 'white'),
    brick(0, 1, -6, 1, 8),
  ]);
  const legacy = createAssemblyPlan({ brickModel: source });
  const local = createAssemblyPlan({ brickModel: source, preferLocalProgress: true });
  const byId = new Map(local.bricks.map((item) => [item.id, item]));
  const firstBricks = local.steps[0].newBrickIds.map((id) => byId.get(id));
  const localUpperStep = local.steps.findIndex((step) => step.newBrickIds.some((id) => id.includes('1,1,0:2x2')));
  const seedSteps = ['white', 'orange'].map((color) => local.steps.findIndex((step) => step.newBrickIds
    .some((id) => byId.get(id).color === color)));

  assert.deepEqual(firstBricks.map(({ w, d, color }) => ({ w, d, color })), [
    { w: 2, d: 4, color: 'red' }, { w: 2, d: 4, color: 'red' },
  ]);
  assert.equal(localUpperStep, 1);
  assert.equal(seedSteps.every((stepIndex) => stepIndex > localUpperStep), true);
  assert.equal(seedSteps[0] !== seedSteps[1], true, 'different-color ground seeds remain separate diagrams');
  assert.equal(local.graph.edges.some(({ a, b }) => [a, b].every((id) => ['white', 'orange'].includes(byId.get(id).color))), false,
    'same-course face touch must not become a stud-connection edge');
  assert.equal(local.steps.every((step) => new Set(step.newBrickIds.map((id) => byId.get(id).y)).size <= 1), true);
  assert.equal(local.steps.every((step) => new Set(step.newBrickIds.map((id) => byId.get(id).color)).size <= 1), true);
  assert.deepEqual(local.bricks, legacy.bricks);
  assert.deepEqual(local.graph, legacy.graph);
  assert.deepEqual(
    (({ rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount }) =>
      ({ rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount }))(local.stats),
    (({ rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount }) =>
      ({ rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount }))(legacy.stats),
  );
  const introduced = local.steps.flatMap(({ newBrickIds }) => newBrickIds);
  assert.equal(introduced.length, local.bricks.length);
  assert.equal(new Set(introduced).size, local.bricks.length);
  assert.equal(local.stats.coverageComplete, true);
});

test('local foundation preference starts nearby ground work before climbing a tower', () => {
  const source = model([
    brick(0, 0, 0, 2, 2), brick(0, 1, 0, 2, 2), brick(0, 2, 0, 2, 2),
    brick(0, 0, 4, 2, 2), brick(0, 1, 4, 2, 2), brick(0, 2, 4, 2, 2),
    brick(0, 3, 1, 2, 4),
  ]);
  const implicit = createAssemblyPlan({ brickModel: source, preferLocalProgress: true });
  const explicitLegacy = createAssemblyPlan({
    brickModel: source,
    preferLocalProgress: true,
    preferLocalFoundations: false,
  });
  const foundation = createAssemblyPlan({
    brickModel: source,
    preferLocalProgress: true,
    preferLocalFoundations: true,
  });
  const stepFor = (plan, fragment) => plan.steps.findIndex(({ newBrickIds }) =>
    newBrickIds.some((id) => id.includes(fragment)));

  assert.deepEqual(withoutTiming(implicit), withoutTiming(explicitLegacy));
  assert.ok(stepFor(implicit, '0,0,4:2x2') > stepFor(implicit, '0,2,0:2x2'));
  assert.ok(stepFor(foundation, '0,0,4:2x2') < stepFor(foundation, '0,1,0:2x2'));
  assert.deepEqual(foundation.bricks, implicit.bricks);
  assert.deepEqual(foundation.graph, implicit.graph);
  assert.equal(foundation.stats.coverageComplete, true);
  for (const metric of ['rootFailureCount', 'unresolvedBrickCount', 'blockedJoinCount', 'temporaryHoldStepCount']) {
    assert.equal(foundation.stats[metric], implicit.stats[metric]);
  }
});

test('independent grounded stud components become separate local build areas', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 2, 2), brick(0, 1, 0, 2, 2),
    brick(10, 0, 0, 2, 2, 'blue'), brick(10, 1, 0, 2, 2, 'blue'),
  ]) });

  assert.equal(plan.graph.components.length, 2);
  assert.equal(plan.graph.components.every(({ grounded }) => grounded), true);
  assert.equal(plan.modules.length, 2);
  assert.equal(plan.modules.every(({ kind, status }) => kind === 'grounded' && status === 'ready'), true);
  for (const module of plan.modules) {
    const moduleSteps = plan.steps.filter((step) => step.moduleId === module.id);
    assert.equal(moduleSteps.every((step) => step.visibleBrickIds.every((id) => module.brickIds.includes(id))), true);
  }
});

test('edge-adjacent grounded components become one contextual build area before an overhang blocks the floor', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 2, 2),
    brick(0, 1, 0, 2, 2),
    brick(0, 2, 0, 4, 2),
    brick(2, 0, 0, 2, 2, 'blue'),
  ]) });
  const shared = plan.modules.find(({ groupType }) => groupType === 'shared-ground-layout');
  const groundIds = plan.bricks.filter(({ y }) => y === 0).map(({ id }) => id);
  const sharedSteps = plan.steps.filter(({ moduleId }) => moduleId === shared.id);
  const overhangId = plan.bricks.find(({ y }) => y === 2).id;
  const overhangStep = sharedSteps.findIndex(({ newBrickIds }) => newBrickIds.includes(overhangId));

  assert.ok(shared);
  assert.deepEqual(new Set(shared.brickIds), new Set(plan.bricks.map(({ id }) => id)));
  assert.equal(shared.componentIds.length, 2);
  assert.equal(sharedSteps.every(({ kind, issues }) => kind === 'build' && issues.length === 0), true);
  assert.equal(groundIds.every((id) => sharedSteps.slice(0, overhangStep + 1)
    .some(({ newBrickIds }) => newBrickIds.includes(id))), true);
  assert.deepEqual(new Set(sharedSteps.at(-1).visibleBrickIds), new Set(shared.brickIds));
  assert.equal(plan.stats.unresolvedBrickCount, 0);
  assert.equal(plan.stats.coverageComplete, true);
});

test('a groundless cluster is built as handled work and ends with an explicit unresolved join', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 2, 2),
    brick(8, 3, 0, 2, 2, 'yellow'), brick(8, 4, 0, 2, 2, 'yellow'),
  ]) });
  const floating = plan.modules.find(({ kind }) => kind === 'floating');
  assert.ok(floating);
  assert.equal(floating.status, 'unresolved');
  const floatingSteps = plan.steps.filter(({ moduleId }) => moduleId === floating.id);
  assert.equal(floatingSteps.at(-1).kind, 'unresolved');
  assert.equal(floatingSteps.at(-1).newBrickIds.length, 0);
  assert.equal(floatingSteps.at(-1).issues.some(({ code }) => code === 'no-stud-engagement'), true);
  assert.equal(floatingSteps.some((step) => step.issues.some(({ code }) => code === 'temporary-hold')), true);
  assert.equal(plan.stats.unresolvedBrickCount, 2);
});

test('a small elevated color detail is a valid explicit join when supported from below', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 2, 2, 'red'),
    brick(0, 1, 0, 2, 2, 'red'),
    brick(0, 2, 0, 1, 1, 'yellow'),
  ]) });
  const detail = plan.modules.find(({ kind }) => kind === 'detail');
  assert.ok(detail);
  assert.equal(detail.status, 'ready');
  const join = plan.steps.find(({ moduleId, kind }) => moduleId === detail.id && kind === 'join');
  assert.ok(join);
  assert.deepEqual(join.newBrickIds, []);
  assert.equal(join.highlightBrickIds.length, 1);
  assert.equal(plan.stats.validJoinCount, 1);
  assert.equal(plan.stats.joinStudCount, 1);
});

test('a substantial clear upper branch becomes a handled section with visible dependency steps', () => {
  const tower = Array.from({ length: 28 }, (_, y) => brick(0, y, 0));
  const plan = createAssemblyPlan({ brickModel: model(tower) });
  const upper = plan.modules.find(({ label }) => label.startsWith('Upper section'));
  assert.ok(upper);
  assert.equal(upper.brickIds.length, 12);
  assert.equal(upper.status, 'ready');
  const buildSteps = plan.steps.filter(({ moduleId, kind }) => moduleId === upper.id && kind === 'build');
  assert.equal(buildSteps.length, 12);
  assert.equal(buildSteps.every(({ newBrickIds }) => newBrickIds.length === 1), true);
  assert.equal(plan.steps.some(({ moduleId, kind }) => moduleId === upper.id && kind === 'join'), true);
});

test('a floating cluster trapped below an overhang remains visibly unresolved', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'red'),
    brick(0, 2, 0, 1, 1, 'red'),
    brick(0, 3, 0, 2, 1, 'red'),
    brick(1, 1, 0, 1, 1, 'yellow'),
  ]) });
  const floating = plan.modules.find(({ kind }) => kind === 'floating');
  assert.ok(floating);
  assert.equal(floating.status, 'unresolved');
  const finalJoin = plan.steps.filter(({ moduleId }) => moduleId === floating.id).at(-1);
  assert.equal(finalJoin.kind, 'unresolved');
  assert.equal(finalJoin.issues.some(({ code }) => code === 'blocked-module-insertion'), true);
  assert.equal(plan.stats.blockedJoinCount, 1);
  assert.equal(plan.stats.validJoinCount, 0);
});

test('unsupported in-place seeds and additions that depend on them stay unresolved', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'red'),
    brick(0, 2, 0, 3, 1, 'red'),
    brick(1, 1, 0, 1, 1, 'red'),
    brick(2, 1, 0, 1, 1, 'red'),
  ]) });
  const rootFailures = plan.steps.flatMap((step) => step.issues).filter(({ code }) => code === 'unsupported-addition');
  const dependentFailures = plan.steps.flatMap((step) => step.issues).filter(({ code }) => code === 'unresolved-prerequisite');
  assert.equal(rootFailures.length, 2);
  assert.equal(dependentFailures.length, 1);
  assert.equal(plan.stats.rootFailureCount, 2);
  assert.equal(plan.steps.flatMap((step) => step.issues).some(({ code }) => code === 'temporary-hold'), false);
  const rootStep = plan.steps.findIndex((step) => step.issues.some(({ code }) => code === 'unsupported-addition'));
  const captureStep = plan.steps.findIndex((step) => step.issues.some(({ code }) => code === 'unresolved-prerequisite'));
  assert.ok(rootStep >= 0 && captureStep >= rootStep, 'lower failures must be exposed before the overhang closes their insertion paths');
  assert.equal(plan.steps.some((step) => step.kind === 'build'
    && step.newBrickIds.some((id) => id.includes('1,1,0') || id.includes('2,1,0') || id.includes('0,2,0'))), false);
});

test('under-attachments are opt-in and preserve the legacy downward-only result by default', () => {
  const source = model([
    brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0, 2, 1), brick(1, 1, 0),
  ]);
  const implicit = createAssemblyPlan({ brickModel: source });
  const explicit = createAssemblyPlan({
    brickModel: source,
    allowUnderAttachments: false,
    preferLocalProgress: false,
  });

  assert.deepEqual(withoutTiming(implicit), withoutTiming(explicit));
  assert.equal(implicit.stats.rootFailureCount, 1);
  assert.equal(implicit.stats.unresolvedBrickCount, 2);
  assert.equal(implicit.stats.upwardInsertionBrickCount, 0);
  assert.equal(implicit.steps.some(({ insertionDirection }) => insertionDirection === 'up'), false);
  assert.throws(() => createAssemblyPlan({ brickModel: source, preferLocalProgress: 'yes' }), /must be a boolean/);
});

test('a clear hanging brick can attach upward after its independently supported bridge', () => {
  const plan = createAssemblyPlan({
    brickModel: model([
      brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0, 2, 1), brick(1, 1, 0),
    ]),
    allowUnderAttachments: true,
  });
  const introduced = plan.steps.flatMap(({ newBrickIds }) => newBrickIds);
  const bridgeStep = plan.steps.findIndex(({ newBrickIds }) => newBrickIds.some((id) => id.includes('0,2,0:2x1')));
  const hangingStep = plan.steps.findIndex(({ insertionDirection }) => insertionDirection === 'up');

  assert.equal(plan.stats.rootFailureCount, 0);
  assert.equal(plan.stats.unresolvedBrickCount, 0);
  assert.equal(plan.stats.upwardInsertionBrickCount, 1);
  assert.equal(plan.steps[hangingStep].newBrickIds.some((id) => id.includes('1,1,0:1x1')), true);
  assert.ok(bridgeStep >= 0 && hangingStep === bridgeStep + 1);
  assert.equal(plan.steps[bridgeStep].newBrickIds.length, 1);
  assert.equal(plan.steps[hangingStep].newBrickIds.length, 1);
  assert.equal(plan.steps[bridgeStep].insertionDirection, undefined);
  assert.equal(plan.steps[hangingStep].issues.some(({ code }) => code === 'temporary-hold'), false);
  assert.equal(introduced.length, plan.bricks.length);
  assert.equal(new Set(introduced).size, plan.bricks.length);
  assert.equal(plan.stats.coverageComplete, true);
});

test('an occupied floor-to-target sweep keeps a hanging brick unresolved', () => {
  const plan = createAssemblyPlan({
    brickModel: model([
      brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0), brick(0, 3, 0, 2, 1),
      brick(1, 2, 0), brick(1, 0, 0, 1, 1, 'blue'),
    ]),
    allowUnderAttachments: true,
  });

  assert.equal(plan.stats.upwardInsertionBrickCount, 0);
  assert.equal(plan.steps.flatMap(({ issues }) => issues).some(({ code }) => code === 'unsupported-addition'), true);
});

test('under-attachments require direct engagement and one independently recoverable blocker', () => {
  const noUpperEngagement = createAssemblyPlan({
    brickModel: model([brick(0, 0, 0), brick(4, 2, 0)]),
    allowUnderAttachments: true,
  });
  const twoBlockers = createAssemblyPlan({
    brickModel: model([
      brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0, 3, 1),
      brick(1, 1, 0), brick(2, 1, 0),
    ]),
    allowUnderAttachments: true,
  });

  assert.equal(noUpperEngagement.stats.upwardInsertionBrickCount, 0);
  assert.equal(noUpperEngagement.stats.unresolvedBrickCount, 1);
  assert.equal(twoBlockers.stats.upwardInsertionBrickCount, 0);
  assert.equal(twoBlockers.stats.rootFailureCount, 2);
  assert.equal(twoBlockers.stats.coverageComplete, true);
});

test('an upper brick without an independent valid support cannot authorize an under-attachment', () => {
  const plan = createAssemblyPlan({
    brickModel: model([
      brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0), brick(0, 3, 0),
      brick(0, 4, 0, 3, 1), brick(1, 3, 0, 2, 1),
      brick(1, 2, 0), brick(2, 2, 0),
    ]),
    allowUnderAttachments: true,
  });
  const invalidUpper = plan.steps.find(({ newBrickIds }) => newBrickIds.some((id) => id.includes('1,3,0:2x1')));

  assert.equal(plan.stats.upwardInsertionBrickCount, 0);
  assert.equal(plan.stats.rootFailureCount, 2);
  assert.equal(invalidUpper.kind, 'unresolved');
  assert.equal(invalidUpper.issues.some(({ code }) => code === 'unresolved-prerequisite'), true);
  assert.equal(plan.stats.coverageComplete, true);
});

test('under-attachment option rejects non-boolean values', () => {
  assert.throws(
    () => createAssemblyPlan({ brickModel: model([brick(0, 0, 0)]), allowUnderAttachments: 'yes' }),
    /allowUnderAttachments must be a boolean/,
  );
});

test('side contact is not treated as stud engagement and invalid models fail closed', () => {
  const side = createAssemblyPlan({ brickModel: model([brick(0, 0, 0), brick(1, 0, 0)]) });
  assert.equal(side.graph.edges.length, 0);
  assert.equal(side.graph.components.length, 2);
  assert.throws(
    () => createAssemblyPlan({ brickModel: model([brick(0, 0, 0, 2, 2), brick(1, 0, 1)]) }),
    /collision/,
  );
});
