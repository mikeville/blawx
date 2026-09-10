import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalSemanticProposal } from '../src/semantic-local-grouping.js';
import { validateSemanticGuideAnnotation, createSemanticGuideInput } from '../src/semantic-guide.js';

function syntheticInput(subject = 'red pickup truck') {
  return createSemanticGuideInput({
    subject,
    plan: {
      bricks: [
        { id: 'brick-1', x: 0, y: 0, z: 0, w: 2, d: 2, color: '#c91f25' },
        { id: 'brick-2', x: 2, y: 0, z: 0, w: 2, d: 2, color: '#c91f25' },
        { id: 'brick-3', x: 0, y: 1, z: 0, w: 2, d: 2, color: '#1f4f8f' },
      ],
      modules: [{ id: 'module-1', kind: 'grounded', label: 'Build area 1', brickIds: ['brick-1', 'brick-2', 'brick-3'] }],
      steps: [
        { id: 'step-1', moduleId: 'module-1', kind: 'foundation', label: 'Base', newBrickIds: ['brick-1'], insertionDirection: 'down', issues: [] },
        { id: 'step-2', moduleId: 'module-1', kind: 'extension', label: 'Body', newBrickIds: ['brick-2'], insertionDirection: 'down', issues: [] },
        { id: 'step-3', moduleId: 'module-1', kind: 'extension', label: 'Top', newBrickIds: ['brick-3'], insertionDirection: 'down', issues: [] },
      ],
      graph: { edges: [{ a: 'brick-1', b: 'brick-2', studs: 2 }, { a: 'brick-1', b: 'brick-3', studs: 2 }] },
    },
  });
}

test('local grouping is deterministic, bounded, and preserves canonical coverage', () => {
  const input = syntheticInput();
  const first = createLocalSemanticProposal(input);
  const second = createLocalSemanticProposal(structuredClone(input));
  assert.deepEqual(first, second);
  assert.deepEqual(validateSemanticGuideAnnotation(input, first), first);
  assert.ok(first.sections.length >= 1 && first.sections.length <= 12);
  assert.ok(first.sections.every((section) => section.label === null && section.confidence === 'uncertain'));
  const stepIndexes = new Map(input.steps.map((step, index) => [step.id, index]));
  const covered = first.sections.flatMap((section) => input.steps.slice(
    stepIndexes.get(section.startStepId), stepIndexes.get(section.endStepId) + 1,
  ));
  assert.deepEqual(covered, input.steps);
});

test('every local range contains a brick addition', () => {
  const input = syntheticInput();
  const proposal = createLocalSemanticProposal(input);
  const stepIndexes = new Map(input.steps.map((step, index) => [step.id, index]));
  for (const section of proposal.sections) {
    const steps = input.steps.slice(stepIndexes.get(section.startStepId), stepIndexes.get(section.endStepId) + 1);
    assert.ok(steps.some((step) => step.newBrickIds.length > 0));
  }
});
