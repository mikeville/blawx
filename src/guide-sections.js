const LARGE_SECTION_THRESHOLD = 120;
const SECTION_TARGET_BRICKS = 80;
const SECTION_MAX_BRICKS = 100;
const TINY_GROUNDED_MODULE_BRICKS = 12;
const MAX_GROUP_STEPS = 4;
const MAX_GROUP_SPAN = 24;
const MAX_GROUP_COURSE_SPAN = 3;

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

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  const bricksById = new Map();
  for (const brick of plan.bricks) {
    if (typeof brick?.id !== 'string' || bricksById.has(brick.id)) throw new RangeError('Plan brick IDs must be unique strings.');
    bricksById.set(brick.id, brick);
  }
  const modulesById = new Map();
  for (const module of plan.modules) {
    if (typeof module?.id !== 'string' || modulesById.has(module.id)) throw new RangeError('Plan module IDs must be unique strings.');
    modulesById.set(module.id, module);
  }
  const stepIds = new Set();
  const introduced = new Set();
  for (const step of plan.steps) {
    if (typeof step?.id !== 'string' || stepIds.has(step.id)) throw new RangeError('Plan step IDs must be unique strings.');
    if (!modulesById.has(step.moduleId)) throw new RangeError(`Step ${step.id} references an unknown module.`);
    stepIds.add(step.id);
    for (const brickId of step.newBrickIds ?? []) {
      if (!bricksById.has(brickId)) throw new RangeError(`Step ${step.id} introduces an unknown brick.`);
      if (introduced.has(brickId)) throw new RangeError(`Brick ${brickId} is introduced more than once.`);
      introduced.add(brickId);
    }
  }
  if (introduced.size !== bricksById.size) throw new RangeError('Guide sections require complete plan brick coverage.');
  return { bricksById, modulesById };
}

function stepBrickCount(step) {
  return step.newBrickIds.length;
}

function stepCourse(step, bricksById) {
  const courses = step.newBrickIds.map((id) => bricksById.get(id).y);
  return courses.length ? Math.min(...courses) : null;
}

function splitLargeModuleSteps(steps, bricksById) {
  const total = steps.reduce((sum, step) => sum + stepBrickCount(step), 0);
  if (total < LARGE_SECTION_THRESHOLD) return [steps];
  const sectionCount = Math.ceil(total / SECTION_TARGET_BRICKS);
  const chunks = [];
  let start = 0;
  let remainingBricks = total;
  for (let sectionIndex = 0; sectionIndex < sectionCount - 1; sectionIndex += 1) {
    const remainingSections = sectionCount - sectionIndex;
    const target = Math.ceil(remainingBricks / remainingSections);
    let count = 0;
    let best = null;
    const lastBoundary = steps.length - (remainingSections - 1);
    for (let boundary = start + 1; boundary <= lastBoundary; boundary += 1) {
      count += stepBrickCount(steps[boundary - 1]);
      const atCourseBoundary = boundary === steps.length
        || stepCourse(steps[boundary - 1], bricksById) !== stepCourse(steps[boundary], bricksById);
      const overMax = count > SECTION_MAX_BRICKS;
      const score = Math.abs(count - target) + (atCourseBoundary ? 0 : 18) + (overMax ? (count - SECTION_MAX_BRICKS) * 4 : 0);
      if (!best || score < best.score) best = { boundary, count, score };
      if (count > SECTION_MAX_BRICKS + 24) break;
    }
    chunks.push(steps.slice(start, best.boundary));
    start = best.boundary;
    remainingBricks -= best.count;
  }
  chunks.push(steps.slice(start));
  return chunks;
}

function progressionLabel(moduleLabel, index, count) {
  if (count === 1) return moduleLabel;
  if (index === 0) return `${moduleLabel} · foundation`;
  if (index === count - 1) return `${moduleLabel} · upper section`;
  if (count === 3) return `${moduleLabel} · middle section`;
  return `${moduleLabel} · middle section ${index}`;
}

function isJoinStep(step) {
  return step.newBrickIds.length === 0 || step.kind === 'join';
}

