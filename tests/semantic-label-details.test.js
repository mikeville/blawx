import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSectionsFromRanges } from '../src/guide-sections.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import { refineSemanticLabelDetails } from '../src/semantic-label-details.js';

function fixture(stepBricks, labels, { repeated = false } = {}) {
  const bricks = stepBricks.flat();
  const plan = {
    bricks,
    modules: stepBricks.map((entries, index) => ({
      id: `module-${index + 1}`,
      kind: 'grounded',
      brickIds: entries.map(({ id }) => id),
      ...(repeated ? { componentIds: [`component-${index + 1}`] } : {}),
    })),
    steps: stepBricks.map((entries, index) => ({
      id: `step-${index + 1}`,
      moduleId: `module-${index + 1}`,
      kind: 'build',
      newBrickIds: entries.map(({ id }) => id),
      issues: [],
    })),
    graph: { edges: [] },
  };
  const guide = repeated ? createGuideSectionsFromRanges(plan, plan.steps.map((step) => ({
    startStepId: step.id, endStepId: step.id,
  }))) : undefined;
  const input = createSemanticGuideInput({ plan, guide, subject: 'geometric object' });
  const annotation = {
    version: 1,
    fingerprint: input.fingerprint,
    sections: labels.map((label, index) => ({
      startStepId: `step-${index + 1}`,
      endStepId: `step-${index + 1}`,
      label,
      confidence: label === null ? 'uncertain' : index % 2 ? 'inferred' : 'high',
      evidence: `Original evidence ${index + 1}.`,
    })),
  };
  return { input, annotation };
}

test('generic labels gain one qualifier only when full chapter bounds fit a vertical region', () => {
  const { input, annotation } = fixture([
    [{ id: 'low', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' }],
    [{ id: 'middle-1', x: 0, y: 1, z: 0, w: 1, d: 1, color: 'blue' },
      { id: 'middle-2', x: 0, y: 2, z: 0, w: 1, d: 1, color: 'red' }],
    [{ id: 'high', x: 0, y: 3, z: 0, w: 1, d: 1, color: 'blue' }],
  ], ['BODY', 'Details', 'Structure']);
  const result = refineSemanticLabelDetails(input, annotation);
  assert.deepEqual(result.annotation.sections.map((section) => section.label), [
    'Lower body', 'Middle details', 'Upper structure',
  ]);
  assert.deepEqual(result.annotation.sections.map(({ startStepId, endStepId, confidence, evidence }) => ({
    startStepId, endStepId, confidence, evidence,
  })), annotation.sections.map(({ startStepId, endStepId, confidence, evidence }) => ({
    startStepId, endStepId, confidence, evidence,
  })));
  assert.deepEqual(result.evidence.map((entry) => entry.rule), [
    'physical-y-lower', 'physical-y-middle', 'physical-y-upper',
  ]);
  assert.equal(result.fingerprint, input.fingerprint);
});

test('full bounds prevent centroid-style region claims', () => {
  const { input, annotation } = fixture([
    [
      { id: 'spans-low', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' },
      { id: 'spans-high', x: 0, y: 2, z: 0, w: 1, d: 1, color: 'blue' },
    ],
    [{ id: 'whole-top', x: 0, y: 3, z: 0, w: 1, d: 1, color: 'white' }],
  ], ['Details', 'Top']);
  const result = refineSemanticLabelDetails(input, annotation);
  assert.equal(result.annotation.sections[0].label, 'Details');
  assert.equal(result.evidence[0].rule, 'no-qualifier');
  assert.deepEqual(result.evidence[0].chapterBounds.y, { min: 0, maxExclusive: 3.5999999999999996 });
});

test('known palette color qualifies a generic label only at 95 percent occupied-cell volume', () => {
  const { input, annotation } = fixture([[
    { id: 'red-large', x: 0, y: 0, z: 0, w: 2, d: 8, color: 'red' },
    { id: 'red-small', x: 2, y: 0, z: 0, w: 1, d: 3, color: 'red' },
    { id: 'blue-small', x: 3, y: 0, z: 0, w: 1, d: 1, color: 'blue' },
  ]], ['Body']);
  const result = refineSemanticLabelDetails(input, annotation);
  assert.equal(result.annotation.sections[0].label, 'Red body');
  assert.equal(result.evidence[0].colors.occupiedCellVolume, 20);
  assert.equal(result.evidence[0].colors.dominantFraction, 0.95);
  assert.equal(result.evidence[0].rule, 'palette-color-95-percent');
});

test('protected repeat sections retain identical generic labels and report the skipped rule', () => {
  const { input, annotation } = fixture([
    [{ id: 'left', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' }],
    [{ id: 'right', x: 4, y: 0, z: 0, w: 1, d: 1, color: 'red' }],
  ], ['Body', 'Body'], { repeated: true });
  const result = refineSemanticLabelDetails(input, annotation);
  assert.deepEqual(result.annotation.sections.map((section) => section.label), ['Body', 'Body']);
  assert.deepEqual(result.evidence.map((entry) => entry.rule), [
    'protected-repeat-skipped', 'protected-repeat-skipped',
  ]);
  assert.deepEqual(result.changes, []);
});

test('null labels remain null without attempting generic refinement', () => {
  const { input, annotation } = fixture([[
    { id: 'unknown', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' },
  ]], [null]);
  const result = refineSemanticLabelDetails(input, annotation);
  assert.equal(result.annotation.sections[0].label, null);
  assert.equal(result.annotation.sections[0].confidence, 'uncertain');
  assert.equal(result.evidence[0].rule, 'null-label');
  assert.deepEqual(result.changes, []);
});
