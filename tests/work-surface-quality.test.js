import test from 'node:test';
import assert from 'node:assert/strict';

import { assessWorkSurfaceQuality } from '../src/work-surface-quality.js';

function brick(id, x, y, z, w = 1, d = 1, color = 'red') {
  return { id, x, y, z, w, d, color };
}

function workSurfacePlan(order = ['left', 'right', 'bridge'], { oneStep = false } = {}) {
  const bricks = [
    brick('left', 0, 1, 0, 1, 1, 'blue'),
    brick('right', 1, 1, 0, 1, 1, 'yellow'),
    brick('bridge', 0, 2, 0, 2, 1, 'orange'),
  ];
  const steps = oneStep
    ? [{ id: 'diagram-1', moduleId: 'work', newBrickIds: [...order] }]
    : order.map((id, index) => ({ id: `step-${index + 1}`, moduleId: 'work', newBrickIds: [id] }));
  return {
    version: 1,
    bricks,
    modules: [{ id: 'work', brickIds: bricks.map(({ id }) => id), buildContext: { kind: 'work-surface' } }],
    steps,
    graph: { edges: [
      { a: 'left', b: 'bridge', studs: 1 },
      { a: 'right', b: 'bridge', studs: 1 },
    ] },
  };
}

test('distinguishes loose-floor exposure from an interleaved bond on the same stud graph', () => {
  const looseFirst = assessWorkSurfaceQuality(workSurfacePlan(['left', 'right', 'bridge']));
  const interleaved = assessWorkSurfaceQuality(workSurfacePlan(['left', 'bridge', 'right']));

  assert.deepEqual(looseFirst.aggregate, {
    introducedBrickCount: 3,
    peakComponentCount: 2,
    peakDetachedBrickCount: 1,
    peakStepDetachedBrickCount: 1,
    detachedBrickExposure: 1,
    peakLooseBrickCount: 2,
    firstBondAtAddition: 3,
    finalComponentCount: 1,
  });
  assert.deepEqual(interleaved.aggregate, {
    introducedBrickCount: 3,
    peakComponentCount: 1,
    peakDetachedBrickCount: 0,
    peakStepDetachedBrickCount: 0,
    detachedBrickExposure: 0,
    peakLooseBrickCount: 1,
    firstBondAtAddition: 2,
    finalComponentCount: 1,
  });
  assert.deepEqual(looseFirst.modules[0].stepStates.map(({ componentCount, detachedBrickCount, looseBrickCount }) => (
    { componentCount, detachedBrickCount, looseBrickCount }
  )), [
    { componentCount: 1, detachedBrickCount: 0, looseBrickCount: 1 },
    { componentCount: 2, detachedBrickCount: 1, looseBrickCount: 2 },
    { componentCount: 1, detachedBrickCount: 0, looseBrickCount: 0 },
  ]);
});

test('ordered operations replace the enclosing diagram additions without hiding physical exposure', () => {
  const plan = workSurfacePlan([], { oneStep: true });
  plan.steps[0] = {
    id: 'diagram-1',
    moduleId: 'work',
    newBrickIds: ['not-a-real-brick'],
    orderedOperations: [
      { id: 'source-1', newBrickIds: ['left'] },
      { id: 'source-2', newBrickIds: ['right'] },
      { id: 'source-3', newBrickIds: ['bridge'] },
    ],
  };
  const quality = assessWorkSurfaceQuality(plan);

  assert.equal(quality.aggregate.detachedBrickExposure, 1, 'per-brick physical exposure is retained');
  assert.equal(quality.aggregate.peakDetachedBrickCount, 1);
  assert.equal(quality.aggregate.peakStepDetachedBrickCount, 0, 'the printed boundary ends after the bond');
  assert.deepEqual(quality.modules[0].stepStates, [{
    stepId: 'diagram-1',
    introducedBrickCount: 3,
    componentCount: 1,
    detachedBrickCount: 0,
    looseBrickCount: 0,
  }]);
});

