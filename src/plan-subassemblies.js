import { createAssemblyPlan } from './assembly.js';
import { assessAssemblyQuality, orderQualityRejections } from './assembly-quality.js';
import { createGuideNumbering } from './guide-numbering.js';
import { deriveGuidePresentation } from './guide-presentation.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { assemblyRejectionReasons, unresolvedCells } from './refine-construction.js';

const BAND_COURSES = [2, 3, 4];
const MIN_BAND_BRICKS = 2;
const MAX_BAND_BRICKS = 120;
const MAX_HORIZONTAL_SPAN = 32;
const MAX_TARGET_SUPPORT_GROUPS = 4;
const MAX_FULL_EVALUATIONS = 8;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function compareIds(a, b) {
  return a.localeCompare(b);
}

function cellsOf(brick) {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x += 1) {
    for (let z = brick.z; z < brick.z + brick.d; z += 1) cells.push(`${x},${brick.y},${z}`);
  }
  return cells;
}

function connectedRegions(ids, adjacency) {
  const allowed = new Set(ids);
  const visited = new Set();
  const regions = [];
  for (const start of [...allowed].sort(compareIds)) {
    if (visited.has(start)) continue;
    const region = [];
    const pending = [start];
    visited.add(start);
    while (pending.length) {
      const id = pending.pop();
      region.push(id);
      for (const neighbor of [...(adjacency.get(id) ?? [])].sort(compareIds)) {
        if (!allowed.has(neighbor) || visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    regions.push(region.sort(compareIds));
  }
  return regions;
}

function proposalId(floorY, brickIds) {
  return `work-surface@${floorY}:${brickIds.join('|')}`;
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new TypeError('result must be a completed construction result object.');
  }
  if (!result.brickModel || !result.assemblyPlan || !result.instructionPlan || !result.guide) {
    throw new TypeError('planSubassemblies requires a prepared result with brickModel, assemblyPlan, instructionPlan, and guide.');
  }
  if (!Array.isArray(result.assemblyPlan.bricks) || !Array.isArray(result.assemblyPlan.modules)
    || !Array.isArray(result.assemblyPlan.steps) || !Array.isArray(result.assemblyPlan.graph?.edges)) {
    throw new TypeError('result.assemblyPlan is incomplete.');
  }
  if (!Number.isFinite(result.metrics?.conversionMs)) {
    throw new TypeError('result.metrics.conversionMs must be a finite number.');
  }
}

function supportGroupsFor(regionIds, moduleBrickIds, bricksById, adjacency, lowerById) {
  const selected = new Set(regionIds);
  const floorY = Math.min(...regionIds.map((id) => bricksById.get(id).y));
  const lowerRemainder = moduleBrickIds.filter((id) => !selected.has(id) && bricksById.get(id).y < floorY);
  const components = connectedRegions(lowerRemainder, adjacency);
  const componentById = new Map();
  components.forEach((component, index) => component.forEach((id) => componentById.set(id, index)));
  const supportIndexes = new Set();
  for (const upperId of regionIds) {
    for (const lowerId of lowerById.get(upperId) ?? []) {
      const componentIndex = componentById.get(lowerId);
      if (componentIndex !== undefined) supportIndexes.add(componentIndex);
    }
  }
  return [...supportIndexes]
    .sort((a, b) => a - b)
    .map((index) => components[index]);
}

function discoverProposals(plan) {
  const bricksById = new Map(plan.bricks.map((brick) => [brick.id, brick]));
  const adjacency = new Map(plan.bricks.map(({ id }) => [id, new Set()]));
  const lowerById = new Map(plan.bricks.map(({ id }) => [id, new Set()]));
  for (const edge of plan.graph.edges) {
    if (!bricksById.has(edge.a) || !bricksById.has(edge.b)) continue;
    adjacency.get(edge.a).add(edge.b);
    adjacency.get(edge.b).add(edge.a);
    const a = bricksById.get(edge.a);
    const b = bricksById.get(edge.b);
    const lowerId = a.y < b.y ? a.id : b.id;
    const upperId = a.y < b.y ? b.id : a.id;
    lowerById.get(upperId).add(lowerId);
  }

  const unresolved = unresolvedCells(plan);
  const discovery = {
    regionsConsidered: 0,
    rejectedRootless: 0,
    rejectedPartCount: 0,
    rejectedSpan: 0,
    rejectedNonflatSeed: 0,
    rejectedWithoutLowerRemainder: 0,
    rejectedWithoutGroundedSupport: 0,
    rejectedToAlignSupportGroups: 0,
    duplicates: 0,
  };
  const proposalsBySignature = new Map();

  for (const module of plan.modules.filter(({ kind }) => kind === 'grounded')) {
    const moduleIds = module.brickIds.filter((id) => bricksById.has(id));
    const roots = new Set();
    for (const step of plan.steps) {
      if (step.moduleId !== module.id) continue;
      for (const issue of step.issues) {
        if (issue.code !== 'unsupported-addition') continue;
        const rootId = issue.brickIds[0];
        if (moduleIds.includes(rootId) && bricksById.get(rootId).y > 0) roots.add(rootId);
      }
    }
    const floors = [...new Set([...roots].map((id) => bricksById.get(id).y))].sort((a, b) => a - b);
    for (const floorY of floors) for (const bandCourses of BAND_COURSES) {
      const bandIds = moduleIds.filter((id) => {
        const { y } = bricksById.get(id);
        return y >= floorY && y < floorY + bandCourses;
      });
      for (const brickIds of connectedRegions(bandIds, adjacency)) {
        discovery.regionsConsidered += 1;
        const rootBrickIds = brickIds.filter((id) => roots.has(id) && bricksById.get(id).y === floorY);
        if (!rootBrickIds.length) {
          discovery.rejectedRootless += 1;
          continue;
        }
        if (brickIds.length < MIN_BAND_BRICKS || brickIds.length > MAX_BAND_BRICKS) {
          discovery.rejectedPartCount += 1;
          continue;
        }
        const bricks = brickIds.map((id) => bricksById.get(id));
        const xSpan = Math.max(...bricks.map(({ x, w }) => x + w)) - Math.min(...bricks.map(({ x }) => x));
        const zSpan = Math.max(...bricks.map(({ z, d }) => z + d)) - Math.min(...bricks.map(({ z }) => z));
        if (xSpan > MAX_HORIZONTAL_SPAN || zSpan > MAX_HORIZONTAL_SPAN) {
          discovery.rejectedSpan += 1;
          continue;
        }
        const regionSet = new Set(brickIds);
        const hasHigherSeed = brickIds.some((id) => {
          const hasInternalBelow = [...lowerById.get(id)].some((lowerId) => regionSet.has(lowerId));
          return !hasInternalBelow && bricksById.get(id).y !== floorY;
        });
        if (hasHigherSeed) {
          discovery.rejectedNonflatSeed += 1;
          continue;
        }
        const lowerRemainderExists = moduleIds.some((id) => !regionSet.has(id) && bricksById.get(id).y < floorY);
        if (!lowerRemainderExists) {
          discovery.rejectedWithoutLowerRemainder += 1;
          continue;
        }
        const supportGroups = supportGroupsFor(brickIds, moduleIds, bricksById, adjacency, lowerById);
        if (!supportGroups.length || supportGroups.some((ids) => !ids.some((id) => bricksById.get(id).y === 0))) {
          discovery.rejectedWithoutGroundedSupport += 1;
          continue;
        }
        if (supportGroups.length > MAX_TARGET_SUPPORT_GROUPS) {
          discovery.rejectedToAlignSupportGroups += 1;
          continue;
        }

        const signature = brickIds.join('|');
        const unresolvedCellsCovered = new Set(bricks.flatMap(cellsOf).filter((key) => unresolved.has(key))).size;
        const proposal = {
          id: proposalId(floorY, brickIds),
          signature,
          moduleId: module.id,
          floorY,
          bandCourses,
          brickIds,
          rootBrickIds,
          rootIdsCovered: rootBrickIds.length,
          unresolvedCellsCovered,
          partCount: brickIds.length,
          horizontalSpan: { x: xSpan, z: zSpan },
          supportGroupCount: supportGroups.length,
        };
        const prior = proposalsBySignature.get(signature);
        if (prior) {
          discovery.duplicates += 1;
          if (proposal.bandCourses < prior.bandCourses) proposalsBySignature.set(signature, proposal);
        } else proposalsBySignature.set(signature, proposal);
      }
    }
  }

  const proposals = [...proposalsBySignature.values()].sort((a, b) =>
    b.rootIdsCovered - a.rootIdsCovered
    || b.unresolvedCellsCovered - a.unresolvedCellsCovered
    || a.partCount - b.partCount
    || a.floorY - b.floorY
    || a.signature.localeCompare(b.signature));
  return { proposals, discovery };
}

function diagramsFor(result) {
  const presentation = deriveGuidePresentation({ plan: result.instructionPlan, guide: result.guide });
  return {
    displayedDiagramCount: createGuideNumbering(presentation.sections).diagramCount,
    instructionDiagramCount: result.instructionPlan.steps.length,
    sourceDiagramCount: result.assemblyPlan?.steps?.length ?? Number.POSITIVE_INFINITY,
  };
}

function planMetrics(result) {
  const plan = result.assemblyPlan;
  return {
    rootFailureCount: plan.stats.rootFailureCount,
    unresolvedOccupiedCellCount: unresolvedCells(plan).size,
    unresolvedBrickCount: plan.stats.unresolvedBrickCount,
    blockedJoinCount: plan.stats.blockedJoinCount,
    temporaryHoldStepCount: plan.stats.temporaryHoldStepCount,
    upwardInsertionBrickCount: plan.stats.upwardInsertionBrickCount,
    brickCount: plan.stats.brickCount,
    ...diagramsFor(result),
    quality: assessAssemblyQuality(plan),
  };
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function coverageReasons(result) {
  const reasons = [];
  const plan = result.assemblyPlan;
  const instruction = result.instructionPlan;
  if (!plan.stats.coverageComplete || !instruction.stats.coverageComplete || !result.guide?.stats?.coverageComplete) {
    reasons.push('Exact brick coverage was not retained');
  }
  const introduced = plan.steps.flatMap(({ newBrickIds }) => newBrickIds);
  if (introduced.length !== plan.bricks.length || new Set(introduced).size !== plan.bricks.length) {
    reasons.push('Canonical plan does not introduce each brick exactly once');
  }
  const compacted = result.assemblyEvaluation?.compaction;
  if (!compacted?.sourceStepCoverageComplete || !compacted?.brickCoverageComplete) {
    reasons.push('Compact guide does not preserve source-operation and brick coverage');
  }
  return reasons;
}

function candidateRejections(beforeResult, candidateResult, proposal) {
  const beforePlan = beforeResult.assemblyPlan;
  const afterPlan = candidateResult.assemblyPlan;
  const beforeMetrics = planMetrics(beforeResult);
  const afterMetrics = planMetrics(candidateResult);
  const reasons = [
    ...assemblyRejectionReasons(beforePlan, afterPlan),
    ...orderQualityRejections(beforeMetrics.quality, afterMetrics.quality),
  ];
  if (afterMetrics.rootFailureCount >= beforeMetrics.rootFailureCount) {
    reasons.push('Canonical unsupported-addition roots did not strictly decrease');
  }
  if (afterMetrics.unresolvedOccupiedCellCount >= beforeMetrics.unresolvedOccupiedCellCount) {
    reasons.push('Unresolved occupied cells did not strictly decrease');
  }
  if (!sameJson(beforePlan.bricks, afterPlan.bricks)
    || !sameJson(beforeResult.brickModel, candidateResult.brickModel)
    || !sameJson(beforePlan.inventory, afterPlan.inventory)) {
    reasons.push('Geometry, color, or inventory changed');
  }
  reasons.push(...coverageReasons(candidateResult));
  if (afterPlan.stats.temporaryHoldStepCount > beforePlan.stats.temporaryHoldStepCount) {
    reasons.push('Temporary holding increased');
  }
  if (afterPlan.stats.upwardInsertionBrickCount !== 0
    || afterPlan.steps.some((step) => step.insertionDirection === 'up' && step.newBrickIds.length)) {
    reasons.push('Per-brick upward additions were introduced');
  }

  const selectedIds = new Set(proposal.brickIds);
  const workSurfaceModules = afterPlan.modules.filter((module) => module.buildContext?.kind === 'work-surface');
  const workSurface = workSurfaceModules.find((module) => module.brickIds.length === selectedIds.size
    && module.brickIds.every((id) => selectedIds.has(id)));
  if (!workSurface || workSurfaceModules.length !== 1) {
    reasons.push('Selected work-surface module was not preserved');
  } else {
    const steps = afterPlan.steps.filter(({ moduleId }) => moduleId === workSurface.id);
    if (steps.some((step) => step.newBrickIds.length > 0
      && (step.kind !== 'build' || step.issues.some(({ severity }) => severity === 'error')))) {
      reasons.push('Work-surface module contains an unresolved build addition');
    }
    const joins = steps.filter((step) => step.kind === 'join' && step.newBrickIds.length === 0);
    if (joins.length !== 1 || joins[0].issues.some(({ severity }) => severity === 'error')) {
      reasons.push('Work-surface module lacks one successful explicit join');
    } else {
      const supportGroups = joins[0].joinContext?.supportGroups;
      if (joins[0].joinContext?.direction !== 'down'
        || joins[0].joinContext?.requiresAlignment !== (supportGroups?.length > 1)
        || !Array.isArray(supportGroups) || supportGroups.length < 1 || supportGroups.length > MAX_TARGET_SUPPORT_GROUPS
        || supportGroups.some((group) => !Array.isArray(group?.brickIds) || group.brickIds.length === 0
          || !Array.isArray(group.contacts) || group.contacts.length === 0)) {
        reasons.push('Work-surface join lacks one to four explicit grounded support groups');
      }
    }
  }
  return [...new Set(reasons)];
}

function compareAccepted(a, b) {
  return a.after.unresolvedOccupiedCellCount - b.after.unresolvedOccupiedCellCount
    || a.after.rootFailureCount - b.after.rootFailureCount
    || a.after.displayedDiagramCount - b.after.displayedDiagramCount
    || a.after.sourceDiagramCount - b.after.sourceDiagramCount
    || a.proposal.partCount - b.proposal.partCount
    || a.proposal.signature.localeCompare(b.proposal.signature);
}

function publicProposal(proposal) {
  const { signature: _signature, ...fields } = proposal;
  return fields;
}

export function planSubassemblies(result) {
  validateResult(result);
  const started = now();
  const geometrySnapshot = JSON.stringify(result.brickModel);
  const before = planMetrics(result);
  const { proposals, discovery } = discoverProposals(result.assemblyPlan);
  const attempts = [];
  const accepted = [];

  for (const proposal of proposals.slice(0, MAX_FULL_EVALUATIONS)) {
    const attemptStarted = now();
    let candidateResult = null;
    let rejectionReasons = [];
    try {
      const candidatePlan = createAssemblyPlan({
        brickModel: result.brickModel,
        workSurfaceBrickIds: proposal.brickIds,
        preferLocalProgress: true,
        preferLocalFoundations: true,
      });
      candidateResult = prepareAssemblyGuide({ ...result, assemblyPlan: candidatePlan });
      rejectionReasons = candidateRejections(result, candidateResult, proposal);
    } catch (error) {
      rejectionReasons = [`Candidate evaluation failed: ${error instanceof Error ? error.message : String(error)}`];
    }
    const after = candidateResult ? planMetrics(candidateResult) : null;
    const attempt = {
      proposal: publicProposal(proposal),
      accepted: rejectionReasons.length === 0,
      selected: false,
      rejectionReasons,
      after,
      evaluationMs: now() - attemptStarted,
    };
    attempts.push(attempt);
    if (!rejectionReasons.length) accepted.push({ proposal, result: candidateResult, after, attempt });
  }

  accepted.sort(compareAccepted);
  const selected = accepted[0] ?? null;
  if (selected) selected.attempt.selected = true;
  if (JSON.stringify(result.brickModel) !== geometrySnapshot) {
    throw new Error('Subassembly planning mutated the input brick geometry.');
  }
  const completeResult = selected?.result ?? result;
  const after = planMetrics(completeResult);
  const stageMs = now() - started;
  const report = {
    version: 1,
    policy: 'bounded-work-surface-subassembly-v1',
    selected: Boolean(selected),
    limits: {
      bandCourses: BAND_COURSES,
      minBandBricks: MIN_BAND_BRICKS,
      maxBandBricks: MAX_BAND_BRICKS,
      maxHorizontalSpanStuds: MAX_HORIZONTAL_SPAN,
      maxTargetSupportGroups: MAX_TARGET_SUPPORT_GROUPS,
      maxFullCandidates: MAX_FULL_EVALUATIONS,
      maxSelectedRepairs: 1,
    },
    proposalCount: proposals.length,
    evaluatedCount: attempts.length,
    discovery,
    proposals: proposals.map(publicProposal),
    attempts,
    selectedProposalId: selected?.proposal.id ?? null,
    selectedBrickIds: selected ? [...selected.proposal.brickIds] : [],
    before,
    after,
    stageMs,
    geometryChanges: 0,
    colorChanges: 0,
    limitations: 'A selected band can be table-built and aligned downward onto at most four independently grounded supports. The upright downward rigid-body corridor is checked; general motion, table stability, hand access, clutch strength, balance, and physical buildability remain unverified.',
  };
  return {
    ...completeResult,
    subassemblyRefinement: report,
    metrics: {
      ...completeResult.metrics,
      conversionMs: result.metrics.conversionMs + stageMs,
      stageTiming: {
        ...(result.metrics.stageTiming ?? {}),
        subassemblyMs: (result.metrics.stageTiming?.subassemblyMs ?? 0) + stageMs,
      },
    },
  };
}
