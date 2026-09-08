import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveGuidePresentation } from '../src/guide-presentation.js';

const red = (x, z, y = 0) => ({ x, y, z, w: 1, d: 1, color: 'red' });

test('matching geometry with different insertion directions is not one repeated instruction', () => {
  const {plan,guide} = fixture([[red(0,0)],[red(5,0)]]);
  plan.steps[1].insertionDirection = 'up';
  const presentation = deriveGuidePresentation({plan,guide});
  assert.equal(presentation.sections.length,2);
  assert.ok(presentation.sections.every(section => section.repeatCount === 1));
});

function translated(parts, x, z, y = 0) {
  return parts.map((part) => ({ ...part, x: part.x + x, y: part.y + y, z: part.z + z }));
}

function rotatedOnce(parts, x, z) {
  const rotated = parts.map((part) => ({
    ...part,
    x: -part.z - part.d,
    z: part.x,
    w: part.d,
    d: part.w,
  }));
  const minX = Math.min(...rotated.map((part) => part.x));
  const minZ = Math.min(...rotated.map((part) => part.z));
  return translated(rotated, x - minX, z - minZ);
}

function fixture(sectionParts, { kinds = [], graphEdges = [] } = {}) {
  const bricks = [];
  const modules = [];
  const steps = [];
  const sections = [];
  for (let sectionIndex = 0; sectionIndex < sectionParts.length; sectionIndex += 1) {
    const brickIds = sectionParts[sectionIndex].map((part, partIndex) => {
      const id = `brick-${sectionIndex + 1}-${partIndex + 1}`;
      bricks.push({ id, ...part });
      return id;
    });
    const moduleId = `module-${sectionIndex + 1}`;
    const stepId = `step-${sectionIndex + 1}`;
    const sectionId = `section-${sectionIndex + 1}`;
    modules.push({
      id: moduleId,
      label: `Build area ${sectionIndex + 1}`,
      brickIds,
      kind: kinds[sectionIndex] ?? 'grounded',
      status: 'ready',
      componentIds: [`component-${sectionIndex + 1}`],
    });
    steps.push({
      id: stepId,
      moduleId,
      label: `Build area ${sectionIndex + 1} · add ${brickIds.length} bricks`,
      kind: 'build',
      newBrickIds: brickIds,
      visibleBrickIds: brickIds,
      highlightBrickIds: brickIds,
      issues: [],
    });
    sections.push({
      id: sectionId,
      label: `Build area ${sectionIndex + 1}`,
      status: 'ready',
      moduleIds: [moduleId],
      stepIds: [stepId],
      brickIds,
      brickCount: brickIds.length,
      inventory: [],
      courseRange: { min: 0, max: 0 },
      groups: [{
        id: `${sectionId}-group-1`, label: 'Build this layer', status: 'ready', stepIds: [stepId],
        brickIds, brickCount: brickIds.length, inventory: [],
      }],
    });
  }
  const inventory = [{ key: '1x1:red', w: 1, d: 1, color: 'red', count: bricks.length }];
  return {
    plan: { version: 1, bricks, modules, steps, graph: { edges: graphEdges }, inventory },
    guide: {
      version: 1,
      sections,
      stats: { sectionCount: sections.length, brickCount: bricks.length, coverageComplete: true },
    },
  };
}

function chapterFixture(groupSizes, unresolvedGroupIndex = -1) {
  const bricks = [];
  const steps = [];
  const groups = [];
  let stepNumber = 0;
  for (let groupIndex = 0; groupIndex < groupSizes.length; groupIndex += 1) {
    const stepIds = [];
    const brickIds = [];
    for (let index = 0; index < groupSizes[groupIndex]; index += 1) {
      stepNumber += 1;
      const brickId = `brick-${stepNumber}`;
      const stepId = `step-${stepNumber}`;
      bricks.push({ id: brickId, x: stepNumber - 1, y: 0, z: 0, w: 1, d: 1, color: 'red' });
      steps.push({
        id: stepId,
        moduleId: 'module-1',
        label: 'Add 1 brick',
        kind: groupIndex === unresolvedGroupIndex ? 'unresolved' : 'build',
        newBrickIds: [brickId],
        visibleBrickIds: [brickId],
        highlightBrickIds: [brickId],
        issues: groupIndex === unresolvedGroupIndex ? [{
          code: 'unsupported-addition', severity: 'error', message: 'Needs review.', brickIds: [brickId],
        }] : [],
      });
      stepIds.push(stepId);
      brickIds.push(brickId);
    }
    groups.push({
      id: `section-1-group-${groupIndex + 1}`,
      label: 'Build this layer',
      status: groupIndex === unresolvedGroupIndex ? 'unresolved' : 'ready',
      stepIds,
      brickIds,
      brickCount: brickIds.length,
      inventory: [],
    });
  }
  const brickIds = bricks.map(({ id }) => id);
  return {
    plan: {
      version: 1,
      bricks,
      modules: [{
        id: 'module-1', label: 'Build area 1', brickIds, kind: 'grounded', status: 'ready', componentIds: ['component-1'],
      }],
      steps,
      graph: { edges: [] },
      inventory: [{ key: '1x1:red', w: 1, d: 1, color: 'red', count: bricks.length }],
    },
    guide: {
      version: 1,
      sections: [{
        id: 'section-1',
        label: 'Build area 1',
        status: unresolvedGroupIndex === -1 ? 'ready' : 'unresolved',
        moduleIds: ['module-1'],
        stepIds: steps.map(({ id }) => id),
        brickIds,
        brickCount: brickIds.length,
        inventory: [],
        courseRange: { min: 0, max: 0 },
        groups,
      }],
      stats: { sectionCount: 1, brickCount: bricks.length, coverageComplete: true },
    },
  };
}

