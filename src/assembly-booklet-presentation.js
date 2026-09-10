import { createGuideSections } from './guide-sections.js';
import { deriveGuidePresentation } from './guide-presentation.js';
import { createGuideNumbering, formatGuideStepRange } from './guide-numbering.js';
import { escapeMarkup } from './part-illustration.js';
import { varyGuideSectionLabels } from './guide-label-variation.js';

const MAX_FLAT_SECTION_STEPS = 18;
const MIN_ORDINARY_SECTION_STEPS = 3;

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

function inventoryFor(bricks) {
  const entries = new Map();
  for (const brick of bricks) {
    const w = Math.min(brick.w, brick.d);
    const d = Math.max(brick.w, brick.d);
    const key = `${w}x${d}:${brick.color}`;
    const entry = entries.get(key) ?? { key, w, d, color: brick.color, count: 0 };
    entry.count += 1;
    entries.set(key, entry);
  }
  return [...entries.values()].sort((a, b) => a.w - b.w || a.d - b.d || a.color.localeCompare(b.color));
}

function partForGroups(id, groups, plan) {
  const stepsById = new Map(plan.steps.map(step => [step.id, step]));
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const stepIds = groups.flatMap(group => group.stepIds);
  const brickIds = groups.flatMap(group => group.brickIds);
  return {
    id,
    partIndex: 0,
    partCount: 1,
    stepRange: { start: 1, end: stepIds.length },
    groupIds: groups.map(group => group.id),
    stepIds,
    brickIds,
    brickCount: brickIds.length,
    inventory: inventoryFor(brickIds.map(brickId => bricksById.get(brickId))),
    status: groups.some(group => group.status === 'unresolved') ? 'unresolved' : 'ready',
  };
}

function flatSectionFromGroups(section, groups, sliceIndex, sliceCount, plan) {
  const stepsById = new Map(plan.steps.map(step => [step.id, step]));
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const stepIds = groups.flatMap(group => group.stepIds);
  const brickIds = groups.flatMap(group => group.brickIds);
  const moduleIds = [...new Set(stepIds.map(stepId => stepsById.get(stepId)?.moduleId).filter(Boolean))];
  const courses = brickIds.map(brickId => bricksById.get(brickId)?.y).filter(Number.isFinite);
  const id = `${section.id}-slice-${sliceIndex + 1}`;
  const part = partForGroups(`${id}-part`, groups, plan);
  return {
    ...section,
    id,
    status: part.status,
    moduleIds,
    stepIds,
    brickIds,
    brickCount: brickIds.length,
    inventory: part.inventory.map(entry => ({ ...entry })),
    totalInventory: part.inventory.map(entry => ({ ...entry })),
    courseRange: courses.length ? { min: Math.min(...courses), max: Math.max(...courses) } : null,
    groups,
    parts: [part],
    instances: section.instances.map(instance => ({ ...instance, brickIds: [...brickIds] })),
    displaySlice: {
      sourcePresentationSectionId: section.id,
      sourceReadingPartIds: section.parts
        .filter(sourcePart => sourcePart.groupIds.some(groupId => part.groupIds.includes(groupId)))
        .map(sourcePart => sourcePart.id),
      index: sliceIndex,
      count: sliceCount,
    },
  };
}

function stepCount(groups) {
  return groups.reduce((sum, group) => sum + group.stepIds.length, 0);
}

function mergeTinyGroupChunks(chunks) {
  const result = chunks.map(groups => [...groups]);
  while (result.length > 1) {
    let best = null;
    for (let index = 0; index < result.length; index += 1) {
      if (stepCount(result[index]) >= MIN_ORDINARY_SECTION_STEPS) continue;
      for (const neighbor of [index - 1, index + 1]) {
        if (neighbor < 0 || neighbor >= result.length) continue;
        const start = Math.min(index, neighbor);
        const total = stepCount(result[start]) + stepCount(result[start + 1]);
        if (total > MAX_FLAT_SECTION_STEPS) continue;
        if (!best || total < best.total || total === best.total && start < best.start) {
          best = { start, total };
        }
      }
    }
    if (!best) break;
    result.splice(best.start, 2, [...result[best.start], ...result[best.start + 1]]);
  }
  return result;
}

function splitOrdinarySection(section, plan) {
  if (section.repeatCount !== 1 || section.stepIds.length <= MAX_FLAT_SECTION_STEPS) return [section];
  const groupsById = new Map(section.groups.map(group => [group.id, group]));
  const chunks = mergeTinyGroupChunks(section.parts.map(part => part.groupIds.map(groupId => groupsById.get(groupId))));
  return chunks.map((groups, index) => flatSectionFromGroups(section, groups, index, chunks.length, plan));
}

function baseLabel(section) {
  return typeof section.baseLabel === 'string' ? section.baseLabel : section.label;
}

