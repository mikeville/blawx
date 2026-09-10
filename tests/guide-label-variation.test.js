import test from 'node:test';
import assert from 'node:assert/strict';

import { varyGuideSectionLabels } from '../src/guide-label-variation.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';

const section = (id, label, repeatCount = 1) => ({ id, label, repeatCount });

test('ordinary labels distinguish adjacent continuation from a later return', () => {
  const source = [section('a1', 'Body'), section('a2', 'body'), section('detail', 'Details'), section('a3', 'BODY')];
  const snapshot = structuredClone(source);
  const result = varyGuideSectionLabels(source);

  assert.equal(result[0].label, 'Body');
  assert.notEqual(result[1].label, result[0].label);
  assert.equal(result[2].label, 'Details');
  assert.notEqual(result[3].label.toLowerCase(), 'body');
  assert.notEqual(result[3].label.toLowerCase(), result[1].label.toLowerCase());
  assert.deepEqual(result.map(({ baseLabel }) => baseLabel), source.map(({ label }) => label));
  assert.deepEqual(source, snapshot);
  assert.deepEqual(varyGuideSectionLabels(source), result);
  assert.deepEqual(varyGuideSectionLabels(result), result);
});

test('ordinary templates share guide-wide history and avoid an obvious short cycle', () => {
  const twoNames = varyGuideSectionLabels([
    section('body-1', 'Body'), section('body-2', 'Body'),
    section('detail-1', 'Details'), section('detail-2', 'Details'),
  ]);
  const template = (label) => label.startsWith('More ') ? 'more'
    : label.endsWith(', continued') ? 'continued' : label.split(/[:, ]/u)[0].toLowerCase();
  assert.notEqual(template(twoNames[1].label), template(twoNames[3].label));

  const mainCase = varyGuideSectionLabels(Array.from({ length: 9 }, (_, index) => (
    section(`main-${index}`, 'Main shape')
  )));
  const followUps = mainCase.slice(1).map(({ label }) => template(label));
  assert.notDeepEqual(followUps.slice(0, 3), followUps.slice(3, 6));
  assert.ok(mainCase.every((entry, index) => index === 0 || entry.label !== mainCase[index - 1].label));
});

test('every repeated Base heading stays distinct across a long guide', () => {
  const result = varyGuideSectionLabels(Array.from({ length: 12 }, (_, index) => (
    section(`base-${index + 1}`, 'Base')
  )));

  assert.equal(result[0].label, 'Base');
  assert.equal(new Set(result.map(({ label }) => label.toLowerCase())).size, result.length);
  assert.equal(new Set(result.slice(1, 7).map(({ label }) => label)).size, 6);
  assert.ok(result.slice(1).every(({ label }) => !/\b(?:upper|lower|left|right|front|back|top|bottom)\b/iu.test(label)));
});

test('guide-wide template history varies transitions across different label families', () => {
  const source = ['Base', 'Base', 'Tower', 'Tower', 'Walls', 'Walls', 'Base', 'Tower', 'Walls'];
  const first = varyGuideSectionLabels(source.map((label, index) => section(`family-${index}`, label)));
  const second = varyGuideSectionLabels(source.map((label, index) => section(`family-${index}`, label)));
  const changed = first.filter(({ label, baseLabel }) => label !== baseLabel).map(({ label }) => label);

  assert.deepEqual(first, second);
  assert.equal(new Set(changed.map((label) => label.toLowerCase())).size, changed.length);
});

test('More is withheld from singular labels and titlecase lowering preserves acronyms', () => {
  const result = varyGuideSectionLabels([
    section('wheel-1', 'Wheel'), section('wheel-2', 'Wheel'), section('wheel-3', 'Wheel'),
    section('tv-1', 'TV panels'), section('tv-2', 'TV panels'),
    section('lego-1', 'LEGO details'), section('lego-2', 'LEGO details'),
  ]);
  assert.ok(result.slice(1, 3).every(({ label }) => !label.startsWith('More ')));
  assert.ok(result[4].label.includes('TV'));
  assert.ok(result[6].label.includes('LEGO'));
});

test('collapsed repeats remain unchanged and do not advance normal occurrence counts', () => {
  const result = varyGuideSectionLabels([
    section('repeat', 'Wheel', 2),
    section('single-1', 'Wheel'),
    section('repeat-again', ' wheel ', 3),
    section('single-2', 'wheel'),
  ]);
  assert.deepEqual(result.slice(0, 3).map(({ label }) => label), ['Wheel', 'Wheel', ' wheel ']);
  assert.notEqual(result[3].label, 'wheel');
  assert.deepEqual(result.map(({ baseLabel }) => baseLabel), ['Wheel', 'Wheel', ' wheel ', 'wheel']);
});

