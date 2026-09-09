import test from 'node:test';
import assert from 'node:assert/strict';

import { assessAttachmentReplay } from '../src/attachment-replay-guards.js';

const brick = (id, x, y, z, w = 1, d = 1, color = 'blue') => ({ id, x, y, z, w, d, color });

function fixture() {
  const anchor = brick('anchor', 1, 0, 0);
  const target = brick('target', 0, 1, 0, 1, 1, 'orange');
  const otherA = brick('other-a', 10, 0, 0, 1, 1, 'green');
  const otherB = brick('other-b', 10, 1, 0, 1, 1, 'green');
  const beforePlan = {
    bricks: [anchor, target, otherA, otherB],
    modules: [
      { id: 'anchor-module', brickIds: ['anchor'] },
      { id: 'target-module', brickIds: ['target'] },
      { id: 'other-module', brickIds: ['other-a', 'other-b'] },
    ],
    steps: [
      { id: 'a1', moduleId: 'anchor-module', kind: 'build', newBrickIds: ['anchor'], highlightBrickIds: [], issues: [] },
      { id: 't1', moduleId: 'target-module', kind: 'unresolved', newBrickIds: [], highlightBrickIds: ['target'], issues: [{ code: 'no-stud-engagement', severity: 'error', brickIds: ['target'] }] },
      { id: 'o1', moduleId: 'other-module', kind: 'build', newBrickIds: ['other-a'], highlightBrickIds: [], issues: [] },
      { id: 'o2', moduleId: 'other-module', kind: 'build', newBrickIds: ['other-b'], highlightBrickIds: [], issues: [] },
    ],
    graph: { edges: [{ a: 'other-a', b: 'other-b', studs: 1 }] },
  };
  const replacement = brick('replacement', 0, 0, 0, 2, 1);
  const candidatePlan = {
    bricks: [replacement, target, otherA, otherB],
    modules: [
      { id: 'anchor-module', brickIds: ['replacement'] },
      { id: 'target-module', brickIds: ['target'] },
      { id: 'other-module', brickIds: ['other-a', 'other-b'] },
    ],
    steps: [
      { id: 'a2', moduleId: 'anchor-module', kind: 'build', newBrickIds: ['replacement'], highlightBrickIds: [], issues: [] },
      { id: 't2', moduleId: 'target-module', kind: 'join', newBrickIds: ['target'], highlightBrickIds: ['target'], issues: [], insertionDirection: 'down' },
      { id: 'o3', moduleId: 'other-module', kind: 'build', newBrickIds: ['other-a'], highlightBrickIds: [], issues: [] },
      { id: 'o4', moduleId: 'other-module', kind: 'build', newBrickIds: ['other-b'], highlightBrickIds: [], issues: [] },
    ],
    graph: { edges: [{ a: 'replacement', b: 'target', studs: 1 }, { a: 'other-a', b: 'other-b', studs: 1 }] },
  };
  return {
    beforeResult: { assemblyPlan: beforePlan },
    candidateResult: { assemblyPlan: candidatePlan },
    proposal: {
      before: [{ x: 1, y: 0, z: 0, w: 1, d: 1, color: 'blue' }],
      after: [{ x: 0, y: 0, z: 0, w: 2, d: 1, color: 'blue' }],
      targetIds: ['target'], anchorIds: ['anchor'],
    },
  };
}

test('accepts a fresh target-anchor stud contact that resolves the proposed target cells', () => {
  const input = fixture();
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.deepEqual(assessment.rejectionReasons, []);
  assert.deepEqual(assessment.evidence.resolvedTargetOldCells, ['0,1,0']);
  assert.equal(assessment.evidence.contactEdges.length, 1);
  assert.deepEqual(assessment.evidence.affectedModuleIds, ['anchor-module', 'target-module']);
});

