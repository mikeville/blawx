import { evaluateInstructionVisibility } from './instruction-visibility.js';

const MAX_DIAGRAM_BRICKS = 12;
const MAX_DIAGRAM_COLORS = 3;
const MAX_COURSE_SPAN = 2;
const MAX_HORIZONTAL_SPAN = 12;
const MAX_FOOTPRINT_GAP = 2;

function uniqueMap(items, name) {
  const result = new Map();
  for (const item of items) {
    if (typeof item?.id !== 'string' || result.has(item.id)) throw new RangeError(`${name} IDs must be unique strings.`);
    result.set(item.id, item);
  }
  return result;
}

function validatePlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) throw new TypeError('plan must be an object.');
  if (!Array.isArray(plan.bricks) || !Array.isArray(plan.modules) || !Array.isArray(plan.steps)) {
    throw new TypeError('plan must contain bricks, modules, and steps arrays.');
  }
  const bricksById = uniqueMap(plan.bricks, 'Plan brick');
  const modulesById = uniqueMap(plan.modules, 'Plan module');
  const stepsById = uniqueMap(plan.steps, 'Plan step');
  const introduced = new Set();
  for (const step of plan.steps) {
    if (!Array.isArray(step.newBrickIds) || !Array.isArray(step.visibleBrickIds)
      || !Array.isArray(step.highlightBrickIds) || !Array.isArray(step.issues)) {
      throw new TypeError(`Plan step ${step.id} must contain brick ID and issue arrays.`);
    }
    for (const brickId of step.newBrickIds) {
      if (!bricksById.has(brickId)) throw new RangeError(`Plan step ${step.id} introduces an unknown brick.`);
      if (introduced.has(brickId)) throw new RangeError(`Plan brick ${brickId} is introduced more than once.`);
      introduced.add(brickId);
    }
  }
  if (introduced.size !== bricksById.size) throw new RangeError('Instruction compaction requires complete plan brick coverage.');
  return { bricksById, modulesById, stepsById };
}

function orderedUnique(values) {
  return [...new Set(values)];
}

function footprintGap(a, b) {
  const xGap = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const zGap = Math.max(0, a.z - (b.z + b.d), b.z - (a.z + a.d));
  return xGap + zGap;
}

function bodyCellKey(x, y, z) {
  return `${x},${y},${z}`;
}

function additionsConnectThroughVisibleGeometry(steps, bricksById) {
  const finalStep = steps.at(-1);
  const visibleBricks = finalStep.visibleBrickIds.map((brickId) => bricksById.get(brickId)).filter(Boolean);
  const visibleIds = new Set(visibleBricks.map(({ id }) => id));
  const priorHighlightIds = new Set(steps.slice(0, -1)
    .flatMap((step) => step.highlightBrickIds)
    .filter((brickId) => visibleIds.has(brickId)));
  const appendedHighlightIds = new Set(finalStep.highlightBrickIds.filter((brickId) => visibleIds.has(brickId)));
  if (!priorHighlightIds.size || !appendedHighlightIds.size) return false;

  const owners = new Map();
  const adjacency = new Map(visibleBricks.map(({ id }) => [id, new Set()]));
  for (const brick of visibleBricks) {
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      owners.set(bodyCellKey(brick.x + dx, brick.y, brick.z + dz), brick.id);
    }
  }
  const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  for (const brick of visibleBricks) {
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const x = brick.x + dx;
      const z = brick.z + dz;
      for (const [xOffset, yOffset, zOffset] of directions) {
        const neighborId = owners.get(bodyCellKey(x + xOffset, brick.y + yOffset, z + zOffset));
        if (neighborId && neighborId !== brick.id) adjacency.get(brick.id).add(neighborId);
      }
    }
  }

  const highlightedIds = new Set([...priorHighlightIds, ...appendedHighlightIds]);
  const firstHighlightId = highlightedIds.values().next().value;
  const reached = new Set([firstHighlightId]);
  const pending = [firstHighlightId];
  while (pending.length) {
    const brickId = pending.pop();
    for (const neighborId of adjacency.get(brickId) ?? []) if (!reached.has(neighborId)) {
      reached.add(neighborId);
      pending.push(neighborId);
    }
  }
  return [...highlightedIds].every((brickId) => reached.has(brickId));
}

function sourceOperation(step) {
  return {
    id: step.id,
    kind: step.kind,
    insertionDirection: step.insertionDirection ?? 'down',
    newBrickIds: [...step.newBrickIds],
    highlightBrickIds: [...step.highlightBrickIds],
    issues: structuredClone(step.issues),
  };
}