test('the finishing script is bounded and pays off only at the actual final entry', () => {
  const short = varyGuideSectionLabels([section('finish-1', 'Finishing touches'), section('finish-2', 'Finishing touches')]);
  assert.deepEqual(short.map(({ label }) => label), ['Finishing touches', 'Finishing touches. For real.']);

  const trailingDetails = varyGuideSectionLabels([
    section('finish-1', 'Finishing touches'),
    section('finish-2', 'Finishing touches'),
    section('finish-3', 'Finishing touches'),
    section('finish-4', 'Finishing touches'),
    section('details', 'Details'),
  ]);
  const middle = trailingDetails.slice(1, 4).map(({ label }) => label);
  assert.equal(new Set(middle).size, 3);
  assert.equal(middle[0], 'Oops. More finishing touches.');
  assert.ok(middle.every((label) => !label.includes('For real')));
  const okayIndex = middle.findIndex((label) => label.startsWith('Okay,'));
  assert.ok(okayIndex === -1 || okayIndex === middle.length - 1);

  const nonconsecutivePayoff = varyGuideSectionLabels([
    section('finish-1', 'Finishing touches'), section('details', 'Details'), section('finish-2', 'Finishing touches'),
  ]);
  assert.equal(nonconsecutivePayoff.at(-1).label, 'Finishing touches. For real.');
});

test('long finishing runs use unique beats before the actual final payoff', () => {
  const result = varyGuideSectionLabels([
    ...Array.from({ length: 11 }, (_, index) => section(`finish-${index}`, 'Finishing touches')),
    section('actual-final', 'Details'),
  ]);
  const finishingLabels = result.slice(0, -1).map(({ label }) => label);

  assert.equal(finishingLabels[1], 'Oops. More finishing touches.');
  assert.equal(new Set(finishingLabels).size, finishingLabels.length);
  assert.ok(finishingLabels.every((label) => !label.includes('For real')));
});

test('ordinary jokes stay sparse and become scarcer when the finishing script repeats', () => {
  const labels = [];
  for (let index = 0; index < 14; index += 1) {
    labels.push('Body', `Separator ${index}`);
  }
  const jokeIndexes = varyGuideSectionLabels(labels.map((label, index) => section(`plain-${index}`, label)))
    .flatMap(({ label }, index) => /^(?:Hello|Ah),/u.test(label) ? [index] : []);
  assert.ok(jokeIndexes.length <= 2);
  assert.ok(jokeIndexes.every((index, position) => position === 0 || index - jokeIndexes[position - 1] >= 2));

  const withFinishing = [...labels, 'Finishing touches', 'Gap', 'Finishing touches'];
  const finishingJokes = varyGuideSectionLabels(withFinishing.map((label, index) => section(`finish-${index}`, label)))
    .filter(({ label }) => /^(?:Hello|Ah),/u.test(label));
  assert.ok(finishingJokes.length <= 1);
});

function presentationFixture() {
  const bricks = [
    { id: 'brick-1', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'red' },
    { id: 'brick-2', x: 4, y: 0, z: 0, w: 1, d: 1, color: 'red' },
    { id: 'brick-3', x: 8, y: 0, z: 0, w: 1, d: 1, color: 'blue' },
    { id: 'brick-4', x: 12, y: 0, z: 0, w: 1, d: 1, color: 'green' },
  ];
  const modules = bricks.map((brick, index) => ({
    id: `module-${index + 1}`,
    label: `Module ${index + 1}`,
    brickIds: [brick.id],
    kind: 'grounded',
    status: 'ready',
    componentIds: [`component-${index + 1}`],
  }));
  const steps = bricks.map((brick, index) => ({
    id: `step-${index + 1}`,
    moduleId: `module-${index + 1}`,
    label: 'Add brick',
    kind: 'build',
    newBrickIds: [brick.id],
    visibleBrickIds: [brick.id],
    highlightBrickIds: [brick.id],
    issues: [],
  }));
  const sections = bricks.map((brick, index) => ({
    id: `section-${index + 1}`,
    label: `Section ${index + 1}`,
    semanticLabel: index < 2 ? 'Wheel' : 'Body',
    semanticConfidence: 'high',
    status: 'ready',
    moduleIds: [`module-${index + 1}`],
    stepIds: [`step-${index + 1}`],
    brickIds: [brick.id],
    brickCount: 1,
    inventory: [],
    courseRange: { min: 0, max: 0 },
    groups: [{
      id: `group-${index + 1}`,
      label: 'Build this layer',
      status: 'ready',
      stepIds: [`step-${index + 1}`],
      brickIds: [brick.id],
      brickCount: 1,
      inventory: [],
    }],
  }));
  return {
    plan: {
      version: 1,
      bricks,
      modules,
      steps,
      graph: { edges: [] },
      inventory: [],
    },
    guide: {
      version: 1,
      semanticGuide: { fingerprint: 'unchanged-fingerprint' },
      sections,
      stats: { sectionCount: sections.length, brickCount: bricks.length, coverageComplete: true },
    },
  };
}

test('presentation decorates after exact repeat collapse without changing source provenance', () => {
  const { plan, guide } = presentationFixture();
  const source = structuredClone(guide);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections[0].repeatCount, 2);
  assert.equal(presentation.sections[0].label, 'Wheel');
  assert.equal(presentation.sections[0].baseLabel, 'Wheel');
  assert.equal(presentation.sections[1].label, 'Body');
  assert.notEqual(presentation.sections[2].label, 'Body');
  assert.deepEqual(presentation.sections.slice(1).map(({ baseLabel }) => baseLabel), ['Body', 'Body']);
  assert.deepEqual(presentation.sections[0].sectionIds, ['section-1', 'section-2']);
  assert.equal(presentation.stats.repeatedInstructionCount, 1);
  assert.equal(presentation.stats.coverageComplete, true);
  assert.deepEqual(guide, source);
  assert.equal(guide.semanticGuide.fingerprint, 'unchanged-fingerprint');
});