test('aggregate unresolved improvement cannot mask failure to resolve the proposed target', () => {
  const input = fixture();
  input.candidateResult.assemblyPlan.steps[1] = structuredClone(input.beforeResult.assemblyPlan.steps[1]);
  input.candidateResult.assemblyPlan.steps[1].moduleId = 'target-module';
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.ok(assessment.rejectionReasons.includes('No proposed target old cell became resolved'));
});

test('an unrelated module cannot reorder its canonical operations', () => {
  const input = fixture();
  const steps = input.candidateResult.assemblyPlan.steps;
  [steps[2], steps[3]] = [steps[3], steps[2]];
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.ok(assessment.rejectionReasons.includes('Unrelated module changed: other-module'));
});

test('an unrelated step cannot reorder physical brick additions within the step', () => {
  const input = fixture();
  input.beforeResult.assemblyPlan.steps.splice(2, 2, {
    id: 'o-combined-before', moduleId: 'other-module', kind: 'build',
    newBrickIds: ['other-a', 'other-b'], highlightBrickIds: [], issues: [],
  });
  input.candidateResult.assemblyPlan.steps.splice(2, 2, {
    id: 'o-combined-after', moduleId: 'other-module', kind: 'build',
    newBrickIds: ['other-b', 'other-a'], highlightBrickIds: [], issues: [],
  });
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.ok(assessment.rejectionReasons.includes('Unrelated module changed: other-module'));
});

test('affected modules cannot exchange positions during replay', () => {
  const input = fixture();
  const modules = input.candidateResult.assemblyPlan.modules;
  [modules[0], modules[1]] = [modules[1], modules[0]];
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.ok(assessment.rejectionReasons.includes('Module order changed at: anchor-module'));
  assert.ok(assessment.rejectionReasons.includes('Module order changed at: target-module'));
});

test('same held-cell count cannot move a temporary hold onto different old cells', () => {
  const input = fixture();
  input.beforeResult.assemblyPlan.steps[0].issues = [{ code: 'temporary-hold', severity: 'warning', brickIds: ['anchor'] }];
  input.candidateResult.assemblyPlan.steps[2].issues = [{ code: 'temporary-hold', severity: 'warning', brickIds: ['other-a'] }];
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.equal(assessment.evidence.beforeHeldOldCellCount, assessment.evidence.candidateHeldOldCellCount);
  assert.deepEqual(assessment.evidence.newlyHeldOldCells, ['10,0,0']);
  assert.ok(assessment.rejectionReasons.includes('New old occupied cells require temporary holding'));
});

test('holding a replacement addition is rejected even when held old cells are unchanged', () => {
  const input = fixture();
  input.beforeResult.assemblyPlan.steps[0].issues = [{ code: 'temporary-hold', severity: 'warning', brickIds: ['anchor'] }];
  input.candidateResult.assemblyPlan.steps[0].issues = [{ code: 'temporary-hold', severity: 'warning', brickIds: ['replacement'] }];
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.equal(assessment.evidence.beforeHeldOldCellCount, 1);
  assert.equal(assessment.evidence.candidateHeldOldCellCount, 1);
  assert.equal(assessment.evidence.beforeHeldCellCount, 1);
  assert.equal(assessment.evidence.candidateHeldCellCount, 2);
  assert.ok(assessment.rejectionReasons.includes('Total temporary-held cell count increased'));
});

test('rejects missing fresh contacts, module-count changes, and invalid inputs', () => {
  const input = fixture();
  input.candidateResult.assemblyPlan.graph.edges = [{ a: 'other-a', b: 'other-b', studs: 1 }];
  input.candidateResult.assemblyPlan.modules.pop();
  const assessment = assessAttachmentReplay(input.beforeResult, input.candidateResult, input.proposal);
  assert.ok(assessment.rejectionReasons.includes('No fresh proposed target-anchor stud edge'));
  assert.ok(assessment.rejectionReasons.includes('Module count changed'));
  assert.throws(() => assessAttachmentReplay({}, input.candidateResult, input.proposal), /beforeResult/);
  assert.throws(() => assessAttachmentReplay(input.beforeResult, input.candidateResult, {}), /proposal/);
});
