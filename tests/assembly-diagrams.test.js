import test from 'node:test';
import assert from 'node:assert/strict';

import { compactAssemblyPlan } from '../src/assembly-diagrams.js';

function makePlan({
  bricks,
  stepBrickIds,
  stepKinds = [],
  stepIssues = [],
  stepHighlightIds = [],
  directions = [],
  moduleBuildContext,
  graphEdges = [],
}) {
  const byId = new Map(bricks.map((brick) => [brick.id, brick]));
  const visible = [];
  const steps = stepBrickIds.map((newBrickIds, index) => {
    for (const id of newBrickIds) {
      assert.ok(byId.has(id));
      visible.push(id);
    }
    const kind = stepKinds[index] ?? 'build';
    return {
      id: `step-${index + 1}`,
      moduleId: 'module-1',
      label: kind === 'join' ? 'Join Build area 1' : `Build area 1 · add ${newBrickIds.length} bricks`,
      kind,
      newBrickIds: [...newBrickIds],
      visibleBrickIds: [...visible],
      highlightBrickIds: [...(stepHighlightIds[index] ?? newBrickIds)],
      issues: structuredClone(stepIssues[index] ?? []),
      ...(directions[index] ? { insertionDirection: directions[index] } : {}),
    };
  });
  return {
    version: 1,
    bricks,
    modules: [{
      id: 'module-1', label: 'Build area 1', brickIds: bricks.map(({ id }) => id), status: 'ready', kind: 'grounded',
      componentIds: ['component-1'], ...(moduleBuildContext ? { buildContext: moduleBuildContext } : {}),
    }],
    steps,
    inventory: [],
    graph: { edges: graphEdges, components: [] },
    stats: {
      brickCount: bricks.length,
      stepCount: steps.length,
      unresolvedStepCount: steps.filter(({ kind }) => kind === 'unresolved').length,
      unresolvedBrickCount: 0,
      rootFailureCount: 0,
      blockedJoinCount: 0,
      coverageComplete: true,
      maxBricksPerStep: Math.max(...stepBrickIds.map(({ length }) => length)),
      planReferenceCount: 0,
    },
    limitations: [],
  };
}

const brick = (id, x, y, z, w, d, color = 'orange') => ({ id, x, y, z, w, d, color });

function connectedPatchPlan({ orderPolicy = 'connected-patches' } = {}) {
  const floor = Array.from({ length: 7 }, (_, index) => brick(`floor-${index}`, index, 2, 0, 1, 1));
  const bonds = Array.from({ length: 6 }, (_, index) => brick(`bond-${index}`, index, 3, 0, 2, 1));
  const stepBrickIds = [['floor-0', 'floor-1'], ['bond-0']];
  for (let index = 2; index < floor.length; index += 1) {
    stepBrickIds.push([`floor-${index}`], [`bond-${index - 1}`]);
  }
  const graphEdges = [];
  for (let index = 0; index < bonds.length; index += 1) {
    graphEdges.push(
      { a: `floor-${index}`, b: `bond-${index}`, studs: 1 },
      { a: `floor-${index + 1}`, b: `bond-${index}`, studs: 1 },
    );
  }
  return makePlan({
    bricks: [...floor, ...bonds],
    stepBrickIds,
    graphEdges,
    moduleBuildContext: { kind: 'work-surface', floorY: 2, orderPolicy },
  });
}

function cumulativeComponentsAtDiagramEnds(plan) {
  const adjacency = new Map(plan.bricks.map(({ id }) => [id, new Set()]));
  for (const { a, b } of plan.graph.edges) {
    adjacency.get(a).add(b);
    adjacency.get(b).add(a);
  }
  const placed = new Set();
  return plan.steps.map((step) => {
    for (const brickId of step.newBrickIds) placed.add(brickId);
    if (!placed.size) return 0;
    let components = 0;
    const reached = new Set();
    for (const start of placed) {
      if (reached.has(start)) continue;
      components += 1;
      reached.add(start);
      const pending = [start];
      while (pending.length) {
        const current = pending.pop();
        for (const next of adjacency.get(current)) if (placed.has(next) && !reached.has(next)) {
          reached.add(next);
          pending.push(next);
        }
      }
    }
    return components;
  });
}

