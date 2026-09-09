import { createGuideSections } from './guide-sections.js';
import { deriveGuidePresentation } from './guide-presentation.js';
import { createGuideNumbering, formatGuideStepRange } from './guide-numbering.js';
import { escapeMarkup } from './part-illustration.js';

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
  const presentation = deriveGuidePresentation({ plan, guide, subject });
  const numbering = createGuideNumbering(presentation.sections);
  return { sourcePlan, plan, sourceGuide, presentation, numbering };
}

export function resolveBookletInitialState(readerState, sectionCount) {
  const explicit = Number.isInteger(readerState?.openChapterIndex)
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
