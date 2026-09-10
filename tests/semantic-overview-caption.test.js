import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticOverviewCaptionPrompt } from '../server/semantic-overview-caption.js';
import { createNamingApiRequest } from '../server/naming-budget.js';
import { createLocalSemanticProposal } from '../src/semantic-local-grouping.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';

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

test('whole-object readings use fixed numeric chapter evidence and stay within the proposal envelope', () => {
  const input = syntheticInput();
  const annotation = createLocalSemanticProposal(input);
  const before = JSON.stringify(input);
  const prompt = buildSemanticOverviewCaptionPrompt(input, annotation, [{ view: 'front-right' }]);
  const chapters = JSON.parse(prompt.split('CHAPTERS [index,repeat,box,colorsByVolume] ')[1]);
  assert.equal(chapters.length, annotation.sections.length);
  assert.ok(chapters.every(([index, , box, colors]) => Number.isInteger(index)
    && box.length === 6 && box.every(Number.isFinite)
    && colors.length >= 1 && colors.length <= 4
    && colors.every(([, volume]) => volume > 0)));
  assert.ok(createNamingApiRequest(prompt, { phase: 'proposal' }).budget.maxCostUsd < 0.006);
  assert.equal(JSON.stringify(input), before);
  const fakeNames = { ...annotation, sections: annotation.sections.map(section => ({ ...section, label: 'Invented label' })) };
  assert.equal(buildSemanticOverviewCaptionPrompt(input, fakeNames, [{ view: 'front-right' }]), prompt);
});