test('translated and quarter-turned copies share one exact repeated instruction', () => {
  const original = [
    { x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
    { x: 0, y: 1, z: 0, w: 1, d: 1, color: 'blue' },
  ];
  const { plan, guide } = fixture([original, rotatedOnce(original, 12, 8)]);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections.length, 1);
  assert.equal(presentation.sections[0].repeatCount, 2);
  assert.equal(presentation.sections[0].instances[1].transform.rotationQuarterTurns, 1);
  assert.deepEqual(presentation.sections[0].sectionIds, ['section-1', 'section-2']);
  assert.equal(presentation.sections[0].parts.length, 1);
  assert.equal(presentation.stats.coverageComplete, true);
});

test('oversized chapters split into bounded reading parts only at group boundaries', () => {
  const { plan, guide } = chapterFixture([4, 3, 4, 3], 3);
  const presentation = deriveGuidePresentation({ plan, guide });
  const { parts } = presentation.sections[0];

  assert.deepEqual(parts.map(({ groupIds }) => groupIds), [
    ['section-1-group-1', 'section-1-group-2', 'section-1-group-3'],
    ['section-1-group-4'],
  ]);
  assert.deepEqual(parts.map(({ stepIds }) => stepIds.length), [11, 3]);
  assert.deepEqual(parts.map(({ stepRange }) => stepRange), [{ start: 1, end: 11 }, { start: 12, end: 14 }]);
  assert.deepEqual(parts.map(({ status }) => status), ['ready', 'unresolved']);
  assert.deepEqual(parts.flatMap(({ brickIds }) => brickIds), guide.sections[0].brickIds);
  assert.equal(parts.flatMap(({ inventory }) => inventory).reduce((sum, entry) => sum + entry.count, 0), plan.bricks.length);
  assert.equal(presentation.stats.readingPartCount, 2);
  assert.equal(presentation.stats.maxStepsPerPart, 11);
});

test('chapters at the twelve-diagram bound remain one reading part', () => {
  const { plan, guide } = chapterFixture([4, 4, 4]);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections[0].parts.length, 1);
  assert.equal(presentation.sections[0].parts[0].stepIds.length, 12);
  assert.equal(presentation.stats.readingPartCount, 1);
  assert.equal(presentation.stats.maxStepsPerPart, 12);
});

test('mirrored placements and colored variants remain separate instructions', () => {
  const chiral = [red(0, 0), red(1, 0), red(1, 1), red(2, 1)];
  const mirrored = [red(2, 0), red(1, 0), red(1, 1), red(0, 1)];
  const recolored = translated(chiral, 0, 5).map((part, index) => index === 0 ? { ...part, color: 'blue' } : part);
  const { plan, guide } = fixture([chiral, translated(mirrored, 8, 0), recolored]);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections.length, 3);
  assert.deepEqual(presentation.sections.map(({ repeatCount }) => repeatCount), [1, 1, 1]);
  assert.equal(presentation.stats.collapsedSectionCount, 0);
});

