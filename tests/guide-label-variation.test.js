import test from 'node:test';
import assert from 'node:assert/strict';

import { varyGuideSectionLabels } from '../src/guide-label-variation.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';

const section = (id, label, repeatCount = 1) => ({ id, label, repeatCount });

test('interleaved repeated labels receive deterministic one-word playful prefixes', () => {
  const source = [
    section('a1', 'Body panels'),
    section('detail', 'TV details'),
    section('a2', 'body panels'),
    section('a3', 'BODY PANELS'),
    section('a4', 'Body   panels'),
    section('a5', 'Body panels'),
    section('a6', 'Body panels'),
  ];
  const snapshot = structuredClone(source);
  const result = varyGuideSectionLabels(source);

  assert.deepEqual(result.map(({ label }) => label), [
    'Body panels',
    'TV details',
    'More body panels',
    'Extra BODY PANELS',
    'Yes, body   panels!',
    'Encore, body panels!',
    'More body panels',
  ]);
  assert.deepEqual(result.map(({ baseLabel }) => baseLabel), source.map(({ label }) => label));
  assert.deepEqual(source, snapshot);
  assert.ok(result.every((entry, index) => {
    const addedWords = entry.label.trim().split(/\s+/u).length - entry.baseLabel.trim().split(/\s+/u).length;
    return addedWords <= 1;
  }));
  assert.deepEqual(varyGuideSectionLabels(source), result);
  assert.deepEqual(varyGuideSectionLabels(result), result);
});

test('collapsed repeats remain unchanged and do not advance normal occurrence counts', () => {
  const result = varyGuideSectionLabels([
    section('repeat', 'Wheel', 2),
    section('single-1', 'Wheel'),
    section('repeat-again', ' wheel ', 3),
    section('single-2', 'wheel'),
  ]);
  assert.deepEqual(result.map(({ label }) => label), ['Wheel', 'Wheel', ' wheel ', 'More wheel']);
  assert.deepEqual(result.map(({ baseLabel }) => baseLabel), ['Wheel', 'Wheel', ' wheel ', 'wheel']);
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
  assert.deepEqual(presentation.sections.slice(1).map(({ label }) => label), ['Body', 'More body']);
  assert.deepEqual(presentation.sections.slice(1).map(({ baseLabel }) => baseLabel), ['Body', 'Body']);
  assert.deepEqual(presentation.sections[0].sectionIds, ['section-1', 'section-2']);
  assert.equal(presentation.stats.repeatedInstructionCount, 1);
  assert.equal(presentation.stats.coverageComplete, true);
  assert.deepEqual(guide, source);
  assert.equal(guide.semanticGuide.fingerprint, 'unchanged-fingerprint');
});
