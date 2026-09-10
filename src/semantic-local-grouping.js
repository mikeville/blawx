import { createGuideSections } from './guide-sections.js';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from './semantic-guide.js';

const MAX_SECTIONS = 12;
const EVIDENCE = 'Deterministic geometry range; visible caption pending.';

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

function hasBricks(input, start, end) {
  for (let index = start; index <= end; index += 1) {
    if (input.steps[index].newBrickIds.length) return true;
  }
  return false;
}

function naturalBoundaries(input, plan) {
  const stepIndexes = new Map(input.steps.map((step, index) => [step.id, index]));
  return new Set(createGuideSections(plan).sections.slice(0, -1)
    .map((section) => stepIndexes.get(section.stepIds.at(-1)) + 1));
}

function gapChunks(input, start, end, boundaries) {
  if (start > end) return [];
  const cuts = [start, ...[...boundaries].filter((boundary) => boundary > start && boundary <= end), end + 1]
    .sort((a, b) => a - b);
  const chunks = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const chunk = { start: cuts[index], end: cuts[index + 1] - 1, protected: false };
    if (!hasBricks(input, chunk.start, chunk.end)) {
      if (chunks.length) chunks.at(-1).end = chunk.end;
      else if (index + 2 < cuts.length) cuts[index + 1] = chunk.start;
      continue;
    }
    chunks.push(chunk);
  }
  if (!chunks.length || !hasBricks(input, chunks.at(-1).start, chunks.at(-1).end)) {
    throw new RangeError('A local semantic gap must introduce at least one brick.');
  }
  return chunks;
}

function initialChunks(input, plan) {
  const stepIndexes = new Map(input.steps.map((step, index) => [step.id, index]));
  const boundaries = naturalBoundaries(input, plan);
  const chunks = [];
  let cursor = 0;
  for (const range of input.protectedRanges) {
    const start = stepIndexes.get(range.startStepId);
    const end = stepIndexes.get(range.endStepId);
    chunks.push(...gapChunks(input, cursor, start - 1, boundaries));
    chunks.push({ start, end, protected: true });
    cursor = end + 1;
  }
  chunks.push(...gapChunks(input, cursor, input.steps.length - 1, boundaries));
  return chunks;
}

function chunkGeometry(input, chunk, bricksById) {
  const bricks = input.steps.slice(chunk.start, chunk.end + 1)
    .flatMap((step) => step.newBrickIds.map((brickId) => bricksById.get(brickId)));
  const centers = bricks.map(([, x, y, z, w, d]) => [x + w / 2, y, z + d / 2]);
  const centroid = centers.reduce((sum, point) => point.map((value, axis) => sum[axis] + value), [0, 0, 0])
    .map((value) => value / centers.length);
  return {
    centroid,
    colors: new Set(bricks.map((brick) => brick[6])),
    modules: new Set(input.steps.slice(chunk.start, chunk.end + 1).map((step) => step.moduleId)),
  };
}

function overlap(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function mergeScore(input, left, right, bricksById) {
  const a = chunkGeometry(input, left, bricksById);
  const b = chunkGeometry(input, right, bricksById);
  const distance = Math.hypot(
    a.centroid[0] - b.centroid[0],
    (a.centroid[1] - b.centroid[1]) * 2,
    a.centroid[2] - b.centroid[2],
  );
  const sharedColor = overlap(a.colors, b.colors) / Math.max(a.colors.size, b.colors.size);
  const sharedModule = overlap(a.modules, b.modules) > 0;
  return distance + (1 - sharedColor) * 8 + (sharedModule ? 0 : 12);
}

function mergeToLimit(input, chunks) {
  const bricksById = new Map(input.bricks.map((brick) => [brick[0], brick]));
  while (chunks.length > MAX_SECTIONS) {
    let best = null;
    for (let index = 0; index < chunks.length - 1; index += 1) {
      const left = chunks[index];
      const right = chunks[index + 1];
      if (left.protected || right.protected) continue;
      const score = mergeScore(input, left, right, bricksById);
      if (!best || score < best.score) best = { index, score };
    }
    if (!best) throw new RangeError(`Protected ranges require more than ${MAX_SECTIONS} local semantic chapters.`);
    chunks.splice(best.index, 2, {
      start: chunks[best.index].start,
      end: chunks[best.index + 1].end,
      protected: false,
    });
  }
  return chunks;
}

export function createLocalSemanticProposal(rawInput) {
  const input = validateSemanticGuideInput(rawInput);
  const plan = planFromInput(input);
  const chunks = mergeToLimit(input, initialChunks(input, plan));
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