test('nonconsecutive exact copies reuse instructions while retaining source build order', () => {
  const repeated = [red(0, 0), red(1, 0), red(1, 1)];
  const intervening = [red(4, 0), red(4, 1), red(4, 2), red(5, 2)];
  const { plan, guide } = fixture([repeated, intervening, translated(repeated, 10, 10)]);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections.length, 2);
  assert.deepEqual(presentation.sequence.map(({ sectionId }) => sectionId), ['section-1', 'section-2', 'section-3']);
  assert.deepEqual(presentation.sequence.map(({ presentationSectionId }) => presentationSectionId), [
    'presentation-1', 'presentation-2', 'presentation-1',
  ]);
  assert.deepEqual(presentation.sequence.map(({ instanceIndex }) => instanceIndex), [0, 0, 1]);
});

test('cross-section dependencies prevent repeat collapsing', () => {
  const repeated = [red(0, 0), red(1, 0)];
  const { plan, guide } = fixture([repeated, translated(repeated, 0, 5)]);
  plan.graph.edges.push({ a: 'brick-1-1', b: 'brick-2-1', studs: 1 });
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections.length, 2);
  assert.equal(presentation.stats.repeatedInstructionCount, 0);
});

test('different unresolved issue patterns prevent repeat collapsing', () => {
  const repeated = [red(0, 0), red(1, 0)];
  const { plan, guide } = fixture([repeated, translated(repeated, 0, 5)]);
  for (let index = 0; index < 2; index += 1) {
    plan.steps[index].kind = 'unresolved';
    plan.steps[index].issues = [{
      code: index ? 'temporary-hold' : 'unsupported-addition',
      severity: 'error',
      message: 'Needs review.',
      brickIds: [guide.sections[index].brickIds[0]],
    }];
    guide.sections[index].status = 'unresolved';
    guide.sections[index].groups[0].status = 'unresolved';
  }
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections.length, 2);
  assert.equal(presentation.stats.repeatedInstructionCount, 0);
});

test('presentation totals retain every original placement and the complete inventory', () => {
  const repeated = [red(0, 0), red(1, 0), red(1, 1)];
  const { plan, guide } = fixture([repeated, translated(repeated, 8, 0)]);
  const sourceInventory = plan.inventory;
  const sourceGuide = structuredClone(guide);
  const presentation = deriveGuidePresentation({ plan, guide });

  assert.equal(presentation.sections[0].inventory.reduce((sum, entry) => sum + entry.count, 0), 3);
  assert.equal(presentation.sections[0].totalInventory.reduce((sum, entry) => sum + entry.count, 0), 6);
  assert.equal(presentation.stats.brickCount, plan.bricks.length);
  assert.equal(presentation.stats.coverageComplete, true);
  assert.equal(presentation.inventory, sourceInventory);
  assert.deepEqual(guide, sourceGuide);
});

test('semantic labels control chapter meaning while arbitrary prompt wording has no labeling effect', () => {
  const repeated = [red(0, 0), red(1, 0)];
  const { plan, guide } = fixture([repeated, translated(repeated, 8, 0)]);
  const pickupLabels = deriveGuidePresentation({ plan, guide, subject: 'a red pickup truck' }).sections.map(({ label }) => label);
  const abstractLabels = deriveGuidePresentation({ plan, guide, subject: 'an abstract keepsake' }).sections.map(({ label }) => label);
  assert.deepEqual(pickupLabels, abstractLabels);

  guide.sections[0].semanticLabel = 'Front supports';
  guide.sections[0].semanticConfidence = 'high';
  guide.sections[1].semanticLabel = 'Rear supports';
  guide.sections[1].semanticConfidence = 'high';
  const distinct = deriveGuidePresentation({ plan, guide });
  assert.deepEqual(distinct.sections.map(({ label }) => label), ['Front supports', 'Rear supports']);
  assert.deepEqual(distinct.sections.map(({ repeatCount }) => repeatCount), [1, 1]);

  guide.sections[1].semanticLabel = ' front   SUPPORTS ';
  const repeatedPresentation = deriveGuidePresentation({ plan, guide });
  assert.equal(repeatedPresentation.sections.length, 1);
  assert.equal(repeatedPresentation.sections[0].repeatCount, 2);
  assert.equal(repeatedPresentation.sections[0].label, 'Front supports');
});

test('uncertain proposed labels use deterministic generic presentation copy', () => {
  const { plan, guide } = fixture([[red(0, 0)]]);
  guide.sections[0].semanticLabel = 'Speculative antenna';
  guide.sections[0].semanticConfidence = 'uncertain';
  guide.sections[0].semanticEvidence = 'The geometry is ambiguous.';

  const presentation = deriveGuidePresentation({ plan, guide });
  assert.equal(presentation.sections[0].label, 'Base');
  assert.equal(Object.hasOwn(presentation.sections[0], 'semanticEvidence'), false);
});