test('compacts nearby clean steps despite varied rectangular footprints and preserves their internal order', () => {
  const plan = makePlan({
    bricks: [
      brick('a', 0, 2, 0, 3, 2),
      brick('b', 3, 2, 0, 4, 1),
      brick('c', 0, 2, 2, 2, 2),
      brick('d', 2, 2, 2, 3, 1),
      brick('e', 5, 2, 1, 1, 3),
      brick('f', 6, 2, 2, 2, 1),
    ],
    stepBrickIds: [['a', 'b', 'c', 'd', 'e'], ['f']],
  });
  const before = structuredClone(plan);
  const first = compactAssemblyPlan(plan);
  const second = compactAssemblyPlan(structuredClone(plan));

  assert.deepEqual(plan, before);
  assert.deepEqual(first, second);
  assert.equal(first.plan.steps.length, 1);
  assert.deepEqual(first.plan.steps[0].sourceStepIds, ['step-1', 'step-2']);
  assert.deepEqual(first.plan.steps[0].orderedOperations.map(({ id }) => id), ['step-1', 'step-2']);
  assert.deepEqual(first.plan.steps[0].newBrickIds, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(first.report.sourceStepCoverageComplete, true);
  assert.equal(first.report.brickCoverageComplete, true);
});

test('simple dependent courses can share a display diagram while retaining validated atomic operations', () => {
  const plan = makePlan({
    bricks: [
      brick('base', 0, 0, 0, 2, 4),
      brick('cap', 0, 1, 0, 1, 1),
      brick('top', 0, 2, 0, 1, 1),
    ],
    stepBrickIds: [['base'], ['cap'], ['top']],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.equal(compacted.steps.length, 1);
  assert.deepEqual(compacted.steps[0].sourceStepIds, ['step-1', 'step-2', 'step-3']);
  assert.deepEqual(compacted.steps[0].orderedOperations.map(({ newBrickIds }) => newBrickIds), [['base'], ['cap'], ['top']]);
  assert.deepEqual(compacted.steps[0].visibleBrickIds, ['base', 'cap', 'top']);
  assert.deepEqual(compacted.steps[0].highlightBrickIds, ['base', 'cap', 'top']);
  assert.equal(report.collapsedStepCount, 2);
});

test('rectangular layer policy preserves course boundaries while ordinary compaction stays flexible', () => {
  const input = {
    bricks: [brick('lower',0,2,0,2,2),brick('upper',0,3,0,2,2)],
    stepBrickIds: [['lower'],['upper']],
  };
  assert.equal(compactAssemblyPlan(makePlan(input)).plan.steps.length,1);
  const {plan,report}=compactAssemblyPlan(makePlan({...input,
    moduleBuildContext:{kind:'work-surface',floorY:2,orderPolicy:'rectangular-layers'}}));
  assert.equal(plan.steps.length,2);
  assert.equal(report.rejectedMergeCounts['rectangular-layer-boundary'],1);
  assert.deepEqual(plan.steps.flatMap(step=>step.sourceStepIds),['step-1','step-2']);
  assert.equal(report.brickCoverageComplete,true);
});

test('rectangular layer policy merges complete regions but keeps ragged unions separate', () => {
  const context={kind:'work-surface',floorY:2,orderPolicy:'rectangular-layers'};
  const base={bricks:[brick('a',0,2,0,4,2),brick('b',0,2,2,2,2)],
    stepBrickIds:[['a'],['b']],moduleBuildContext:context};
  const ragged=compactAssemblyPlan(makePlan(base));
  assert.equal(ragged.plan.steps.length,2);
  assert.equal(ragged.report.rejectedMergeCounts['rectangular-group-boundary'],1);
  const rectangle=compactAssemblyPlan(makePlan({...base,bricks:[base.bricks[0],{...base.bricks[1],w:4}]}));
  assert.equal(rectangle.plan.steps.length,1);
  assert.equal(rectangle.report.sourceStepCoverageComplete,true);
});

test('keeps a disconnected foundation separate while combining work attached to its new seed', () => {
  const plan = makePlan({
    bricks: [
      brick('foundation', 0, 0, 0, 2, 2, 'white'),
      brick('seed', 3, 0, 0, 1, 1),
      brick('bridge', 4, 0, 0, 1, 1),
    ],
    stepBrickIds: [['foundation'], ['seed'], ['bridge']],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [
    ['step-1'], ['step-2', 'step-3'],
  ]);
  assert.ok(report.rejectedMergeCounts['not-face-connected'] >= 1);
});

test('same-plane additions can connect through visible bricks built before the combined diagram', () => {
  const plan = makePlan({
    bricks: [
      brick('context', 1, 0, 0, 1, 1),
      brick('left', 0, 0, 0, 1, 1),
      brick('right', 2, 0, 0, 1, 1),
    ],
    stepBrickIds: [['context'], [], ['left'], ['right']],
    stepKinds: ['build', 'join', 'build', 'build'],
  });
  const { plan: compacted } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [
    ['step-1'], ['step-2'], ['step-3', 'step-4'],
  ]);
});

test('looks past temporary foundation gaps and stops at the latest connected visible endpoint', () => {
  const whiteFoot = [];
  for (let z = 0; z < 3; z += 1) for (let x = 0; x < 3; x += 1) {
    whiteFoot.push(brick(`white-${x}-${z}`, x, 0, z, 1, 1, 'white'));
  }
  const plan = makePlan({
    bricks: [
      ...whiteFoot,
      brick('seed', 4, 0, 0, 1, 2),
      brick('base-a', 6, 0, 0, 1, 2),
      brick('base-b', 8, 0, 0, 1, 2),
      brick('upper-bridge-a', 2, 1, 0, 4, 1),
      brick('upper-bridge-b', 6, 1, 0, 3, 1),
    ],
    stepBrickIds: [
      whiteFoot.map(({ id }) => id),
      ['seed'],
      ['base-a'],
      ['base-b'],
      ['upper-bridge-a', 'upper-bridge-b'],
    ],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [
    ['step-1'], ['step-2', 'step-3', 'step-4', 'step-5'],
  ]);
  assert.deepEqual(compacted.steps[1].orderedOperations.map(({ id }) => id), [
    'step-2', 'step-3', 'step-4', 'step-5',
  ]);
  assert.ok(report.rejectedMergeCounts['not-face-connected'] >= 2);
  assert.ok(report.rejectedMergeCounts['brick-limit'] >= 1);
});

test('connected-patch diagrams rewind before a trailing loose prerequisite and end stud-connected', () => {
  const source = connectedPatchPlan();
  const before = structuredClone(source);
  const first = compactAssemblyPlan(source);
  const second = compactAssemblyPlan(structuredClone(source));

  assert.deepEqual(source, before);
  assert.deepEqual(first, second);
  assert.deepEqual(first.plan.steps.map(({ sourceStepIds }) => sourceStepIds), [
    Array.from({ length: 10 }, (_, index) => `step-${index + 1}`),
    ['step-11', 'step-12'],
  ]);
  assert.deepEqual(cumulativeComponentsAtDiagramEnds(first.plan), [1, 1]);
  assert.ok(first.plan.steps.every(({ newBrickIds }) => newBrickIds.length <= 12));
  assert.deepEqual(first.plan.steps.flatMap(({ sourceStepIds }) => sourceStepIds), source.steps.map(({ id }) => id));
  assert.equal(first.report.sourceStepCoverageComplete, true);
  assert.equal(first.report.brickCoverageComplete, true);
  assert.deepEqual(first.report.connectedPatchCompaction, {
    selected: 'connected-endpoints',
    basicInstructionDiagramCount: 2,
    connectedInstructionDiagramCount: 2,
    maxAdditionalDiagramCount: 1,
    basicBoundaryStats: { buildDiagramCount: 2, detachedBrickExposure: 1, peakDetachedBrickCount: 1 },
    connectedBoundaryStats: { buildDiagramCount: 2, detachedBrickExposure: 0, peakDetachedBrickCount: 0 },
  });
});

test('does not spend the connected-patch diagram allowance without a boundary improvement', () => {
  const source = makePlan({
    bricks: [brick('floor-a', 0, 2, 0, 1, 1), brick('floor-b', 1, 2, 0, 1, 1), brick('bond', 0, 3, 0, 2, 1)],
    stepBrickIds: [['floor-a', 'floor-b'], ['bond']],
    graphEdges: [
      { a: 'floor-a', b: 'bond', studs: 1 },
      { a: 'floor-b', b: 'bond', studs: 1 },
    ],
    moduleBuildContext: { kind: 'work-surface', floorY: 2, orderPolicy: 'connected-patches' },
  });
  const { plan: compacted, report } = compactAssemblyPlan(source);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [['step-1', 'step-2']]);
  assert.equal(report.connectedPatchCompaction.selected, 'basic-bounded');
  assert.deepEqual(report.connectedPatchCompaction.basicBoundaryStats,
    report.connectedPatchCompaction.connectedBoundaryStats);
});

test('course-first work-surface diagrams retain the ordinary compaction endpoint', () => {
  const source = connectedPatchPlan({ orderPolicy: 'course-first' });
  const { plan: compacted } = compactAssemblyPlan(source);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [
    Array.from({ length: 11 }, (_, index) => `step-${index + 1}`),
    ['step-12'],
  ]);
  assert.deepEqual(cumulativeComponentsAtDiagramEnds(compacted), [2, 1]);
});

test('does not accept a final bridge while an earlier highlighted seed remains disconnected', () => {
  const plan = makePlan({
    bricks: [
      brick('seed-a', 0, 0, 0, 1, 1),
      brick('seed-b', 2, 0, 0, 1, 1),
      brick('cap-b', 2, 1, 0, 1, 1),
    ],
    stepBrickIds: [['seed-a'], ['seed-b'], ['cap-b']],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [
    ['step-1'], ['step-2', 'step-3'],
  ]);
  assert.ok(report.rejectedMergeCounts['not-face-connected'] >= 2);
});

test('folds a held one-brick module and its successful join into one placement diagram', () => {
  const hold = { code: 'temporary-hold', severity: 'warning', message: 'Hold on a flat surface.', brickIds: ['only'] };
  const plan = makePlan({
    bricks: [brick('only', 0, 0, 0, 1, 2)],
    stepBrickIds: [['only'], []],
    stepKinds: ['build', 'join'],
    stepIssues: [[hold], []],
    stepHighlightIds: [['only'], ['only']],
  });
  const before = structuredClone(plan);
  const { plan: compacted } = compactAssemblyPlan(plan);

  assert.deepEqual(plan, before);
  assert.equal(compacted.steps.length, 1);
  assert.equal(compacted.steps[0].kind, 'join');
  assert.equal(compacted.steps[0].label, plan.steps[1].label);
  assert.deepEqual(compacted.steps[0].newBrickIds, ['only']);
  assert.deepEqual(compacted.steps[0].visibleBrickIds, ['only']);
  assert.deepEqual(compacted.steps[0].highlightBrickIds, ['only']);
  assert.deepEqual(compacted.steps[0].issues, [hold]);
  assert.deepEqual(compacted.steps[0].sourceStepIds, ['step-1', 'step-2']);
  assert.deepEqual(compacted.steps[0].orderedOperations.map(({ id }) => id), ['step-1', 'step-2']);
});

test('folds a failed one-brick join without dropping hold or join errors', () => {
  const hold = { code: 'temporary-hold', severity: 'warning', message: 'Hold on a flat surface.', brickIds: ['only'] };
  const failure = { code: 'no-stud-engagement', severity: 'error', message: 'No stud connection.', brickIds: ['only'] };
  const plan = makePlan({
    bricks: [brick('only', 0, 1, 0, 1, 2)],
    stepBrickIds: [['only'], []],
    stepKinds: ['build', 'unresolved'],
    stepIssues: [[hold], [failure]],
    stepHighlightIds: [['only'], ['only']],
  });
  const { plan: compacted } = compactAssemblyPlan(plan);

  assert.equal(compacted.steps.length, 1);
  assert.equal(compacted.steps[0].kind, 'unresolved');
  assert.deepEqual(compacted.steps[0].issues, [hold, failure]);
  assert.deepEqual(compacted.steps[0].orderedOperations, [
    {
      id: 'step-1', kind: 'build', insertionDirection: 'down', newBrickIds: ['only'],
      highlightBrickIds: ['only'], issues: [hold],
    },
    {
      id: 'step-2', kind: 'unresolved', insertionDirection: 'down', newBrickIds: [],
      highlightBrickIds: ['only'], issues: [failure],
    },
  ]);
});

test('keeps a real multi-brick handled subassembly separate from its join view', () => {
  const hold = { code: 'temporary-hold', severity: 'warning', message: 'Hold on a flat surface.', brickIds: ['a'] };
  const plan = makePlan({
    bricks: [brick('a', 0, 0, 0, 1, 2), brick('b', 1, 0, 0, 1, 2)],
    stepBrickIds: [['a', 'b'], []],
    stepKinds: ['build', 'join'],
    stepIssues: [[hold], []],
    stepHighlightIds: [['a', 'b'], ['a', 'b']],
  });
  const { plan: compacted } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [['step-1'], ['step-2']]);
  assert.deepEqual(compacted.steps[0].issues, [hold]);
});

test('joins, unresolved operations, and reported holds remain isolated with their failures intact', () => {
  const failure = { code: 'unsupported-addition', severity: 'error', message: 'Unsupported.', brickIds: ['bad'] };
  const hold = { code: 'temporary-hold', severity: 'warning', message: 'Hold.', brickIds: ['held'] };
  const plan = makePlan({
    bricks: [
      brick('ok', 0, 0, 0, 2, 2), brick('bad', 2, 0, 0, 1, 1), brick('held', 3, 0, 0, 1, 1),
    ],
    stepBrickIds: [['ok'], ['bad'], ['held'], []],
    stepKinds: ['build', 'unresolved', 'build', 'join'],
    stepIssues: [[], [failure], [hold], []],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.equal(compacted.steps.length, 4);
  assert.deepEqual(compacted.steps.map(({ sourceStepIds }) => sourceStepIds), [['step-1'], ['step-2'], ['step-3'], ['step-4']]);
  assert.deepEqual(compacted.steps[1].issues, [failure]);
  assert.deepEqual(compacted.steps[2].issues, [hold]);
  assert.equal(compacted.steps[1].kind, 'unresolved');
  assert.equal(compacted.steps[3].kind, 'join');
  assert.ok(report.rejectedMergeCounts['non-build-step'] >= 1);
  assert.ok(report.rejectedMergeCounts['reported-issue'] >= 1);
});

test('course, distance, and direction bounds reject unsafe display merges and report why', () => {
  const plan = makePlan({
    bricks: [
      brick('a', 0, 0, 0, 2, 2),
      brick('b', 10, 0, 0, 2, 2),
      brick('c', 10, 3, 0, 2, 2),
      brick('d', 10, 4, 0, 2, 2),
    ],
    stepBrickIds: [['a'], ['b'], ['c'], ['d']],
    directions: [null, null, null, 'up'],
  });
  const { plan: compacted, report } = compactAssemblyPlan(plan);

  assert.deepEqual(compacted.steps.flatMap(({ sourceStepIds }) => sourceStepIds), plan.steps.map(({ id }) => id));
  assert.ok(report.rejectedMergeCounts['not-local'] >= 1);
  assert.ok(report.rejectedMergeCounts['course-span'] >= 1);
  assert.ok(report.rejectedMergeCounts['insertion-direction'] >= 1);
  assert.equal(report.sourceStepCoverageComplete, true);
  assert.equal(report.brickCoverageComplete, true);
});
