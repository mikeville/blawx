import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { createGuideSections, createGuideSectionsFromRanges } from '../src/guide-sections.js';

const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });
const model = (bricks) => ({ version: 1, kind: 'bricks', bricks });

test('an underside viewpoint starts a separate group while preserving assembly order', () => {
  const plan = syntheticPlan({moduleSizes:[3],steps:[{count:1},{count:1},{count:1}]});
  plan.steps[1].insertionDirection = 'up';
  const guide = createGuideSections(plan);
  assert.deepEqual(guide.sections.flatMap(section=>section.groups.map(group=>group.stepIds)),[['step-1'],['step-2'],['step-3']]);
  assert.equal(guide.stats.coverageComplete,true);
});

test('range sections retain usable inferred labels and discard uncertain proposals', () => {
  const plan = syntheticPlan({ moduleSizes: [2], steps: [{ count: 1 }, { count: 1 }] });
  const guide = createGuideSectionsFromRanges(plan, [
    { startStepId: 'step-1', endStepId: 'step-1', label: 'Lower frame', confidence: 'inferred' },
    { startStepId: 'step-2', endStepId: 'step-2', label: 'Possible antenna', confidence: 'uncertain' },
  ]);

  assert.deepEqual(guide.sections.map(({ label }) => label), ['Lower frame', 'Build section 2']);
  assert.deepEqual(guide.sections.map(({ semanticLabel }) => semanticLabel), ['Lower frame', null]);
  assert.deepEqual(guide.sections.map(({ semanticConfidence }) => semanticConfidence), ['inferred', 'uncertain']);
  assert.equal(guide.stats.coverageComplete, true);
});

function syntheticPlan({ moduleSizes, steps }) {
  const bricks = [];
  const modules = moduleSizes.map((size, moduleIndex) => {
    const brickIds = [];
    for (let index = 0; index < size; index += 1) {
      const id = `brick-${bricks.length + 1}`;
      brickIds.push(id);
      bricks.push({ id, x: index % 20, y: Math.floor(index / 20), z: moduleIndex * 30, w: 1, d: 1, color: moduleIndex ? 'blue' : 'red' });
    }
    return { id: `module-${moduleIndex + 1}`, label: `Build area ${moduleIndex + 1}`, brickIds, status: 'ready', kind: 'grounded', componentIds: [`component-${moduleIndex + 1}`] };
  });
  const offsets = new Map();
  const publicSteps = steps.map(({ moduleIndex = 0, count, kind = 'build', issues = [] }, index) => {
    const offset = offsets.get(moduleIndex) ?? 0;
    const newBrickIds = modules[moduleIndex].brickIds.slice(offset, offset + count);
    offsets.set(moduleIndex, offset + count);
    return {
      id: `step-${index + 1}`,
      moduleId: modules[moduleIndex].id,
      label: `Add ${count}`,
      kind,
      newBrickIds,
      visibleBrickIds: newBrickIds,
      highlightBrickIds: newBrickIds,
      issues,
    };
  });
  return { version: 1, bricks, modules, steps: publicSteps };
}

test('large build areas split into course-based milestones with complete hierarchy inventory', () => {
  const plan = syntheticPlan({
    moduleSizes: [160],
    steps: Array.from({ length: 16 }, () => ({ count: 10 })),
  });
  const guide = createGuideSections(plan);

  assert.equal(guide.sections.length, 2);
  assert.match(guide.sections[0].label, /foundation/);
  assert.match(guide.sections[1].label, /upper section/);
  assert.equal(Math.max(...guide.sections.map(({ brickCount }) => brickCount)) <= 120, true);
  assert.deepEqual(guide.sections.flatMap(({ stepIds }) => stepIds), plan.steps.map(({ id }) => id));
  assert.deepEqual(guide.sections.flatMap(({ brickIds }) => brickIds), plan.steps.flatMap(({ newBrickIds }) => newBrickIds));
  assert.equal(guide.sections.flatMap(({ inventory }) => inventory).reduce((sum, entry) => sum + entry.count, 0), plan.bricks.length);
  assert.equal(guide.stats.coverageComplete, true);
  assert.equal(guide.stats.substepCount, plan.steps.length);
});

test('groups retain ordered substeps and roll up failures without mixing joins into additions', () => {
  const issue = { code: 'unsupported-addition', severity: 'error', message: 'Needs review.', brickIds: ['brick-3'] };
  const plan = syntheticPlan({
    moduleSizes: [5],
    steps: [
      { count: 1 },
      { count: 1 },
      { count: 1, kind: 'unresolved', issues: [issue] },
      { count: 1, kind: 'unresolved', issues: [issue] },
      { count: 1 },
    ],
  });
  plan.steps.push({
    id: 'step-6', moduleId: 'module-1', label: 'Join Build area 1', kind: 'join',
    newBrickIds: [], visibleBrickIds: plan.modules[0].brickIds, highlightBrickIds: plan.modules[0].brickIds, issues: [],
  });
  const guide = createGuideSections(plan);
  const groups = guide.sections[0].groups;

  assert.deepEqual(groups.flatMap(({ stepIds }) => stepIds), plan.steps.map(({ id }) => id));
  assert.equal(groups.some((group) => group.stepIds.includes('step-3') && group.status === 'unresolved'), true);
  assert.deepEqual(groups.at(-1).stepIds, ['step-6']);
  assert.equal(plan.steps[2].issues[0].code, 'unsupported-addition');
});

test('tiny consecutive grounded and color-detail modules become one finishing section without merging their step groups', () => {
  const plan = syntheticPlan({
    moduleSizes: [2, 2],
    steps: [
      { moduleIndex: 0, count: 2 },
      { moduleIndex: 1, count: 2 },
    ],
  });
  plan.modules[1].kind = 'detail';
  plan.modules[1].label = 'Color detail 1';
  const guide = createGuideSections(plan);

  assert.equal(guide.sections.length, 1);
  assert.equal(guide.sections[0].label, 'Finishing details');
  assert.deepEqual(guide.sections[0].moduleIds, ['module-1', 'module-2']);
  assert.deepEqual(guide.sections[0].groups.map(({ stepIds }) => stepIds), [['step-1'], ['step-2']]);
});

test('real unresolved dependencies remain explicit after hierarchy projection', () => {
  const plan = createAssemblyPlan({ brickModel: model([
    brick(0, 0, 0), brick(0, 1, 0), brick(0, 2, 0, 3, 1), brick(1, 1, 0), brick(2, 1, 0),
  ]) });
  const guide = createGuideSections(plan);

  assert.deepEqual(guide.sections.flatMap(({ stepIds }) => stepIds), plan.steps.map(({ id }) => id));
  assert.equal(plan.stats.rootFailureCount, 2);
  assert.equal(plan.steps.flatMap(({ issues }) => issues).filter(({ code }) => code === 'unresolved-prerequisite').length, 1);
  assert.equal(guide.sections.some(({ status }) => status === 'unresolved'), true);
});