test('retains final isolated components and their loose-brick workload', () => {
  const plan = workSurfacePlan(['left', 'bridge', 'right']);
  plan.graph.edges.pop();
  const quality = assessWorkSurfaceQuality(plan);

  assert.equal(quality.aggregate.finalComponentCount, 2);
  assert.equal(quality.aggregate.peakDetachedBrickCount, 1);
  assert.equal(quality.aggregate.detachedBrickExposure, 1);
  assert.equal(quality.aggregate.peakLooseBrickCount, 1);
  assert.equal(quality.aggregate.firstBondAtAddition, 2);
});

test('metrics are invariant to stable ID, palette, translation, and quarter-turn changes', () => {
  const source = workSurfacePlan(['left', 'right', 'bridge']);
  const rename = new Map(source.bricks.map(({ id }, index) => [id, `part-${index + 7}`]));
  const transformed = {
    ...structuredClone(source),
    bricks: source.bricks.map((item, index) => ({
      ...item,
      id: rename.get(item.id),
      x: 20 - item.z - item.d,
      z: -7 + item.x,
      w: item.d,
      d: item.w,
      color: ['white', 'green', 'brown'][index],
    })),
    modules: source.modules.map((module) => ({
      ...module,
      id: 'rotated-work',
      brickIds: module.brickIds.map((id) => rename.get(id)),
    })),
    steps: source.steps.map((step, index) => ({
      ...step,
      id: `operation-${index + 10}`,
      moduleId: 'rotated-work',
      newBrickIds: step.newBrickIds.map((id) => rename.get(id)),
    })),
    graph: { edges: source.graph.edges.map((edge) => ({
      ...edge,
      a: rename.get(edge.a),
      b: rename.get(edge.b),
    })) },
  };
  const before = structuredClone(transformed);

  assert.deepEqual(assessWorkSurfaceQuality(transformed).aggregate, assessWorkSurfaceQuality(source).aggregate);
  assert.deepEqual(transformed, before);
});

test('a valid plan without a work-surface module returns a stable empty report', () => {
  const plan = workSurfacePlan();
  plan.modules[0] = { ...plan.modules[0], buildContext: undefined };
  const quality = assessWorkSurfaceQuality(plan);

  assert.equal(quality.moduleCount, 0);
  assert.deepEqual(quality.modules, []);
  assert.deepEqual(quality.aggregate, {
    introducedBrickCount: 0,
    peakComponentCount: 0,
    peakDetachedBrickCount: 0,
    peakStepDetachedBrickCount: 0,
    detachedBrickExposure: 0,
    peakLooseBrickCount: 0,
    firstBondAtAddition: null,
    finalComponentCount: 0,
  });
});

test('malformed graph and replay coverage fail clearly instead of inferring contacts', () => {
  const missingGraph = workSurfacePlan();
  delete missingGraph.graph;
  assert.throws(() => assessWorkSurfaceQuality(missingGraph), /graph\.edges/);

  const faceContact = workSurfacePlan();
  faceContact.graph.edges = [{ a: 'left', b: 'right', studs: 1 }];
  assert.throws(() => assessWorkSurfaceQuality(faceContact), /does not match adjacent brick footprints/);

  const duplicateBrick = workSurfacePlan();
  duplicateBrick.steps.push({ id: 'step-4', moduleId: 'work', newBrickIds: ['left'] });
  assert.throws(() => assessWorkSurfaceQuality(duplicateBrick), /introduced more than once/);

  const repeatedOperation = workSurfacePlan();
  repeatedOperation.steps = [{
    id: 'diagram-1',
    moduleId: 'work',
    newBrickIds: [],
    orderedOperations: [
      { id: 'source-1', newBrickIds: ['left'] },
      { id: 'source-1', newBrickIds: ['right'] },
    ],
  }];
  assert.throws(() => assessWorkSurfaceQuality(repeatedOperation), /Repeated operation ID source-1/);
});
