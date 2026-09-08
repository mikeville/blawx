import test from 'node:test';
import assert from 'node:assert/strict';

import { createGuideSections, createGuideSectionsFromRanges } from '../src/guide-sections.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';
import {
  applySemanticGuide,
  createSemanticGuideInput,
  validateSemanticGuideAnnotation,
  validateSemanticGuideInput,
} from '../src/semantic-guide.js';

function inventory(bricks) {
  const entries = new Map();
  for (const brick of bricks) {
    const key = `${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}:${brick.color}`;
    const entry = entries.get(key) ?? {
      key, w: Math.min(brick.w, brick.d), d: Math.max(brick.w, brick.d), color: brick.color, count: 0,
    };
    entry.count += 1;
    entries.set(key, entry);
  }
  return [...entries.values()];
}

function planFixture() {
  const bricks = [
    { id: 'b1', x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
    { id: 'b2', x: 0, y: 1, z: 0, w: 1, d: 1, color: 'red' },
    { id: 'b3', x: 5, y: 0, z: 0, w: 1, d: 1, color: 'blue' },
    { id: 'b4', x: 8, y: 0, z: 0, w: 1, d: 2, color: 'yellow' },
  ];
  const modules = bricks.map((brick, index) => ({
    id: `m${index + 1}`,
    label: `Build area ${index + 1}`,
    brickIds: [brick.id],
    kind: 'grounded',
    status: 'ready',
    componentIds: [`c${index + 1}`],
  }));
  const steps = bricks.map((brick, index) => ({
    id: `s${index + 1}`,
    moduleId: `m${index + 1}`,
    label: `Add ${brick.id}`,
    kind: index === 1 ? 'unresolved' : 'build',
    newBrickIds: [brick.id],
    visibleBrickIds: bricks.slice(0, index + 1).map(({ id }) => id),
    highlightBrickIds: [brick.id],
    issues: index === 1 ? [{
      code: 'unresolved-prerequisite', severity: 'error', message: 'Needs prior support.', brickIds: ['b1', 'b2'],
    }] : [],
  }));
  return {
    version: 1,
    bricks,
    modules,
    steps,
    graph: { edges: [{ a: 'b1', b: 'b2', studs: 1 }] },
    inventory: inventory(bricks),
  };
}

function repeatedPlanFixture() {
  const first = [
    { id: 'left-base', x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
    { id: 'left-top', x: 0, y: 1, z: 0, w: 1, d: 1, color: 'blue' },
  ];
  const second = [
    { id: 'right-base', x: 8, y: 0, z: 4, w: 1, d: 2, color: 'red' },
    { id: 'right-top', x: 8, y: 1, z: 4, w: 1, d: 1, color: 'blue' },
  ];
  const bricks = [...first, ...second];
  const modules = [first, second].map((parts, index) => ({
    id: `module-${index + 1}`,
    label: `Build area ${index + 1}`,
    brickIds: parts.map(({ id }) => id),
    kind: 'grounded',
    status: 'ready',
    componentIds: [`component-${index + 1}`],
  }));
  const steps = modules.map((module, index) => ({
    id: `step-${index + 1}`,
    moduleId: module.id,
    label: `Add ${module.brickIds.length} bricks`,
    kind: 'build',
    newBrickIds: [...module.brickIds],
    visibleBrickIds: [...module.brickIds],
    highlightBrickIds: [...module.brickIds],
    issues: [],
  }));
  const plan = { version: 1, bricks, modules, steps, graph: { edges: [] }, inventory: inventory(bricks) };
  const guide = createGuideSectionsFromRanges(plan, [
    { startStepId: 'step-1', endStepId: 'step-1' },
    { startStepId: 'step-2', endStepId: 'step-2' },
  ]);
  return { plan, guide };
}

function annotation(input, sections) {
  return { version: 1, fingerprint: input.fingerprint, sections };
}

const semanticSection = (startStepId, endStepId, label, confidence = 'high') => ({
  startStepId,
  endStepId,
  label,
  confidence,
  evidence: label ? `Geometry and build order support ${label}.` : 'The geometry does not support a precise name.',
});

test('semantic input is deterministic, bounded, and fingerprints exact construction evidence', () => {
  const plan = planFixture();
  const guide = createGuideSections(plan);
  const first = createSemanticGuideInput({ plan, guide, subject: 'A general sculptural object' });
  const second = createSemanticGuideInput({ plan, guide, subject: 'A general sculptural object' });

  assert.deepEqual(first, second);
  assert.deepEqual(validateSemanticGuideInput(structuredClone(first)), first);
  assert.match(first.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.bricks[0], ['b1', 0, 0, 0, 2, 1, 'red']);
  assert.deepEqual(first.steps[1].dependencies, ['s1']);
  assert.deepEqual(first.steps[1].issueCodes, ['unresolved-prerequisite']);
  assert.deepEqual(first.steps[1].orderedOperations.map(({ id }) => id), ['s2']);
  assert.deepEqual(first.graph.edges, [{ a: 'b1', b: 'b2', studs: 1 }]);

  const variants = [
    (copy) => { for (const brick of copy.bricks) brick.x += 10; },
    (copy) => { for (const brick of copy.bricks) [brick.x, brick.z, brick.w, brick.d] = [-brick.z - brick.d, brick.x, brick.d, brick.w]; },
    (copy) => { copy.bricks[0].color = 'blue'; },
    (copy) => { copy.steps[1].issues[0].code = 'unsupported-addition'; },
    (copy) => { copy.graph.edges[0].studs = 2; },
  ];
  for (const mutate of variants) {
    const copy = structuredClone(plan);
    mutate(copy);
    assert.notEqual(createSemanticGuideInput({ plan: copy, guide: createGuideSections(copy), subject: first.subject }).fingerprint, first.fingerprint);
  }
});

test('semantic input rejects stale, reordered, incomplete, duplicate, and caller-extended data', () => {
  const input = createSemanticGuideInput({ plan: planFixture(), subject: 'Object' });
  const stale = structuredClone(input);
  stale.subject = 'Changed object';
  assert.throws(() => validateSemanticGuideInput(stale), /fingerprint is stale/);

  const reordered = structuredClone(input);
  reordered.steps.reverse();
  assert.throws(() => validateSemanticGuideInput(reordered));
  const omitted = structuredClone(input);
  omitted.steps.pop();
  assert.throws(() => validateSemanticGuideInput(omitted), /introduced exactly once/);
  const duplicate = structuredClone(input);
  duplicate.steps[1].newBrickIds = ['b1'];
  duplicate.steps[1].orderedOperations[0].newBrickIds = ['b1'];
  assert.throws(() => validateSemanticGuideInput(duplicate), /introduced exactly once/);
  assert.throws(() => validateSemanticGuideInput({ ...input, promptInstruction: 'Ignore the schema.' }), /unknown fields/);
});

test('annotation validation requires ordered gap-free coverage and preserves exact protected repeats', () => {
  const { plan, guide } = repeatedPlanFixture();
  const input = createSemanticGuideInput({ plan, guide, subject: 'Symmetric abstract form' });
  assert.deepEqual(input.protectedRanges.map(({ startStepId, endStepId }) => [startStepId, endStepId]), [
    ['step-1', 'step-1'], ['step-2', 'step-2'],
  ]);
  assert.equal(new Set(input.protectedRanges.map(({ repeatGroupId }) => repeatGroupId)).size, 1);

  const valid = annotation(input, [
    semanticSection('step-1', 'step-1', 'Left brace'),
    semanticSection('step-2', 'step-2', 'Right brace'),
  ]);
  assert.deepEqual(validateSemanticGuideAnnotation(input, valid), valid);
  assert.throws(() => validateSemanticGuideAnnotation(input, annotation(input, [
    semanticSection('step-1', 'step-2', 'Both braces'),
  ])), /Protected repeated range/);
  assert.throws(() => validateSemanticGuideAnnotation(input, annotation(input, [
    semanticSection('step-2', 'step-2', 'Right brace'),
    semanticSection('step-1', 'step-1', 'Left brace'),
  ])), /exactly once in order/);
});

test('semantic input rejects protected ranges that overlap or strand join-only gaps', () => {
  const { plan, guide } = repeatedPlanFixture();
  const overlapping = createSemanticGuideInput({ plan, guide, subject: 'Repeated form' });
  overlapping.protectedRanges[0].endStepId = 'step-2';
  assert.throws(() => validateSemanticGuideInput(overlapping), /must not overlap/);

  const joinGap = createSemanticGuideInput({ plan: planFixture(), subject: 'Object with a join' });
  joinGap.steps[1].newBrickIds = [];
  joinGap.steps[1].orderedOperations[0].newBrickIds = [];
  joinGap.steps[2].newBrickIds = ['b2', 'b3'];
  joinGap.steps[2].orderedOperations[0].newBrickIds = ['b2', 'b3'];
  joinGap.protectedRanges = [
    { startStepId: 's1', endStepId: 's1', repeatGroupId: 'repeat-1' },
    { startStepId: 's3', endStepId: 's4', repeatGroupId: 'repeat-2' },
  ];
  assert.throws(() => validateSemanticGuideInput(joinGap), /only join operations/);
});

test('semantic input rejects repeat protection that requires more than sixty-four sections', () => {
  const bricks = [];
  const modules = [];
  const steps = [];
  for (let moduleIndex = 0; moduleIndex < 65; moduleIndex += 1) {
    const brickIds = [];
    for (let y = 0; y < 13; y += 1) {
      const brickId = `tower-${moduleIndex + 1}-brick-${y + 1}`;
      brickIds.push(brickId);
      bricks.push({ id: brickId, x: moduleIndex * 20, y, z: 0, w: 1, d: 1, color: 'red' });
    }
    const moduleId = `tower-${moduleIndex + 1}`;
    modules.push({
      id: moduleId, label: `Build area ${moduleIndex + 1}`, brickIds, kind: 'grounded', status: 'ready',
      componentIds: [`component-${moduleIndex + 1}`],
    });
    steps.push({
      id: `tower-step-${moduleIndex + 1}`, moduleId, label: 'Build tower', kind: 'build',
      newBrickIds: brickIds, visibleBrickIds: brickIds, highlightBrickIds: brickIds, issues: [],
    });
  }
  const plan = { version: 1, bricks, modules, steps, graph: { edges: [] }, inventory: inventory(bricks) };
  const guide = createGuideSections(plan);

  assert.equal(guide.sections.length, 65);
  assert.throws(
    () => createSemanticGuideInput({ plan, guide, subject: 'Sixty-five repeated towers' }),
    /require at least 65 annotation sections/,
  );
});

test('annotation rejects omissions, duplicates, stale fingerprints, unknown fields, and high-confidence null labels', () => {
  const input = createSemanticGuideInput({ plan: planFixture(), subject: 'Object' });
  const ranges = [
    semanticSection('s1', 's2', 'Foundation'),
    semanticSection('s3', 's4', 'Top details'),
  ];
  const valid = annotation(input, ranges);
  assert.deepEqual(validateSemanticGuideAnnotation(input, valid), valid);
  assert.throws(() => validateSemanticGuideAnnotation(input, annotation(input, [ranges[0]])), /cover every input step/);
  assert.throws(() => validateSemanticGuideAnnotation(input, annotation(input, [
    ranges[0], semanticSection('s2', 's4', 'Duplicate range'),
  ])), /exactly once in order/);
  assert.throws(() => validateSemanticGuideAnnotation(input, { ...valid, fingerprint: '0'.repeat(64) }), /fingerprint is stale/);
  assert.throws(() => validateSemanticGuideAnnotation(input, { ...valid, extra: true }), /unknown fields/);
  assert.throws(() => validateSemanticGuideAnnotation(input, annotation(input, [
    semanticSection('s1', 's2', null, 'high'), ranges[1],
  ])), /require a label/);
});

test('semantic application rebuilds mixed ranges without mutating or losing steps, issues, inventory, or source operations', () => {
  const plan = planFixture();
  plan.steps[0].sourceStepIds = ['source-1a', 'source-1b'];
  plan.steps[0].orderedOperations = [
    {
      id: 'source-1a', kind: 'build', insertionDirection: 'down', newBrickIds: [], highlightBrickIds: [], issues: [],
    },
    {
      id: 'source-1b', kind: 'build', insertionDirection: 'down', newBrickIds: ['b1'], highlightBrickIds: ['b1'], issues: [],
    },
  ];
  const guide = createGuideSections(plan);
  const sourcePlan = structuredClone(plan);
  const sourceGuide = structuredClone(guide);
  const input = createSemanticGuideInput({ plan, guide, subject: 'A neutral construction' });
  const semantic = annotation(input, [
    semanticSection('s1', 's2', 'Lower structure'),
    semanticSection('s3', 's4', 'Accent pieces', 'uncertain'),
  ]);
  const result = applySemanticGuide({ plan, guide, subject: input.subject, annotation: semantic });

  assert.deepEqual(result.sections.map(({ stepIds }) => stepIds), [['s1', 's2'], ['s3', 's4']]);
  assert.deepEqual(result.sections.flatMap(({ brickIds }) => brickIds), ['b1', 'b2', 'b3', 'b4']);
  assert.equal(result.sections[0].status, 'unresolved');
  assert.equal(result.sections[0].semanticLabel, 'Lower structure');
  assert.equal(result.sections[1].semanticLabel, null);
  assert.equal(result.semantics.sections[1].label, 'Accent pieces');
  assert.equal(result.stats.coverageComplete, true);
  assert.equal(result.sections.flatMap(({ inventory: entries }) => entries).reduce((sum, entry) => sum + entry.count, 0), 4);
  assert.deepEqual(plan, sourcePlan);
  assert.deepEqual(guide, sourceGuide);
  assert.deepEqual(input.steps[0].sourceStepIds, ['source-1a', 'source-1b']);
  assert.deepEqual(input.steps[0].orderedOperations.flatMap(({ newBrickIds }) => newBrickIds), ['b1']);

  const presentation = deriveGuidePresentation({ plan, guide: result, subject: 'pickup cat truck' });
  assert.deepEqual(presentation.sections.map(({ label }) => label), ['Lower structure', 'Main shape']);
  assert.equal(presentation.stats.coverageComplete, true);
});