function normalizedBaseLabel(section) {
  return String(baseLabel(section) ?? '').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function hasNamedPurpose(section) {
  return (section.semanticConfidence === 'high' || section.semanticConfidence === 'inferred')
    && typeof section.semanticLabel === 'string' && section.semanticLabel.trim().length > 0;
}

function normalizedSemanticLabel(section) {
  return hasNamedPurpose(section)
    ? section.semanticLabel.trim().replace(/\s+/gu, ' ').toLowerCase()
    : '';
}

function hasSharedNamedPurpose(left, right) {
  const label = normalizedSemanticLabel(left);
  return label !== '' && label === normalizedSemanticLabel(right);
}

function sourcePresentationSectionIds(section) {
  if (Array.isArray(section.displayMerge?.sourcePresentationSectionIds)) {
    return section.displayMerge.sourcePresentationSectionIds;
  }
  return [section.displaySlice?.sourcePresentationSectionId ?? section.id];
}

function structuralRole(section, plan) {
  const modulesById = new Map(plan.modules.map(module => [module.id, module]));
  const modules = section.moduleIds.map(moduleId => modulesById.get(moduleId)).filter(Boolean);
  if (modules.some(module => module.buildContext?.kind === 'work-surface')) return 'work-surface';
  if (modules.length && modules.every(module => module.kind === 'detail' || /^Color detail/u.test(module.label))) {
    return 'finishing';
  }
  if (modules.some(module => module.kind === 'floating')) return 'floating';
  if (modules.length && modules.every(module => module.kind === 'grounded')) return 'grounded';
  return 'mixed';
}

function spatialGap(left, right, plan) {
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const bounds = section => {
    const bricks = section.brickIds.map(brickId => bricksById.get(brickId)).filter(Boolean);
    if (!bricks.length) return null;
    return {
      minX: Math.min(...bricks.map(brick => brick.x)),
      maxX: Math.max(...bricks.map(brick => brick.x + brick.w)),
      minY: Math.min(...bricks.map(brick => brick.y)),
      maxY: Math.max(...bricks.map(brick => brick.y)),
      minZ: Math.min(...bricks.map(brick => brick.z)),
      maxZ: Math.max(...bricks.map(brick => brick.z + brick.d)),
    };
  };
  const a = bounds(left);
  const b = bounds(right);
  if (!a || !b) return Infinity;
  const axisGap = (aMin, aMax, bMin, bMax) => Math.max(0, aMin - bMax, bMin - aMax);
  return Math.hypot(
    axisGap(a.minX, a.maxX, b.minX, b.maxX),
    axisGap(a.minY, a.maxY, b.minY, b.maxY) * 2,
    axisGap(a.minZ, a.maxZ, b.minZ, b.maxZ),
  );
}

function graphConnected(left, right, plan) {
  const leftIds = new Set(left.brickIds);
  const rightIds = new Set(right.brickIds);
  return (plan.graph?.edges ?? []).some(({ a, b }) =>
    leftIds.has(a) && rightIds.has(b) || leftIds.has(b) && rightIds.has(a));
}

function assemblyCompatible(left, right, plan) {
  const role = structuralRole(left, plan);
  if (role !== structuralRole(right, plan)) return false;
  if (role === 'finishing') return true;
  if (left.moduleIds.some(moduleId => right.moduleIds.includes(moduleId))) return true;
  if (graphConnected(left, right, plan)) return true;
  return spatialGap(left, right, plan) <= 4;
}

function compatibleAdjacentSections(left, right, plan) {
  const bothUnnamed = !hasNamedPurpose(left) && !hasNamedPurpose(right);
  const sharedNamedPurpose = hasSharedNamedPurpose(left, right);
  const hasTinySection = left.stepIds.length < MIN_ORDINARY_SECTION_STEPS
    || right.stepIds.length < MIN_ORDINARY_SECTION_STEPS;
  return left.repeatCount === 1
    && right.repeatCount === 1
    && normalizedBaseLabel(left) !== ''
    && normalizedBaseLabel(left) === normalizedBaseLabel(right)
    && (sharedNamedPurpose || (bothUnnamed && hasTinySection))
    && assemblyCompatible(left, right, plan)
    && left.stepIds.length + right.stepIds.length <= MAX_FLAT_SECTION_STEPS;
}

function mergeDisplaySections(left, right, plan) {
  const bricksById = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const groups = [...left.groups, ...right.groups];
  const stepIds = [...left.stepIds, ...right.stepIds];
  const brickIds = [...left.brickIds, ...right.brickIds];
  const moduleIds = [...new Set([...left.moduleIds, ...right.moduleIds])];
  const courses = brickIds.map(brickId => bricksById.get(brickId)?.y).filter(Number.isFinite);
  const sourceIds = [...sourcePresentationSectionIds(left), ...sourcePresentationSectionIds(right)];
  const id = `${sourceIds[0]}-through-${sourceIds.at(-1)}`;
  const part = partForGroups(`${id}-part`, groups, plan);
  const sharedNamedPurpose = hasSharedNamedPurpose(left, right);
  const semanticEvidence = sharedNamedPurpose
    ? [...new Set([left.semanticEvidence, right.semanticEvidence].filter(value => typeof value === 'string' && value.trim()))].join(' ')
    : '';
  return {
    ...left,
    id,
    label: baseLabel(left),
    baseLabel: baseLabel(left),
    semanticLabel: sharedNamedPurpose ? left.semanticLabel : null,
    semanticConfidence: sharedNamedPurpose
      ? left.semanticConfidence === 'high' && right.semanticConfidence === 'high' ? 'high' : 'inferred'
      : 'uncertain',
    semanticEvidence,
    status: part.status,
    moduleIds,
    stepIds,
    brickIds,
    brickCount: brickIds.length,
    inventory: part.inventory.map(entry => ({ ...entry })),
    totalInventory: part.inventory.map(entry => ({ ...entry })),
    courseRange: courses.length ? { min: Math.min(...courses), max: Math.max(...courses) } : null,
    groups,
    parts: [part],
    repeatCount: 1,
    representativeSectionId: left.representativeSectionId,
    sectionIds: [...left.sectionIds, ...right.sectionIds],
    instances: [...left.instances, ...right.instances],
    displaySlice: undefined,
    displayMerge: {
      sourcePresentationSectionIds: sourceIds,
      reason: 'compatible-adjacent-short-sections',
    },
  };
}

function combineCompatibleSections(sections, plan) {
  const result = [...sections];
  while (result.length > 1) {
    let best = null;
    for (let index = 0; index < result.length; index += 1) {
      for (const neighbor of [index - 1, index + 1]) {
        if (neighbor < 0 || neighbor >= result.length) continue;
        const start = Math.min(index, neighbor);
        const left = result[start];
        const right = result[start + 1];
        if (!compatibleAdjacentSections(left, right, plan)) continue;
        const total = left.stepIds.length + right.stepIds.length;
        const distance = spatialGap(left, right, plan);
        if (!best || total < best.total
          || total === best.total && distance < best.distance
          || total === best.total && distance === best.distance && start < best.start) {
          best = { start, total, distance };
        }
      }
    }
    if (!best) break;
    result.splice(best.start, 2, mergeDisplaySections(result[best.start], result[best.start + 1], plan));
  }
  return result;
}

function shortSectionReason(section, plan, sectionCount) {
  if (section.repeatCount > 1) return 'repeated recipe';
  if (sectionCount === 1) return 'complete guide';
  if (hasNamedPurpose(section)) return 'named assembly purpose';
  const stepsById = new Map(plan.steps.map(step => [step.id, step]));
  if (section.stepIds.every(stepId => {
    const step = stepsById.get(stepId);
    return step?.kind === 'join' || step?.newBrickIds?.length === 0;
  })) return 'attachment sequence';
  return 'distinct assembly purpose';
}

export function createFlatBookletPresentation(rawPresentation, plan) {
  if (!rawPresentation || !Array.isArray(rawPresentation.sections)) {
    throw new TypeError('Raw guide presentation must contain sections.');
  }
  if (!plan || !Array.isArray(plan.steps) || !Array.isArray(plan.bricks)) {
    throw new TypeError('Flat booklet presentation requires a plan with steps and bricks.');
  }

  const displaysBySourceId = new Map();
  let splitSectionCount = 0;
  const splitSections = rawPresentation.sections.flatMap(section => {
    const slices = splitOrdinarySection(section, plan);
    if (slices.length > 1) splitSectionCount += 1;
    return slices;
  });
  const sections = combineCompatibleSections(splitSections, plan);
  for (const section of sections) for (const sourceId of sourcePresentationSectionIds(section)) {
    const displays = displaysBySourceId.get(sourceId) ?? [];
    displays.push(section);
    displaysBySourceId.set(sourceId, displays);
  }
  const sequence = rawPresentation.sequence.flatMap(entry => {
    const displays = displaysBySourceId.get(entry.presentationSectionId) ?? [];
    return displays.map((section, sliceIndex) => ({
      ...entry,
      presentationSectionId: section.id,
      sourcePresentationSectionId: entry.presentationSectionId,
      sliceIndex,
      sliceCount: displays.length,
    }));
  });
  const representedIds = sections.flatMap(section =>
    section.instances.flatMap(instance => instance.brickIds));
  const maxStepsPerDisplaySection = Math.max(0, ...sections.map(section => section.stepIds.length));
  const minStepsPerDisplaySection = Math.min(...sections.map(section => section.stepIds.length));
  const shortSections = sections.filter(section => section.stepIds.length < MIN_ORDINARY_SECTION_STEPS);

  return {
    ...rawPresentation,
    version: 4,
    sections: varyGuideSectionLabels(sections),
    sequence,
    stats: {
      ...rawPresentation.stats,
      presentationSectionCount: sections.length,
      displayedSectionCount: sections.length,
      sourcePresentationSectionCount: rawPresentation.sections.length,
      splitSectionCount,
      mergedSectionCount: splitSections.length - sections.length,
      minStepsPerDisplaySection: Number.isFinite(minStepsPerDisplaySection) ? minStepsPerDisplaySection : 0,
      maxStepsPerDisplaySection,
      shortSectionCount: shortSections.length,
      shortSectionReasons: shortSections.map(section => ({
        sectionId: section.id,
        stepCount: section.stepIds.length,
        reason: shortSectionReason(section, plan, sections.length),
      })),
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
