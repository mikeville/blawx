import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSemanticCaptionPrompt, parseSemanticCaptionResult } from '../server/semantic-caption.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import { createGuideSectionsFromRanges } from '../src/guide-sections.js';

function fixture() {
  const plan = {
    bricks: [
      { id: 'b1', x: 0, y: 0, z: 0, w: 1, d: 1, color: '#f00' },
      { id: 'b2', x: 0, y: 1, z: 0, w: 1, d: 1, color: '#0f0' },
    ],
    modules: [{ id: 'm1', kind: 'grounded', brickIds: ['b1', 'b2'] }],
    steps: [
      { id: 's1', moduleId: 'm1', kind: 'foundation', newBrickIds: ['b1'], issues: [] },
      { id: 's2', moduleId: 'm1', kind: 'extension', newBrickIds: ['b2'], issues: [] },
    ],
    graph: { edges: [{ a: 'b1', b: 'b2', studs: 1 }] },
  };
  const input = createSemanticGuideInput({ plan, subject: 'small tower' });
  const proposal = {
    version: 1,
    fingerprint: input.fingerprint,
    sections: [
      { startStepId: 's1', endStepId: 's1', label: 'Draft one', confidence: 'high', evidence: 'Local evidence one.' },
      { startStepId: 's2', endStepId: 's2', label: 'Draft two', confidence: 'high', evidence: 'Local evidence two.' },
    ],
  };
  return { input, proposal };
}

test('caption prompt omits draft labels and records exact fixed chapter rows', () => {
  const { input, proposal } = fixture();
  const prompt = buildSemanticCaptionPrompt(input, proposal, [{ view: 'sheet 1 rows 1-2' }]);
  assert.match(prompt, /SHEETS \[sheet,chapterRows\] \[\[1,\[1,2\]\]\]/);
  assert.match(prompt, /CHAPTERS \[chapter,repeatGroup\] \[\[1,null\],\[2,null\]\]/);
  assert.doesNotMatch(prompt, /Draft one|Draft two/);
  assert.match(prompt, /Return only JSON:/);
  assert.ok(Buffer.byteLength(prompt, 'utf8') < 2_000);
});

test('caption parser binds labels onto unchanged proposal ranges and local evidence', () => {
  const { input, proposal } = fixture();
  const result = parseSemanticCaptionResult(input, proposal, JSON.stringify({ labels: ['Appendage', null] }));
  assert.deepEqual(result.sections, [
    { startStepId: 's1', endStepId: 's1', label: 'Appendage', confidence: 'inferred', evidence: 'Local evidence one.' },
    { startStepId: 's2', endStepId: 's2', label: null, confidence: 'uncertain', evidence: 'Local evidence two.' },
  ]);
  assert.equal(result.fingerprint, input.fingerprint);
});

test('caption parser rejects malformed labels without altering proposal ranges', () => {
  const { input, proposal } = fixture();
  for (const raw of [
    '{}',
    '{',
    JSON.stringify({ labels: ['one'] }),
    JSON.stringify({ labels: ['one', 2] }),
    JSON.stringify({ labels: ['one', 'two'], extra: true }),
  ]) assert.throws(() => parseSemanticCaptionResult(input, proposal, raw));
});

test('caption parser requires one identical label for repeated chapter groups', () => {
  const bricks = [
    { id: 'left', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' },
    { id: 'right', x: 4, y: 0, z: 0, w: 1, d: 1, color: 'red' },
  ];
  const plan = {
    bricks,
    modules: bricks.map((brick, index) => ({
      id: `m${index + 1}`, kind: 'grounded', brickIds: [brick.id], componentIds: [`c${index + 1}`],
    })),
    steps: bricks.map((brick, index) => ({
      id: `s${index + 1}`, moduleId: `m${index + 1}`, kind: 'build', newBrickIds: [brick.id], issues: [],
    })),
    graph: { edges: [] },
  };
  const guide = createGuideSectionsFromRanges(plan, [
    { startStepId: 's1', endStepId: 's1' },
    { startStepId: 's2', endStepId: 's2' },
  ]);
  const input = createSemanticGuideInput({ plan, guide, subject: 'matching lights' });
  const proposal = {
    version: 1,
    fingerprint: input.fingerprint,
    sections: input.steps.map((step, index) => ({
      startStepId: step.id, endStepId: step.id, label: `Draft ${index + 1}`,
      confidence: 'high', evidence: `Local evidence ${index + 1}.`,
    })),
  };
  assert.throws(
    () => parseSemanticCaptionResult(input, proposal, '{"labels":["Signal lamp","Marker lamp"]}'),
    /same label/,
  );
  assert.doesNotThrow(() => parseSemanticCaptionResult(input, proposal, '{"labels":[null,null]}'));
});