function localStepRunFits(steps, bricksById) {
  if (!steps.length) return true;
  const first = steps[0];
  if (steps.some((step) => step.moduleId !== first.moduleId || isJoinStep(step)
    || (step.insertionDirection ?? 'down') !== (first.insertionDirection ?? 'down'))) return false;
  const bricks = steps.flatMap((step) => step.newBrickIds.map((id) => bricksById.get(id)));
  if (!bricks.length) return false;
  const minY = Math.min(...bricks.map((brick) => brick.y));
  const maxY = Math.max(...bricks.map((brick) => brick.y));
  if (maxY - minY > MAX_GROUP_COURSE_SPAN) return false;
  const minX = Math.min(...bricks.map((brick) => brick.x));
  const maxX = Math.max(...bricks.map((brick) => brick.x + brick.w));
  const minZ = Math.min(...bricks.map((brick) => brick.z));
  const maxZ = Math.max(...bricks.map((brick) => brick.z + brick.d));
  return maxX - minX <= MAX_GROUP_SPAN && maxZ - minZ <= MAX_GROUP_SPAN;
}

function balancedChunks(items) {
  if (items.length <= MAX_GROUP_STEPS) return [items];
  const count = Math.ceil(items.length / MAX_GROUP_STEPS);
  const smallSize = Math.floor(items.length / count);
  const largeCount = items.length % count;
  const chunks = [];
  let offset = 0;
  for (let index = 0; index < count; index += 1) {
    const size = smallSize + (index < largeCount ? 1 : 0);
    chunks.push(items.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function groupSectionSteps(steps, bricksById) {
  const runs = [];
  let run = [];
  const flush = () => {
    if (run.length) runs.push(...balancedChunks(run));
    run = [];
  };
  for (const step of steps) {
    if (isJoinStep(step)) {
      flush();
      runs.push([step]);
      continue;
    }
    if (run.length && !localStepRunFits([...run, step], bricksById)) flush();
    run.push(step);
  }
  flush();
  return runs;
}

function sectionData({ id, label, steps, modulesById, bricksById }) {
  const moduleIds = [...new Set(steps.map((step) => step.moduleId))];
  const brickIds = steps.flatMap((step) => step.newBrickIds);
  const bricks = brickIds.map((brickId) => bricksById.get(brickId));
  const groups = groupSectionSteps(steps, bricksById).map((groupSteps, index) => {
    const groupBrickIds = groupSteps.flatMap((step) => step.newBrickIds);
    return {
      id: `${id}-group-${index + 1}`,
      label: groupSteps.length === 1 ? groupSteps[0].label
        : groupSteps.some((step) => step.kind === 'unresolved') ? 'Review these additions'
          : new Set(groupSteps.flatMap((step) => step.newBrickIds.map((brickId) => bricksById.get(brickId).y))).size === 1
            ? 'Build this layer' : 'Build up this area',
      status: groupSteps.some((step) => step.kind === 'unresolved') ? 'unresolved' : 'ready',
      stepIds: groupSteps.map((step) => step.id),
      brickIds: groupBrickIds,
      brickCount: groupBrickIds.length,
      inventory: inventoryFor(groupBrickIds.map((brickId) => bricksById.get(brickId))),
    };
  });
  return {
    id,
    label,
    status: steps.some((step) => step.kind === 'unresolved') ? 'unresolved' : 'ready',
    moduleIds,
    stepIds: steps.map((step) => step.id),
    brickIds,
    brickCount: brickIds.length,
    inventory: inventoryFor(bricks),
    courseRange: { min: Math.min(...bricks.map((brick) => brick.y)), max: Math.max(...bricks.map((brick) => brick.y)) },
    groups,
  };
}

export function createGuideSections(plan) {
  const { bricksById, modulesById } = validatePlan(plan);
  const moduleRuns = [];
  for (const step of plan.steps) {
    const current = moduleRuns.at(-1);
    if (current?.module.id === step.moduleId) current.steps.push(step);
    else moduleRuns.push({ module: modulesById.get(step.moduleId), steps: [step] });
  }

  const drafts = [];
  let finishing = [];
  const flushFinishing = () => {
    if (!finishing.length) return;
    if (finishing.length === 1) drafts.push({ label: finishing[0].module.label, steps: finishing[0].steps });
    else drafts.push({ label: 'Finishing details', steps: finishing.flatMap(({ steps }) => steps) });
    finishing = [];
  };

  for (const run of moduleRuns) {
    const isTinyFinishingModule = run.module.brickIds.length <= TINY_GROUNDED_MODULE_BRICKS
      && (run.module.kind === 'grounded' || run.module.kind === 'detail' && run.module.label.startsWith('Color detail'));
    if (isTinyFinishingModule) {
      finishing.push(run);
      continue;
    }
    flushFinishing();
    const chunks = run.module.kind === 'grounded' ? splitLargeModuleSteps(run.steps, bricksById) : [run.steps];
    chunks.forEach((steps, index) => drafts.push({ label: progressionLabel(run.module.label, index, chunks.length), steps }));
  }
  flushFinishing();

  const sections = drafts.map((draft, index) => sectionData({
    id: `section-${index + 1}`,
    label: draft.label,
    steps: draft.steps,
    modulesById,
    bricksById,
  }));
  const sectionBrickIds = sections.flatMap((section) => section.brickIds);
  return {
    version: 1,
    sections,
    stats: {
      sectionCount: sections.length,
      groupCount: sections.reduce((sum, section) => sum + section.groups.length, 0),
      substepCount: plan.steps.length,
      brickCount: sectionBrickIds.length,
      coverageComplete: sectionBrickIds.length === plan.bricks.length && new Set(sectionBrickIds).size === plan.bricks.length,
    },
  };
}

export function createGuideSectionsFromRanges(plan, ranges) {
  const { bricksById, modulesById } = validatePlan(plan);
  if (!Array.isArray(ranges) || ranges.length === 0) {
    throw new TypeError('ranges must be a non-empty array.');
  }
  const stepIndexById = new Map(plan.steps.map((step, index) => [step.id, index]));
  let expectedStart = 0;
  const sections = ranges.map((range, index) => {
    if (!range || typeof range !== 'object' || Array.isArray(range)) {
      throw new TypeError(`Range ${index + 1} must be an object.`);
    }
    const start = stepIndexById.get(range.startStepId);
    const end = stepIndexById.get(range.endStepId);
    if (start === undefined || end === undefined) throw new RangeError(`Range ${index + 1} references an unknown step.`);
    if (start !== expectedStart || end < start) {
      throw new RangeError('Guide ranges must cover plan steps exactly once in order.');
    }
    const steps = plan.steps.slice(start, end + 1);
    if (!steps.some((step) => step.newBrickIds.length > 0)) {
      throw new RangeError(`Range ${index + 1} must introduce at least one brick.`);
    }
    expectedStart = end + 1;
    const confidence = range.confidence ?? 'uncertain';
    const semanticLabel = confidence === 'high' || confidence === 'inferred' ? range.label ?? null : null;
    const section = sectionData({
      id: `section-${index + 1}`,
      label: semanticLabel ?? `Build section ${index + 1}`,
      steps,
      modulesById,
      bricksById,
    });
    return {
      ...section,
      semanticLabel,
      semanticConfidence: confidence,
      semanticEvidence: range.evidence ?? '',
    };
  });
  if (expectedStart !== plan.steps.length) throw new RangeError('Guide ranges must cover every plan step.');

  const sectionBrickIds = sections.flatMap((section) => section.brickIds);
  return {
    version: 1,
    sections,
    stats: {
      sectionCount: sections.length,
      groupCount: sections.reduce((sum, section) => sum + section.groups.length, 0),
      substepCount: plan.steps.length,
      brickCount: sectionBrickIds.length,
      coverageComplete: sectionBrickIds.length === plan.bricks.length
        && new Set(sectionBrickIds).size === plan.bricks.length,
    },
  };
}
