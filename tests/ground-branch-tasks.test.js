import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections } from '../src/guide-sections.js';
import { discoverGroundBranches, planGroundBranches, completeGroundBranches } from '../src/ground-branch-tasks.js';

function fixture(turn = 0, extraHeight = 0) {
  const geometry = [];
  for (let y = 0; y < 3 + extraHeight; y++) for (const x of [0, 4]) {
    geometry.push({ x, y, z: 0, w: 2, d: 2, color: y === 0 ? 'blue' : 'white' });
  }
  for (let y = 3 + extraHeight; y < 5 + extraHeight; y++) {
    geometry.push({ x: 1, y, z: 0, w: 4, d: 2, color: 'white' });
  }
  const bricks = geometry.map(original => {
    let brick = original;
    for (let index = 0; index < turn; index++) {
      brick = { ...brick, x: -brick.z - brick.d, z: brick.x, w: brick.d, d: brick.w };
    }
    return { ...brick, x: brick.x + 15, z: brick.z + 11,
      color: turn ? (brick.color === 'blue' ? 'yellow' : 'green') : brick.color };
  });
  const brickModel = { version: 1, kind: 'bricks', bricks };
  const assemblyPlan = createAssemblyPlan({ brickModel, integratedBuild: true });
  const instructionPlan = { ...assemblyPlan, steps: assemblyPlan.steps.map(step => ({ ...step,
    id: 'diagram-' + step.id, sourceStepIds: [step.id], orderedOperations: [{
      id: step.id, kind: step.kind, newBrickIds: step.newBrickIds,
      highlightBrickIds: step.highlightBrickIds, issues: step.issues,
      insertionDirection: step.insertionDirection ?? 'down',
    }],
  })) };
  return { brickModel, assemblyPlan, instructionPlan, guide: createGuideSections(instructionPlan) };
}

for (let turn = 0; turn < 4; turn++) for (const extraHeight of [0, 2]) {
  test(`complete branches before their discovered receiver: rotation ${turn}, height ${extraHeight}`, () => {
    const before = fixture(turn, extraHeight), snapshot = structuredClone(before);
    const found = discoverGroundBranches(before.assemblyPlan.bricks);
    assert.equal(found.roots, 2);
    assert.deepEqual(found.tasks.map(task => Math.min(...task.map(brick => brick.y))), [0, 0, 3 + extraHeight]);
    const proposal = planGroundBranches(before);
    assert.equal(proposal.selected, true, JSON.stringify(proposal.attempts));
    const after = proposal.result;
    assert.deepEqual(before, snapshot);
    assert.deepEqual(after.brickModel, before.brickModel);
    assert.equal(proposal.returnsAfter, 0);
    const taskByBrick = new Map(found.tasks.flatMap((task, index) => task.map(brick => [brick.id, index])));
    const owners = after.assemblyPlan.steps.flatMap(step => step.newBrickIds.map(id => taskByBrick.get(id)));
    assert.deepEqual(owners, [...owners].sort());
    assert(after.assemblyPlan.steps.every(step => step.kind === 'build' && !step.issues.length));
    assert.deepEqual(after.instructionPlan.steps.flatMap(step => step.sourceStepIds), after.assemblyPlan.steps.map(step => step.id));
    assert.equal(after.assemblyEvaluation.compaction.instructionDiagramCount, after.instructionPlan.steps.length);
    assert.equal(after.assemblyEvaluation.compaction.sourceStepCount, after.assemblyPlan.steps.length);
    assert.equal(completeGroundBranches(after), after);
    assert.equal(completeGroundBranches(before).groundBranchRefinement.selected, true);
  });
}

test('reject single roots and branches missing a lower connection', () => {
  const { assemblyPlan } = fixture();
  const found = discoverGroundBranches(assemblyPlan.bricks);
  const first = new Set(found.tasks[0].map(brick => brick.id));
  assert.equal(discoverGroundBranches(assemblyPlan.bricks.filter(brick => first.has(brick.id))), null);
  assert.equal(discoverGroundBranches(assemblyPlan.bricks.map(brick => first.has(brick.id) && brick.y === 1
    ? { ...brick, y: 20 } : brick)), null);
});

test('protect handled scopes, nested recipes, joins and explicit insertion actions', () => {
  const mutations = [
    before => { before.assemblyPlan.modules[0].buildContext = { type: 'table' }; },
    before => { before.assemblyPlan.modules[0].kind = 'detail'; },
    ...['nestedRecipe', 'nestedRecipePath', 'tableRecipe', 'instructionAction', 'joinContext'].map(key =>
      before => { before.assemblyPlan.steps[0][key] = {}; }),
    before => { before.assemblyPlan.steps[0].insertionDirection = 'up'; },
    before => { before.assemblyPlan.steps[0].issues = [{ code: 'missing-support', severity: 'error' }]; },
  ];
  for (const mutate of mutations) {
    const before = fixture();
    mutate(before);
    assert.equal(completeGroundBranches(before), before);
  }
});

test('reject a branch order obstructed by the existing external scene', () => {
  const before = fixture();
  const lower = before.assemblyPlan.bricks.find(brick => brick.y === 0);
  const obstruction = { ...lower, id: 'external-obstruction', y: 10 };
  before.assemblyPlan.bricks.push(obstruction);
  // Keep the obstruction outside the selected module; it is already present.
  for (const step of before.assemblyPlan.steps) step.visibleBrickIds = [obstruction.id, ...step.visibleBrickIds];
  const external = { ...before.assemblyPlan.steps[0], id: 'external-operation', moduleId: 'external',
    newBrickIds: [obstruction.id], highlightBrickIds: [obstruction.id], visibleBrickIds: [obstruction.id] };
  before.assemblyPlan.modules.unshift({ ...before.assemblyPlan.modules[0], id: 'external',
    kind: 'detail', brickIds: [obstruction.id] });
  before.assemblyPlan.steps.unshift(external);
  before.instructionPlan.steps.unshift({ ...external, id: 'external-diagram',
    sourceStepIds: [external.id], orderedOperations: [external] });
  before.guide = createGuideSections(before.instructionPlan);
  const proposal = planGroundBranches(before);
  assert.equal(proposal.selected, false);
  assert(proposal.attempts.some(attempt => attempt.reason === 'Existing scene blocks insertion'));
});
