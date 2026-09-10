import { createGuideSections } from './guide-sections.js';
import { deriveGuidePresentation } from './guide-presentation.js';
import { createGuideNumbering, formatGuideStepRange } from './guide-numbering.js';
import { escapeMarkup } from './part-illustration.js';
import { varyGuideSectionLabels } from './guide-label-variation.js';

const MAX_FLAT_SECTION_STEPS = 18;

export function guideRangeMarkup(range) {
  const formatted = formatGuideStepRange(range);
  const separator = formatted.indexOf('–');
  if (separator < 0) return escapeMarkup(formatted);
  return `${escapeMarkup(formatted.slice(0, separator))}<span class="manual-range-dash">–</span>${escapeMarkup(formatted.slice(separator + 1))}`;
}

export function createBookletPresentation(result, subject = null) {
  const sourcePlan = result.assemblyPlan;
  const plan = result.instructionPlan ?? sourcePlan;
  if (!plan) return null;
  const sourceGuide = result.guide ?? createGuideSections(plan);
  const guide = result.semanticGuide ?? sourceGuide;
  const rawPresentation = deriveGuidePresentation({ plan, guide, subject });
  const presentation = createFlatBookletPresentation(rawPresentation, plan);
  const numbering = createGuideNumbering(presentation.sections);
  return { sourcePlan, plan, sourceGuide, rawPresentation, presentation, numbering };
}

function flatSectionFromPart(section, part, sliceIndex, sliceCount, plan) {
  const groupIds = new Set(part.groupIds);
  const groups = section.groups.filter(group => groupIds.has(group.id));
  const stepsById = new Map(plan.steps.map(step => [step.id, step]));
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const moduleIds = [...new Set(part.stepIds.map(stepId => stepsById.get(stepId)?.moduleId).filter(Boolean))];
  const courses = part.brickIds.map(brickId => bricksById.get(brickId)?.y).filter(Number.isFinite);
  const id = `${section.id}-slice-${sliceIndex + 1}`;
  return {
    ...section,
    id,
    status: part.status,
    moduleIds,
    stepIds: [...part.stepIds],
    brickIds: [...part.brickIds],
    brickCount: part.brickIds.length,
    inventory: part.inventory.map(entry => ({ ...entry })),
    totalInventory: part.inventory.map(entry => ({ ...entry })),
    courseRange: courses.length ? { min: Math.min(...courses), max: Math.max(...courses) } : null,
    groups,
    parts: [{
      ...part,
      id: `${id}-part`,
      partIndex: 0,
      partCount: 1,
      stepRange: { start: 1, end: part.stepIds.length },
    }],
    instances: section.instances.map(instance => ({ ...instance, brickIds: [...part.brickIds] })),
    displaySlice: {
      sourcePresentationSectionId: section.id,
      sourceReadingPartId: part.id,
      index: sliceIndex,
      count: sliceCount,
    },
  };
}

export function createFlatBookletPresentation(rawPresentation, plan) {
  if (!rawPresentation || !Array.isArray(rawPresentation.sections)) {
    throw new TypeError('Raw guide presentation must contain sections.');
  }
  if (!plan || !Array.isArray(plan.steps) || !Array.isArray(plan.bricks)) {
    throw new TypeError('Flat booklet presentation requires a plan with steps and bricks.');
  }

  const slicesBySourceId = new Map();
  let splitSectionCount = 0;
  const sections = rawPresentation.sections.flatMap(section => {
    const shouldSplit = section.repeatCount === 1 && section.stepIds.length > MAX_FLAT_SECTION_STEPS;
    const slices = shouldSplit
      ? section.parts.map((part, index) => flatSectionFromPart(section, part, index, section.parts.length, plan))
      : [section];
    if (shouldSplit) splitSectionCount += 1;
    slicesBySourceId.set(section.id, slices);
    return slices;
  });
  const sequence = rawPresentation.sequence.flatMap(entry => {
    const slices = slicesBySourceId.get(entry.presentationSectionId) ?? [];
    return slices.map((section, sliceIndex) => ({
      ...entry,
      presentationSectionId: section.id,
      sourcePresentationSectionId: entry.presentationSectionId,
      sliceIndex,
      sliceCount: slices.length,
    }));
  });
  const representedIds = sections.flatMap(section =>
    section.instances.flatMap(instance => instance.brickIds));
  const maxStepsPerDisplaySection = Math.max(0, ...sections.map(section => section.stepIds.length));

  return {
    ...rawPresentation,
    version: 2,
    sections: varyGuideSectionLabels(sections),
    sequence,
    stats: {
      ...rawPresentation.stats,
      presentationSectionCount: sections.length,
      displayedSectionCount: sections.length,
      sourcePresentationSectionCount: rawPresentation.sections.length,
      splitSectionCount,
      maxStepsPerDisplaySection,
      brickCount: representedIds.length,
      coverageComplete: representedIds.length === plan.bricks.length
        && new Set(representedIds).size === plan.bricks.length,
    },
  };
}

export function resolveBookletInitialState(readerState, sectionCount, sections = []) {
  const byStep = readerState?.openChapterStepId
    ? sections.findIndex(section => section.groups.some(group => group.stepIds.includes(readerState.openChapterStepId)))
    : -1;
  const explicit = byStep >= 0 ? byStep : Number.isInteger(readerState?.openChapterIndex)
    ? Math.max(0, Math.min(sectionCount - 1, readerState.openChapterIndex))
    : -1;
  return {
    partsOpen: readerState?.partsOpen === true,
    openChapterIndex: explicit >= 0 ? explicit : readerState ? -1 : (sectionCount ? 0 : -1),
  };
}

export function createChapterDiagramData(section, plan, numbering) {
  const byStep = new Map(plan.steps.map(step => [step.id, step]));
  const specs = [];
  const groupFigures = new Map();
  for (const group of section.groups) {
    const figures = group.stepIds.map(id => {
      const step = byStep.get(id);
      if (!step) throw new RangeError(`Displayed guide references missing step ${id}.`);
      const joinContext = step.kind === 'join' ? step.joinContext : null;
      const spec = {
        stepId: id,
        visible: step.visibleBrickIds,
        highlight: step.highlightBrickIds,
        insertionDirection: step.insertionDirection,
        joinContext,
        unresolved: step.kind === 'unresolved' || Boolean(step.issues?.length),
        number: numbering.byStepId.get(id),
      };
      spec.index = specs.push(spec) - 1;
      return spec;
    });
    groupFigures.set(group.id, figures);
  }
  const parts = (section.parts?.length ? section.parts : [{ id: null, groupIds: section.groups.map(group => group.id) }]).map(part => ({
    ...part,
    figures: part.groupIds.flatMap(id => {
      const figures = groupFigures.get(id);
      if (!figures) throw new RangeError(`Reading range references missing group ${id}.`);
      return figures;
    }),
    range: part.id ? numbering.partRanges.get(part.id) : null,
  }));
  return { specs, parts };
}