function isSingleBrickPlacementPair(buildStep, joinStep, modulesById) {
  if (!buildStep || !joinStep || buildStep.moduleId !== joinStep.moduleId) return false;
  const module = modulesById.get(buildStep.moduleId);
  if (!Array.isArray(module?.brickIds) || module.brickIds.length !== 1) return false;
  const [brickId] = module.brickIds;
  return buildStep.kind === 'build'
    && buildStep.newBrickIds.length === 1
    && buildStep.newBrickIds[0] === brickId
    && buildStep.highlightBrickIds.length === 1
    && buildStep.highlightBrickIds[0] === brickId
    && buildStep.issues.every(({ code, severity }) => code === 'temporary-hold' && severity === 'warning')
    && (joinStep.kind === 'join' || joinStep.kind === 'unresolved')
    && joinStep.newBrickIds.length === 0
    && joinStep.highlightBrickIds.length === 1
    && joinStep.highlightBrickIds[0] === brickId;
}

function staticRejectionReasons(steps, bricksById) {
  const reasons = [];
  const first = steps[0];
  if (steps.some((step) => step.moduleId !== first.moduleId)) reasons.push('module-boundary');
  if (steps.some((step) => step.kind !== 'build' || step.newBrickIds.length === 0)) reasons.push('non-build-step');
  if (steps.some((step) => (step.insertionDirection ?? 'down') !== 'down')) reasons.push('insertion-direction');
  if (steps.some((step) => step.issues.length > 0)) reasons.push('reported-issue');

  const brickIds = steps.flatMap((step) => step.newBrickIds);
  const bricks = brickIds.map((brickId) => bricksById.get(brickId));
  if (bricks.length > MAX_DIAGRAM_BRICKS) reasons.push('brick-limit');
  if (!bricks.length) return reasons;
  if (Math.max(...bricks.map(({ y }) => y)) - Math.min(...bricks.map(({ y }) => y)) > MAX_COURSE_SPAN) {
    reasons.push('course-span');
  }
  if (new Set(bricks.map(({ color }) => color)).size > MAX_DIAGRAM_COLORS) reasons.push('color-limit');
  if (Math.max(...bricks.map(({ x, w }) => x + w)) - Math.min(...bricks.map(({ x }) => x)) > MAX_HORIZONTAL_SPAN) {
    reasons.push('x-span');
  }
  if (Math.max(...bricks.map(({ z, d }) => z + d)) - Math.min(...bricks.map(({ z }) => z)) > MAX_HORIZONTAL_SPAN) {
    reasons.push('z-span');
  }

  if (steps.length > 1) {
    const priorBricks = steps.slice(0, -1).flatMap((step) => step.newBrickIds.map((brickId) => bricksById.get(brickId)));
    const appendedBricks = steps.at(-1).newBrickIds.map((brickId) => bricksById.get(brickId));
    if (!priorBricks.length || !appendedBricks.length
      || Math.min(...priorBricks.flatMap((prior) => appendedBricks.map((added) => footprintGap(prior, added)))) > MAX_FOOTPRINT_GAP) {
      reasons.push('not-local');
    }
    if (!additionsConnectThroughVisibleGeometry(steps, bricksById)) reasons.push('not-face-connected');
  }
  return reasons;
}

function visibilityResult(steps, bricksById) {
  const finalStep = steps.at(-1);
  return evaluateInstructionVisibility({
    visibleBricks: finalStep.visibleBrickIds.map((brickId) => bricksById.get(brickId)).filter(Boolean),
    highlightGroups: steps.map((step) => ({
      id: step.id,
      bricks: step.newBrickIds.map((brickId) => bricksById.get(brickId)).filter(Boolean),
    })),
  });
}

function compactedStep(steps, diagramNumber, { singleBrickPlacement = false } = {}) {
  const first = steps[0];
  const final = steps.at(-1);
  const newBrickIds = orderedUnique(steps.flatMap((step) => step.newBrickIds));
  const highlightBrickIds = orderedUnique(steps.flatMap((step) => step.highlightBrickIds));
  const labelPrefix = first.label.includes(' · add ') ? first.label.slice(0, first.label.indexOf(' · add ')) : first.label;
  return {
    ...structuredClone(final),
    id: `instruction-step-${diagramNumber}`,
    moduleId: first.moduleId,
    label: singleBrickPlacement ? final.label : steps.length === 1 ? first.label
      : `${labelPrefix} · add ${newBrickIds.length} ${newBrickIds.length === 1 ? 'brick' : 'bricks'}`,
    kind: singleBrickPlacement ? final.kind
      : steps.some(({ kind }) => kind === 'unresolved') ? 'unresolved' : first.kind,
    newBrickIds,
    visibleBrickIds: [...final.visibleBrickIds],
    highlightBrickIds,
    issues: structuredClone(steps.flatMap((step) => step.issues)),
    sourceStepIds: steps.map(({ id }) => id),
    orderedOperations: steps.map(sourceOperation),
  };
}

