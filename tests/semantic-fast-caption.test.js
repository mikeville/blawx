import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFastSemanticCaptionPrompt, parseSemanticCaptionResult } from '../server/semantic-fast-caption.js';
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

test('fast caption prompt binds one output label to each fixed local range', () => {
  const input = syntheticInput();
  const proposal = createLocalSemanticProposal(input);
  const images = Array.from({ length: Math.ceil(proposal.sections.length / 3) }, () => ({
    png: Buffer.from('test'), width: 1024, height: 1024, view: 'reference and isolated additions',
  }));
  const prompt = buildFastSemanticCaptionPrompt(input, proposal, images);
  assert.ok(Buffer.byteLength(prompt) <= 2_000);
  assert.match(prompt, new RegExp(`Return exactly ${proposal.sections.length} labels`));
  assert.match(prompt, /most specific shared common category/);
  const labels = proposal.sections.map(() => 'Body details');
  const annotation = parseSemanticCaptionResult(input, proposal, JSON.stringify({ labels }));
  assert.deepEqual(annotation.sections.map((section) => [section.startStepId, section.endStepId]),
    proposal.sections.map((section) => [section.startStepId, section.endStepId]));
});

test('fast caption prompt validates sheets and parser keeps nulls honest', () => {
  const input = syntheticInput();
  const proposal = createLocalSemanticProposal(input);
  const count = Math.ceil(proposal.sections.length / 3);
  assert.throws(() => buildFastSemanticCaptionPrompt(input, proposal, []), /one sheet per three chapters/);
  assert.throws(() => buildFastSemanticCaptionPrompt(input, proposal,
    Array.from({ length: count }, () => ({ width: 768, height: 768 }))), /1024 by 1024/);
  const annotation = parseSemanticCaptionResult(input, proposal,
    JSON.stringify({ labels: proposal.sections.map(() => null) }));
  assert.ok(annotation.sections.every((section) => section.label === null && section.confidence === 'uncertain'));
});
