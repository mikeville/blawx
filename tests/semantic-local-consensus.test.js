import test from 'node:test';
import assert from 'node:assert/strict';
import { createGuideSectionsFromRanges } from '../src/guide-sections.js';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import {
  generalizeSemanticAnnotation,
  generalizeSemanticLabels,
} from '../src/semantic-local-consensus.js';

function fixture({ repeated = false, sectionCount = 3 } = {}) {
  const bricks = Array.from({ length: sectionCount }, (_, index) => ({
    id: `b${index + 1}`, x: index * 3, y: 0, z: 0, w: 1, d: 1, color: 'red',
  }));
  const plan = {
    bricks,
    modules: bricks.map((brick, index) => ({
      id: `m${index + 1}`, kind: 'grounded', brickIds: [brick.id],
      ...(repeated ? { componentIds: [`c${index + 1}`] } : {}),
    })),
    steps: bricks.map((brick, index) => ({
      id: `s${index + 1}`, moduleId: `m${index + 1}`, kind: 'build',
      newBrickIds: [brick.id], issues: [],
    })),
    graph: { edges: [] },
  };
  const guide = repeated ? createGuideSectionsFromRanges(plan, plan.steps.map((step) => ({
    startStepId: step.id, endStepId: step.id,
  }))) : undefined;
  const input = createSemanticGuideInput({ plan, guide, subject: 'untrusted subject' });
  const annotation = (labels, prefix) => ({
    version: 1,
    fingerprint: input.fingerprint,
    sections: labels.map((label, index) => ({
      startStepId: `s${index + 1}`,
      endStepId: `s${index + 1}`,
      label,
      confidence: label === null ? 'uncertain' : 'inferred',
      evidence: `${prefix} evidence ${index + 1}.`,
    })),
  });
  return { input, annotation };
}

test('normalizes exact labels and uses only controlled broad parents for ambiguity', () => {
  assert.equal(generalizeSemanticLabels('  BODY  ', 'body'), 'Body');
  assert.equal(generalizeSemanticLabels('Tail', 'Leg'), 'Appendage');
  assert.equal(generalizeSemanticLabels('Torso', 'Chassis'), 'Body');
  assert.equal(generalizeSemanticLabels('Foundation', 'Body'), 'Structure');
  assert.equal(generalizeSemanticLabels('Rear wheel', 'Front tire'), 'Wheel');
  assert.equal(generalizeSemanticLabels('Engine', 'Garden'), null);
  assert.equal(generalizeSemanticLabels('Wheel', 'Roof'), 'Details');
  assert.equal(generalizeSemanticLabels('Bumper', 'Bumpers'), 'Bumpers');
  assert.equal(generalizeSemanticLabels('Body', 'body section'), 'Body');
  assert.equal(generalizeSemanticLabels('Body', 'body parts'), 'Body');
  assert.equal(generalizeSemanticLabels('Details', 'Screen'), 'Details');
  assert.equal(generalizeSemanticLabels('Antenna', 'Details'), 'Details');
  assert.equal(generalizeSemanticLabels('Glass', 'Glasses'), null);
  assert.equal(generalizeSemanticLabels('Engine', 'Engine section'), null);
});

test('drops unshared entity, position, color, and function modifiers', () => {
  assert.equal(generalizeSemanticLabels('Dragon body', 'Station body'), 'Body');
  assert.equal(generalizeSemanticLabels('Left body panel', 'Blue wall'), 'Panels');
  assert.equal(generalizeSemanticLabels('Steering wheel', 'Rear tire'), 'Wheel');
  assert.equal(generalizeSemanticLabels('Left appendage', 'Left appendage'), 'Left appendage');
});

test('covers mixed scopes without losing a second shared category', () => {
  assert.equal(generalizeSemanticLabels('Body and tail', 'Leg and torso'), 'Body and Appendage');
  assert.equal(generalizeSemanticLabels('Roof and foliage', 'Trees and canopy'), 'Roof and Natural details');
  assert.equal(generalizeSemanticLabels('Arms', 'Arms and hands'), 'Arms');
  assert.equal(generalizeSemanticLabels('Body and wheels', 'Body'), 'Details');
  assert.equal(generalizeSemanticLabels('Screen and antenna', 'Screens and antennas'), 'Screens and Antennas');
  assert.equal(generalizeSemanticLabels('Body details', 'Body'), 'Details');
});

test('builds a validated annotation with exact ranges and raw decision evidence', () => {
  const { input, annotation } = fixture();
  const proposal = annotation(['Tail', 'Dragon body', null], 'Proposal');
  const caption = annotation(['Leg', 'Station body', 'Roof'], 'Caption');
  const result = generalizeSemanticAnnotation(input, proposal, caption);

  assert.deepEqual(result.annotation.sections.map((section) => section.label), ['Appendage', 'Body', null]);
  assert.deepEqual(result.annotation.sections.map(({ startStepId, endStepId }) => [startStepId, endStepId]), [
    ['s1', 's1'], ['s2', 's2'], ['s3', 's3'],
  ]);
  assert.equal(result.annotation.sections[0].evidence, 'Proposal evidence 1.');
  assert.deepEqual(result.decisions[0], {
    chapter: 1,
    startStepId: 's1',
    endStepId: 's1',
    repeatGroupId: null,
    proposalLabel: 'Tail',
    captionLabel: 'Leg',
    proposalEvidence: 'Proposal evidence 1.',
    captionEvidence: 'Caption evidence 1.',
    label: 'Appendage',
    rule: 'shared-category',
    normalizedFirst: 'category:Appendage',
    normalizedSecond: 'category:Appendage',
    firstCategories: ['Appendage'],
    secondCategories: ['Appendage'],
  });
  assert.equal(result.decisions[2].rule, 'uncertain-choice');
  assert.equal(result.annotation.sections[2].confidence, 'uncertain');
});

test('rejects changed ranges and inconsistent protected repeat names', () => {
  const ordinary = fixture();
  const proposal = ordinary.annotation(['Body', 'Head', 'Details'], 'Proposal');
  const changedRanges = ordinary.annotation(['Body', 'Head', 'Details'], 'Caption');
  changedRanges.sections = [
    { ...changedRanges.sections[0], endStepId: 's2' },
    { ...changedRanges.sections[2], startStepId: 's3' },
  ];
  assert.throws(
    () => generalizeSemanticAnnotation(ordinary.input, proposal, changedRanges),
    /same exact chapter ranges|cover every step/,
  );

  const repeated = fixture({ repeated: true, sectionCount: 2 });
  assert.throws(
    () => generalizeSemanticAnnotation(
      repeated.input,
      repeated.annotation(['Wheel', 'Tire'], 'Proposal'),
      repeated.annotation(['Wheel', 'Wheel'], 'Caption'),
    ),
    /protected repeat chapters must use the same normalized label/,
  );
  const accepted = generalizeSemanticAnnotation(
    repeated.input,
    repeated.annotation(['Wheel', 'Wheel'], 'Proposal'),
    repeated.annotation(['Tire', 'Tire'], 'Caption'),
  );
  assert.deepEqual(accepted.annotation.sections.map((section) => section.label), ['Wheel', 'Wheel']);
  assert.ok(accepted.decisions.every((decision) => decision.repeatGroupId));
});
