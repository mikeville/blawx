import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { mapAssemblyModules } from '../src/assembly-module-replay.js';

const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

function withoutTiming(plan) {
  const copy = structuredClone(plan);
  delete copy.stats.planningMs;
  return copy;
}

function rotate(source, turns, colors = {}) {
  let item = { ...source };
  for (let turn = 0; turn < turns; turn += 1) item = {
    ...item,
    x: -item.z - item.d,
    z: item.x,
    w: item.d,
    d: item.w,
  };
  return { ...item, color: colors[item.color] ?? item.color };
}

function joiningFixture(turns = 0) {
  const transform = (item) => rotate(item, turns, { red: 'blue', yellow: 'tan' });
  const source = [
    brick(0, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'red'),
    brick(2, 2, 0, 1, 1, 'yellow'),
    brick(2, 3, 0, 1, 1, 'yellow'),
  ].map(transform);
  const replacement = transform(brick(0, 2, 0, 3, 1, 'yellow'));
  return {
    source,
    proposal: {
      before: [source[2]],
      after: [replacement],
      bricks: [source[0], source[1], replacement, source[3]],
    },
  };
}

test('local ownership replay preserves module order and recomputes a newly valid handled join without mutation', () => {
  for (let turns = 0; turns < 4; turns += 1) {
    const { source, proposal } = joiningFixture(turns);
    const beforePlan = createAssemblyPlan({ brickModel: model(source) });
    const snapshot = structuredClone(beforePlan);
    const moduleReplay = mapAssemblyModules(beforePlan, proposal);
    const candidate = createAssemblyPlan({
      brickModel: model(proposal.bricks),
      moduleReplay,
      preferLocalProgress: true,
      preferLocalFoundations: true,
    });

    assert.deepEqual(beforePlan, snapshot);
    assert.deepEqual(candidate.modules.map(({ id }) => id), beforePlan.modules.map(({ id }) => id));
    assert.equal(candidate.modules[1].kind, 'detail');
    assert.match(candidate.modules[1].label, /^Assembly /);
    const join = candidate.steps.find((step) => step.moduleId === candidate.modules[1].id && step.kind === 'join');
    assert.ok(join);
    assert.equal(join.issues.some(({ severity }) => severity === 'error'), false);
    assert.ok(candidate.stats.joinStudCount > 0);
    assert.equal(candidate.stats.coverageComplete, true);
    assert.deepEqual(moduleReplay[0].brickOrder, beforePlan.steps
      .filter((step) => step.moduleId === beforePlan.modules[0].id).flatMap((step) => step.newBrickIds));
  }
});

test('module replay ranks retain an unaffected physical addition recipe after a local replacement', () => {
  const { source, proposal } = joiningFixture();
  source.unshift(brick(5, 0, 0, 2, 2, 'green'), brick(5, 1, 0, 2, 2, 'green'));
  proposal.bricks.unshift(source[0], source[1]);
  const beforePlan = createAssemblyPlan({ brickModel: model(source), preferLocalProgress: true, preferLocalFoundations: true });
  const moduleReplay = mapAssemblyModules(beforePlan, proposal);
  const candidate = createAssemblyPlan({
    brickModel: model(proposal.bricks), moduleReplay, preferLocalProgress: true, preferLocalFoundations: true,
  });
  const changedModule = beforePlan.modules.find((module) => module.brickIds.includes(beforePlan.bricks
    .find((item) => item.x === 2 && item.y === 2).id));
  const operations = (plan, moduleId) => plan.steps.filter((step) => step.moduleId === moduleId)
    .flatMap((step) => step.newBrickIds);
  for (const module of beforePlan.modules.filter(({ id }) => id !== changedModule.id)) {
    assert.deepEqual(operations(candidate, module.id), operations(beforePlan, module.id));
  }
});

test('a disconnected review group stays unresolved even when its pieces connect through an outside path', () => {
  const brickModel = model([
    brick(0, 0, 0, 2, 1), brick(0, 1, 0, 2, 1),
    brick(0, 2, 0, 1, 1, 'yellow'), brick(1, 2, 0, 1, 1, 'yellow'),
  ]);
  const identified = createAssemblyPlan({ brickModel }).bricks;
  const coreIds = identified.filter(({ y }) => y < 2).map(({ id }) => id);
  const reviewIds = identified.filter(({ y }) => y === 2).map(({ id }) => id);
  const plan = createAssemblyPlan({
    brickModel,
    moduleReplay: [
      { id: 'core', label: 'Build area', kind: 'grounded', brickIds: coreIds, brickOrder: coreIds },
      {
        id: 'review', label: 'Unresolved detached parts', kind: 'floating', groupType: 'detached-parts',
        brickIds: reviewIds, brickOrder: reviewIds,
      },
    ],
  });
  const join = plan.steps.find((step) => step.moduleId === 'review' && step.newBrickIds.length === 0);
  assert.equal(join.kind, 'unresolved');
  assert.equal(join.issues.some(({ code }) => code === 'disconnected-clusters'), true);
  assert.equal(plan.modules.find(({ id }) => id === 'review').status, 'unresolved');
});

