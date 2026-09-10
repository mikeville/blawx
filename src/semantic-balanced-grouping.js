import { createGuideSections } from './guide-sections.js';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from './semantic-guide.js';

const MAX_SECTIONS = 12;
const IDEAL_STEPS = 10;
const SOFT_MAX_STEPS = 18;
const MIN_ORDINARY_STEPS = 3;
const MAX_DP_TRANSITIONS = 250_000;
const EVIDENCE = 'Deterministic balanced geometry range; visible caption pending.';

function planFromInput(input) {
  const bricks = input.bricks.map(([id, x, y, z, w, d, color]) => ({ id, x, y, z, w, d, color }));
  const brickIdsByModule = new Map(input.modules.map(({ id }) => [id, []]));
  const steps = input.steps.map((step) => {
    brickIdsByModule.get(step.moduleId).push(...step.newBrickIds);
    return {
      id: step.id,
      moduleId: step.moduleId,
      label: step.newBrickIds.length ? 'Add these bricks' : 'Attach this section',
      kind: step.kind,
      newBrickIds: [...step.newBrickIds],
      highlightBrickIds: [...new Set(step.orderedOperations.flatMap((operation) => operation.highlightBrickIds))],
      insertionDirection: step.insertionDirection,
      issues: step.issues.map((issue) => ({ ...issue, message: issue.code })),
    };
  });
  const modules = input.modules.map((module, index) => ({
    id: module.id,
    label: `Build area ${index + 1}`,
    kind: module.kind,
    status: 'ready',
    componentIds: [],
    brickIds: [...brickIdsByModule.get(module.id)],
  }));
  return { version: 1, bricks, modules, steps, graph: input.graph };
}

function analysisFor(input) {
  const stepIndexById = new Map(input.steps.map((step, index) => [step.id, index]));
  const brickPrefix = [0];
  for (const step of input.steps) {
    brickPrefix.push(brickPrefix.at(-1) + (step.newBrickIds.length > 0 ? 1 : 0));
  }
  const plan = planFromInput(input);
  const naturalBoundaries = new Set(createGuideSections(plan).sections.slice(0, -1)
    .map((section) => stepIndexById.get(section.stepIds.at(-1)) + 1));
  const bricksById = new Map(input.bricks.map((brick) => [brick[0], brick]));
  const geometry = input.steps.map((step) => {
    const bricks = step.newBrickIds.map((id) => bricksById.get(id));
    if (!bricks.length) return null;
    const centers = bricks.map(([, x, y, z, w, d]) => [x + w / 2, y, z + d / 2]);
    return {
      centroid: centers.reduce((sum, point) => point.map((value, axis) => sum[axis] + value), [0, 0, 0])
        .map((value) => value / centers.length),
      colors: new Set(bricks.map((brick) => brick[6])),
      courses: new Set(bricks.map((brick) => brick[2])),
    };
  });
  const nearestLeft = [];
  let nearest = null;
  for (let index = 0; index < geometry.length; index += 1) {
    if (geometry[index]) nearest = geometry[index];
    nearestLeft[index] = nearest;
  }
  const nearestRight = [];
  nearest = null;
  for (let index = geometry.length - 1; index >= 0; index -= 1) {
    if (geometry[index]) nearest = geometry[index];
    nearestRight[index] = nearest;
  }
  return { stepIndexById, brickPrefix, naturalBoundaries, nearestLeft, nearestRight };
}

function hasBricks(analysis, start, end) {
  return analysis.brickPrefix[end + 1] > analysis.brickPrefix[start];
}

function ordinaryGaps(input, analysis) {
  const gaps = [];
  const fixed = [];
  let cursor = 0;
  for (const range of input.protectedRanges) {
    const start = analysis.stepIndexById.get(range.startStepId);
    const end = analysis.stepIndexById.get(range.endStepId);
    if (cursor < start) gaps.push({ start: cursor, end: start - 1, slots: 1 });
    fixed.push({ start, end, protected: true });
    cursor = end + 1;
  }
  if (cursor < input.steps.length) gaps.push({ start: cursor, end: input.steps.length - 1, slots: 1 });
  return { gaps, fixed };
}