function countReferences(steps) {
  return steps.reduce((sum, step) => sum
    + step.newBrickIds.length + step.visibleBrickIds.length + step.highlightBrickIds.length, 0);
}

export function compactAssemblyPlan(plan) {
  const { bricksById, modulesById } = validatePlan(plan);
  const instructionSteps = [];
  const rejectedMerges = [];
  const rejectedMergeCounts = {};
  let visibilityCheckCount = 0;
  let visibilityTruncationCount = 0;
  let cursor = 0;

  const reject = (current, next, reasons) => {
    rejectedMerges.push({
      sourceStepIds: current.map(({ id }) => id),
      nextSourceStepId: next.id,
      reasons,
    });
    for (const reason of reasons) rejectedMergeCounts[reason] = (rejectedMergeCounts[reason] ?? 0) + 1;
  };

  while (cursor < plan.steps.length) {
    if (isSingleBrickPlacementPair(plan.steps[cursor], plan.steps[cursor + 1], modulesById)) {
      instructionSteps.push(compactedStep(
        [plan.steps[cursor], plan.steps[cursor + 1]],
        instructionSteps.length + 1,
        { singleBrickPlacement: true },
      ));
      cursor += 2;
      continue;
    }
    const start = cursor;
    const candidate = [plan.steps[start]];
    let latestValidEnd = start + 1;
    let probe = start + 1;
    while (probe < plan.steps.length) {
      const next = plan.steps[probe];
      const extended = [...candidate, next];
      const reasons = staticRejectionReasons(extended, bricksById);
      const temporarilyDisconnected = reasons.length === 1 && reasons[0] === 'not-face-connected';
      if (temporarilyDisconnected) {
        reject(candidate, next, reasons);
        candidate.push(next);
        probe += 1;
        continue;
      }
      if (!reasons.length) {
        const visibility = visibilityResult(extended, bricksById);
        visibilityCheckCount += 1;
        if (!visibility.passes) {
          reasons.push(visibility.truncated ? 'visibility-budget' : 'visibility');
          if (visibility.truncated) visibilityTruncationCount += 1;
        }
      }
      if (reasons.length) {
        reject(candidate, next, reasons);
        break;
      }
      candidate.push(next);
      probe += 1;
      latestValidEnd = probe;
    }
    const compacted = plan.steps.slice(start, latestValidEnd);
    cursor = latestValidEnd;
    instructionSteps.push(compactedStep(compacted, instructionSteps.length + 1));
  }

  const sourceStepIds = instructionSteps.flatMap(({ sourceStepIds: ids }) => ids);
  const introducedBrickIds = instructionSteps.flatMap(({ newBrickIds }) => newBrickIds);
  const sourceStepCoverageComplete = sourceStepIds.length === plan.steps.length
    && sourceStepIds.every((stepId, index) => stepId === plan.steps[index].id);
  const brickCoverageComplete = introducedBrickIds.length === plan.bricks.length
    && new Set(introducedBrickIds).size === plan.bricks.length;
  const instructionPlan = {
    ...plan,
    steps: instructionSteps,
    stats: {
      ...plan.stats,
      stepCount: instructionSteps.length,
      unresolvedStepCount: instructionSteps.filter(({ kind }) => kind === 'unresolved').length,
      coverageComplete: brickCoverageComplete,
      maxBricksPerStep: Math.max(0, ...instructionSteps.map(({ newBrickIds }) => newBrickIds.length)),
      planReferenceCount: countReferences(instructionSteps),
    },
    limitations: [
      ...(plan.limitations ?? []),
      'Instruction diagrams may combine consecutive validated build operations; sourceStepIds and orderedOperations preserve their internal sequence.',
    ],
  };
  const mergedDiagramCount = instructionSteps.filter(({ sourceStepIds: ids }) => ids.length > 1).length;
  return {
    plan: instructionPlan,
    report: {
      sourceStepCount: plan.steps.length,
      instructionDiagramCount: instructionSteps.length,
      mergedDiagramCount,
      collapsedStepCount: plan.steps.length - instructionSteps.length,
      sourceStepCoverageComplete,
      brickCoverageComplete,
      visibilityCheckCount,
      visibilityTruncationCount,
      rejectedMergeCounts,
      rejectedMerges,
      limits: {
        maxBricks: MAX_DIAGRAM_BRICKS,
        maxColors: MAX_DIAGRAM_COLORS,
        maxCourseSpan: MAX_COURSE_SPAN,
        maxHorizontalSpan: MAX_HORIZONTAL_SPAN,
        maxFootprintGap: MAX_FOOTPRINT_GAP,
        requiresFaceConnectedAppend: true,
      },
    },
  };
}