test('replay cannot turn an impossible insertion into a successful join', () => {
  const source = [
    brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0), brick(0, 3, 0, 2, 1),
    brick(1, 1, 0, 1, 1, 'yellow'),
  ];
  const beforePlan = createAssemblyPlan({ brickModel: model(source) });
  const proposal = { before: [source[4]], after: [{ ...source[4] }], bricks: source };
  const candidate = createAssemblyPlan({ brickModel: model(source), moduleReplay: mapAssemblyModules(beforePlan, proposal) });
  const floating = candidate.modules.find(({ kind }) => kind === 'floating');
  const join = candidate.steps.filter(({ moduleId }) => moduleId === floating.id).at(-1);
  assert.equal(join.kind, 'unresolved');
  assert.equal(join.issues.some(({ code }) => code === 'blocked-module-insertion'), true);
});

test('default planning is unchanged when module replay is absent', () => {
  const source = model([
    brick(0, 0, 0, 2, 2), brick(0, 1, 0, 2, 2), brick(0, 2, 0, 1, 1, 'blue'),
  ]);
  assert.deepEqual(withoutTiming(createAssemblyPlan({ brickModel: source })),
    withoutTiming(createAssemblyPlan({ brickModel: source, moduleReplay: null })));
});

test('invalid ownership, coverage, recipe, context, and double work-surface inputs fail closed', () => {
  const separated = [brick(0, 0, 0), brick(4, 0, 0, 1, 1, 'blue')];
  const separatePlan = createAssemblyPlan({ brickModel: model(separated) });
  assert.throws(() => mapAssemblyModules(separatePlan, {
    before: separated,
    after: separated,
    bricks: separated,
  }), /cannot cross module boundaries/);

  const { source, proposal } = joiningFixture();
  const beforePlan = createAssemblyPlan({ brickModel: model(source) });
  assert.throws(() => mapAssemblyModules(beforePlan, {
    ...proposal, after: [{ ...proposal.after[0], color: 'green' }],
  }), /recolors occupied cell/);
  assert.throws(() => mapAssemblyModules(beforePlan, {
    ...proposal, after: [brick(8, 2, 0, 1, 1, 'tan')],
  }), /must overlap old cells/);
  assert.throws(() => mapAssemblyModules(beforePlan, {
    ...proposal, after: [brick(1, 2, 0, 1, 1, 'tan')],
  }), /must overlap old cells|removes or recolors occupied cell/);

  const replay = mapAssemblyModules(beforePlan, proposal);
  const duplicate = structuredClone(replay);
  duplicate[1].brickIds.push(duplicate[0].brickIds[0]);
  duplicate[1].brickOrder.push(duplicate[0].brickIds[0]);
  assert.throws(() => createAssemblyPlan({ brickModel: model(proposal.bricks), moduleReplay: duplicate }), /multiple modules/);
  const badOrder = structuredClone(replay);
  badOrder[0].brickOrder.pop();
  assert.throws(() => createAssemblyPlan({ brickModel: model(proposal.bricks), moduleReplay: badOrder }), /brickOrder must exactly match/);
  assert.throws(() => createAssemblyPlan({
    brickModel: model(proposal.bricks), moduleReplay: replay, workSurfaceBrickIds: replay[0].brickIds,
  }), /cannot be combined/);

  const invalidGrounded = structuredClone(replay);
  invalidGrounded[1].kind = 'grounded';
  assert.throws(() => createAssemblyPlan({ brickModel: model(proposal.bricks), moduleReplay: invalidGrounded }), /must contain a ground-course brick/);
  const invalidContext = structuredClone(replay);
  invalidContext[1].buildContext = { kind: 'work-surface', floorY: 2 };
  assert.throws(() => createAssemblyPlan({ brickModel: model(proposal.bricks), moduleReplay: invalidContext }), /outside a work-surface/);
});

test('a grounded replay descriptor cannot absorb an unrelated floating component', () => {
  const brickModel = model([brick(0, 0, 0), brick(5, 2, 0, 1, 1, 'blue')]);
  const ids = createAssemblyPlan({ brickModel }).bricks.map(({ id }) => id);
  assert.throws(() => createAssemblyPlan({
    brickModel,
    moduleReplay: [{ id: 'unsafe', label: 'Build area', kind: 'grounded', brickIds: ids, brickOrder: ids }],
  }), /cannot include a groundless stud component/);
});

test('replay retains an existing rectangular work-surface recipe without a second band split', () => {
  const bricks = [
    brick(0, 0, 0, 4, 1),
    brick(0, 1, 0, 2, 1, 'blue'), brick(2, 1, 0, 2, 1, 'blue'),
    brick(0, 2, 0, 4, 1, 'blue'),
  ];
  const brickModel = model(bricks);
  const identified = createAssemblyPlan({ brickModel }).bricks;
  const bandIds = identified.filter(({ y }) => y > 0).map(({ id }) => id);
  const beforePlan = createAssemblyPlan({
    brickModel, workSurfaceBrickIds: bandIds, workSurfaceOrder: 'rectangular-layers',
  });
  const proposal = { before: [bricks[0]], after: [{ ...bricks[0] }], bricks };
  const moduleReplay = mapAssemblyModules(beforePlan, proposal);
  const candidate = createAssemblyPlan({ brickModel, moduleReplay });
  const band = beforePlan.modules.find((module) => module.buildContext?.kind === 'work-surface');
  const recipe = (plan) => plan.steps.filter((step) => step.moduleId === band.id)
    .map(({ kind, newBrickIds, insertionDirection }) => ({ kind, newBrickIds, insertionDirection }));
  assert.deepEqual(recipe(candidate), recipe(beforePlan));
  assert.deepEqual(candidate.modules.find(({ id }) => id === band.id).buildContext, band.buildContext);
});