function validCut(input, boundary) {
  // A zero-brick Attach/Join remains with the construction range before it.
  return input.steps[boundary].newBrickIds.length > 0;
}

function maxUsefulSlots(input, gap, analysis) {
  let count = 1;
  let previous = gap.start;
  for (let boundary = gap.start + MIN_ORDINARY_STEPS;
    boundary <= gap.end - MIN_ORDINARY_STEPS + 1; boundary += 1) {
    if (boundary - previous >= MIN_ORDINARY_STEPS && validCut(input, boundary)
      && hasBricks(analysis, previous, boundary - 1) && hasBricks(analysis, boundary, gap.end)) {
      count += 1;
      previous = boundary;
    }
  }
  return count;
}

function allocateSlots(input, gaps, protectedCount, analysis) {
  const minimum = protectedCount + gaps.length;
  if (minimum > MAX_SECTIONS) {
    throw new RangeError(`Protected ranges require at least ${minimum} balanced semantic sections; maximum is ${MAX_SECTIONS}.`);
  }
  const lengthTarget = Math.max(
    Math.ceil(input.steps.length / SOFT_MAX_STEPS),
    Math.round(input.steps.length / IDEAL_STEPS),
  );
  const capacity = protectedCount + gaps.reduce((sum, gap) => sum + maxUsefulSlots(input, gap, analysis), 0);
  const desired = Math.min(MAX_SECTIONS, capacity, Math.max(minimum, lengthTarget));
  let allocated = minimum;
  while (allocated < desired) {
    let best = null;
    for (const gap of gaps) {
      const capacityForGap = maxUsefulSlots(input, gap, analysis);
      if (gap.slots >= capacityForGap) continue;
      const averageAfterSplit = (gap.end - gap.start + 1) / (gap.slots + 1);
      if (!best || averageAfterSplit > best.averageAfterSplit) best = { gap, averageAfterSplit };
    }
    if (!best) break;
    best.gap.slots += 1;
    allocated += 1;
  }
}

function overlap(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function boundaryScores(input, analysis) {
  const scores = new Float64Array(input.steps.length);
  for (let boundary = 1; boundary < input.steps.length; boundary += 1) {
    const leftStep = input.steps[boundary - 1];
    const rightStep = input.steps[boundary];
    let score = analysis.naturalBoundaries.has(boundary) ? 32 : 0;
    if (leftStep.moduleId !== rightStep.moduleId) score += 48;
    if (!leftStep.newBrickIds.length || leftStep.kind === 'join') score += 42;
    if (leftStep.kind !== rightStep.kind) score += 8;
    if (leftStep.insertionDirection !== rightStep.insertionDirection) score += 6;
    const left = analysis.nearestLeft[boundary - 1];
    const right = analysis.nearestRight[boundary];
    if (left && right) {
      if (overlap(left.courses, right.courses) === 0) score += 18;
      score += (1 - overlap(left.colors, right.colors) / Math.max(left.colors.size, right.colors.size)) * 12;
      score += Math.min(28, Math.hypot(
        left.centroid[0] - right.centroid[0],
        (left.centroid[1] - right.centroid[1]) * 2,
        left.centroid[2] - right.centroid[2],
      ) * 1.5);
    }
    scores[boundary] = score;
  }
  return scores;
}

function sectionCost(length, target, boundaryReward) {
  const deviation = length - target;
  const overflow = Math.max(0, length - SOFT_MAX_STEPS);
  const shortfall = Math.max(0, MIN_ORDINARY_STEPS - length);
  return deviation * deviation * 3 + overflow * overflow * 9 + shortfall * shortfall * 1_000 - boundaryReward;
}

function rangesFromCuts(gap, cuts) {
  const boundaries = [gap.start, ...cuts, gap.end + 1];
  return boundaries.slice(0, -1).map((start, index) => ({
    start,
    end: boundaries[index + 1] - 1,
    protected: false,
  }));
}

function linearPartition(input, gap, scores, analysis) {
  const cuts = [];
  let start = gap.start;
  for (let used = 1; used < gap.slots; used += 1) {
    const remainingSlots = gap.slots - used;
    const ideal = Math.round(start + (gap.end + 1 - start) / (remainingSlots + 1));
    const minimum = start + MIN_ORDINARY_STEPS;
    const maximum = gap.end + 1 - remainingSlots * MIN_ORDINARY_STEPS;
    let best = null;
    for (let boundary = minimum; boundary <= maximum; boundary += 1) {
      if (!validCut(input, boundary)
        || !hasBricks(analysis, start, boundary - 1) || !hasBricks(analysis, boundary, gap.end)) continue;
      const distance = Math.abs(boundary - ideal);
      const score = scores[boundary];
      if (!best || distance < best.distance || (distance === best.distance && score > best.score)) {
        best = { boundary, distance, score };
      }
    }
    if (!best) throw new RangeError(`Could not partition ordinary steps ${gap.start + 1}-${gap.end + 1}.`);
    cuts.push(best.boundary);
    start = best.boundary;
  }
  return rangesFromCuts(gap, cuts);
}

function dynamicPartition(input, gap, scores, analysis) {
  const length = gap.end - gap.start + 1;
  const estimatedTransitions = gap.slots * length * length / 2;
  if (estimatedTransitions > MAX_DP_TRANSITIONS) return linearPartition(input, gap, scores, analysis);
  const target = Math.min(SOFT_MAX_STEPS, length / gap.slots);
  const states = Array.from({ length: gap.slots + 1 }, () => new Map());
  states[0].set(gap.start, { cost: 0, cuts: [] });
  for (let used = 0; used < gap.slots; used += 1) {
    for (const [start, state] of states[used]) {
      const remaining = gap.slots - used - 1;
      const minimumLength = length >= MIN_ORDINARY_STEPS ? MIN_ORDINARY_STEPS : 1;
      const minimumEnd = start + minimumLength - 1;
      const lastEnd = gap.end - remaining * MIN_ORDINARY_STEPS;
      for (let end = minimumEnd; end <= lastEnd; end += 1) {
        const next = end + 1;
        if (!hasBricks(analysis, start, end)) continue;
        if (remaining && (!validCut(input, next) || !hasBricks(analysis, next, gap.end))) continue;
        const cost = state.cost + sectionCost(end - start + 1, target, remaining ? scores[next] : 0);
        const previous = states[used + 1].get(next);
        const cuts = remaining ? [...state.cuts, next] : state.cuts;
        if (!previous || cost < previous.cost
          || (cost === previous.cost && cuts.join(',') < previous.cuts.join(','))) {
          states[used + 1].set(next, { cost, cuts });
        }
      }
    }
  }
  const result = states[gap.slots].get(gap.end + 1);
  if (!result) return linearPartition(input, gap, scores, analysis);
  return rangesFromCuts(gap, result.cuts);
}

export function createBalancedSemanticProposal(rawInput) {
  const input = validateSemanticGuideInput(rawInput);
  const analysis = analysisFor(input);
  const { gaps, fixed } = ordinaryGaps(input, analysis);
  allocateSlots(input, gaps, fixed.length, analysis);
  const scores = boundaryScores(input, analysis);
  const chunks = [
    ...fixed,
    ...gaps.flatMap((gap) => dynamicPartition(input, gap, scores, analysis)),
  ].sort((left, right) => left.start - right.start);
  return validateSemanticGuideAnnotation(input, {
    version: 1,
    fingerprint: input.fingerprint,
    sections: chunks.map(({ start, end }) => ({
      startStepId: input.steps[start].id,
      endStepId: input.steps[end].id,
      label: null,
      confidence: 'uncertain',
      evidence: EVIDENCE,
    })),
  });
}
