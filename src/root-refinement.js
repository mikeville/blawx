import { createAssemblyPlan } from './assembly.js';
import { proposeBrickRefinements } from './brick-refinement.js';
import { inspectConstruction } from './construction.js';
import {
  assemblyRejectionReasons,
  packingProfile,
  packingRejectionReasons,
  unresolvedCells,
} from './refine-construction.js';

const MAX_PLAN_CHECKS = 16;
const MAX_ACCEPTED_ROUNDS = 2;
const ORDINARY_FOOTPRINTS = Object.freeze([
  [2, 4], [4, 2], [2, 3], [3, 2], [2, 2], [1, 4], [4, 1],
  [1, 3], [3, 1], [1, 2], [2, 1], [1, 1],
]);
const cellKey = (x, y, z) => `${x},${y},${z}`;
const brickKey = ({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`;
const compareBricks = (a, b) => a.y - b.y || a.z - b.z || a.x - b.x
  || a.w - b.w || a.d - b.d || a.color.localeCompare(b.color);

function cellsOf(brick) {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x += 1) for (let z = brick.z; z < brick.z + brick.d; z += 1) {
    cells.push(cellKey(x, brick.y, z));
  }
  return cells;
}

function rootBricks(plan) {
  const ids = new Set(plan.steps.flatMap((step) => step.issues
    .filter(({ code }) => code === 'unsupported-addition').flatMap(({ brickIds }) => brickIds)));
  return plan.bricks.filter(({ id }) => ids.has(id));
}

function oldUnresolvedCount(plan, oldCells) {
  let count = 0;
  for (const key of unresolvedCells(plan)) if (oldCells.has(key)) count += 1;
  return count;
}

function summary(plan, oldCells) {
  const unresolvedCellCount = unresolvedCells(plan).size;
  return {
    rootFailureCount: plan.stats.rootFailureCount,
    unresolvedOldCellCount: oldUnresolvedCount(plan, oldCells),
    unresolvedCellCount,
    unresolvedBrickCount: plan.stats.unresolvedBrickCount,
    blockedJoinCount: plan.stats.blockedJoinCount,
    temporaryHoldStepCount: plan.stats.temporaryHoldStepCount,
    brickCount: plan.stats.brickCount,
    assembly: { ...plan.stats },
  };
}

function iconicCount(bricks) {
  return bricks.filter(({ w, d }) => Math.min(w, d) === 2 && [2, 4].includes(Math.max(w, d))).length;
}

function candidateOrder(a, b) {
  return a.afterSummary.unresolvedOldCellCount - b.afterSummary.unresolvedOldCellCount
    || a.afterSummary.rootFailureCount - b.afterSummary.rootFailureCount
    || a.addedCells.length - b.addedCells.length
    || b.iconicBrickCount - a.iconicBrickCount
    || a.signature.localeCompare(b.signature);
}

function recordRejections(phase, reasons) {
  for (const reason of reasons) phase.rejections[reason] = (phase.rejections[reason] ?? 0) + 1;
}

function planFor(brickModel, preferLocalProgress) {
  return createAssemblyPlan({ brickModel, preferLocalProgress });
}

function rootInterfaceTargets(model, plan) {
  const profile = packingProfile(model.bricks);
  const indexes = new Set();
  for (const root of rootBricks(plan)) {
    for (let y = Math.max(0, root.y - 1); y <= root.y + 1; y += 1) {
      for (let x = root.x - 1; x <= root.x + root.w; x += 1) for (let z = root.z - 1; z <= root.z + root.d; z += 1) {
        const occupied = profile.cells.get(cellKey(x, y, z));
        if (occupied) indexes.add(occupied.index);
      }
    }
  }
  return [...indexes].sort((a, b) => a - b).map((index) => model.bricks[index]);
}

function validatePlanCandidate({ currentPlan, candidatePlan, originalCells, addedCells = [] }) {
  const reasons = assemblyRejectionReasons(currentPlan, candidatePlan);
  const before = summary(currentPlan, originalCells);
  const after = summary(candidatePlan, originalCells);
  if (after.rootFailureCount >= before.rootFailureCount) reasons.push('Root failures did not strictly decrease');
  if (after.unresolvedOldCellCount >= before.unresolvedOldCellCount) reasons.push('Unresolved old cells did not strictly decrease');
  const candidateUnresolved = unresolvedCells(candidatePlan);
  if (addedCells.some(({ x, y, z }) => candidateUnresolved.has(cellKey(x, y, z)))) {
    reasons.push('An added cell remained unresolved');
  }
  return { reasons: [...new Set(reasons)], before, after };
}

function phaseReport() {
  return {
    rounds: 0,
    evaluations: 0,
    proposalsGenerated: 0,
    searchNodes: 0,
    searchLimitReached: false,
    accepted: [],
    attempts: [],
    rejections: {},
    limitReached: false,
  };
}

function exactPhase({ model, plan, originalCells, preferLocalProgress }) {
  const phase = phaseReport();
  let currentModel = model;
  let currentPlan = plan;
  const attempted = new Set();
  for (let round = 0; round < MAX_ACCEPTED_ROUNDS && phase.evaluations < MAX_PLAN_CHECKS; round += 1) {
    phase.rounds += 1;
    const targets = rootInterfaceTargets(currentModel, currentPlan);
    if (!targets.length) break;
    const generated = proposeBrickRefinements(currentModel, {
      maxPatches: 96,
      maxSearchNodes: 24_000,
      targetBricks: targets,
      supportOnly: true,
    });
    phase.proposalsGenerated += generated.proposals.length;
    phase.searchNodes += generated.stats.searchNodes;
    phase.searchLimitReached ||= generated.stats.limitReached;
    const remainingRounds = MAX_ACCEPTED_ROUNDS - round;
    const roundLimit = Math.ceil((MAX_PLAN_CHECKS - phase.evaluations) / remainingRounds);
    const guarded = [];
    let checked = 0;
    for (const proposal of generated.proposals) {
      const signature = `${proposal.before.map(brickKey).sort().join('|')}>${proposal.after.map(brickKey).sort().join('|')}`;
      if (attempted.has(signature)) continue;
      attempted.add(signature);
      if (checked >= roundLimit) break;
      checked += 1;
      phase.evaluations += 1;
      const candidateModel = { ...currentModel, bricks: proposal.bricks.map(({ id: _id, ...brick }) => brick).sort(compareBricks) };
      const diagnostics = inspectConstruction(candidateModel);
      let reasons = packingRejectionReasons(packingProfile(currentModel.bricks), packingProfile(candidateModel.bricks));
      if (candidateModel.bricks.length > currentModel.bricks.length) reasons.push('Part count increased');
      if (!diagnostics.checks.schema || !diagnostics.checks.legalFootprints || !diagnostics.checks.noCollisions) {
        reasons.push('Invalid or overlapping parts');
      }
      let candidatePlan = null;
      let assessment = null;
      if (!reasons.length) {
        try {
          candidatePlan = planFor(candidateModel, preferLocalProgress);
          assessment = validatePlanCandidate({ currentPlan, candidatePlan, originalCells });
          reasons.push(...assessment.reasons);
        } catch {
          reasons.push('Assembly planning failed');
        }
      }
      reasons = [...new Set(reasons)];
      phase.attempts.push({
        before: proposal.before.map((brick) => ({ ...brick })),
        after: proposal.after.map((brick) => ({ ...brick })),
        addedCells: [],
        accepted: false,
        rejectionReasons: reasons,
      });
      if (reasons.length) {
        recordRejections(phase, reasons);
        continue;
      }
      guarded.push({
        model: candidateModel,
        plan: candidatePlan,
        afterSummary: assessment.after,
        addedCells: [],
        iconicBrickCount: iconicCount(candidateModel.bricks),
        signature,
        attemptIndex: phase.attempts.length - 1,
      });
    }
    if (!guarded.length) break;
    guarded.sort(candidateOrder);
    const best = guarded[0];
    phase.attempts[best.attemptIndex].accepted = true;
    phase.accepted.push({
      before: phase.attempts[best.attemptIndex].before,
      after: phase.attempts[best.attemptIndex].after,
      addedCells: [],
      beforeSummary: summary(currentPlan, originalCells),
      afterSummary: best.afterSummary,
    });
    currentModel = best.model;
    currentPlan = best.plan;
  }
  phase.limitReached = phase.evaluations >= MAX_PLAN_CHECKS;
  return { model: currentModel, plan: currentPlan, phase };
}

function groundedResolvedBrickKeys(plan, profile) {
  const groundedComponents = new Set();
  for (const [key, cell] of profile.cells) if (key.split(',')[1] === '0') groundedComponents.add(cell.component);
  const resolvedIds = new Set(plan.steps.filter(({ kind }) => kind !== 'unresolved').flatMap(({ newBrickIds }) => newBrickIds));
  const unresolved = unresolvedCells(plan);
  const resolved = new Set();
  for (const brick of plan.bricks) {
    if (!resolvedIds.has(brick.id)) continue;
    if (cellsOf(brick).some((key) => unresolved.has(key))) continue;
    const component = profile.cells.get(cellsOf(brick)[0])?.component;
    if (groundedComponents.has(component)) resolved.add(brickKey(brick));
  }
  return resolved;
}

function boundsOf(bricks) {
  return bricks.reduce((bounds, brick) => ({
    minX: Math.min(bounds.minX, brick.x), maxX: Math.max(bounds.maxX, brick.x + brick.w - 1),
    minZ: Math.min(bounds.minZ, brick.z), maxZ: Math.max(bounds.maxZ, brick.z + brick.d - 1),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function extensionProposals(model, plan, remainingAddedCells) {
  if (remainingAddedCells <= 0) return [];
  const profile = packingProfile(model.bricks);
  const resolvedGrounded = groundedResolvedBrickKeys(plan, profile);
  const occupancy = profile.cells;
  const roots = rootBricks(plan);
  const bounds = boundsOf(model.bricks);
  const proposals = new Map();
  for (const root of roots) {
    if (root.y < 1) continue;
    const nearbyLowerIndexes = new Set();
    for (let x = root.x - 3; x < root.x + root.w + 3; x += 1) for (let z = root.z - 3; z < root.z + root.d + 3; z += 1) {
      const occupied = occupancy.get(cellKey(x, root.y - 1, z));
      if (occupied) nearbyLowerIndexes.add(occupied.index);
    }
    for (const lowerIndex of [...nearbyLowerIndexes].sort((a, b) => a - b)) {
      const lower = model.bricks[lowerIndex];
      if (!resolvedGrounded.has(brickKey(lower))) continue;
      const oldCells = new Set(cellsOf(lower));
      for (const [w, d] of ORDINARY_FOOTPRINTS) {
        for (let x = lower.x + lower.w - w; x <= lower.x; x += 1) for (let z = lower.z + lower.d - d; z <= lower.z; z += 1) {
          if (x < bounds.minX || z < bounds.minZ || x + w - 1 > bounds.maxX || z + d - 1 > bounds.maxZ) continue;
          if (x + w < lower.x + lower.w || z + d < lower.z + lower.d) continue;
          const after = { x, y: lower.y, z, w, d, color: lower.color };
          const addedCells = cellsOf(after).filter((key) => !oldCells.has(key)).map((key) => {
            const [cellX, cellY, cellZ] = key.split(',').map(Number);
            return { x: cellX, y: cellY, z: cellZ, color: lower.color };
          });
          if (!addedCells.length || addedCells.length > remainingAddedCells) continue;
          if (addedCells.some(({ x: cellX, y, z: cellZ }) => occupancy.has(cellKey(cellX, y, cellZ))
            || !occupancy.has(cellKey(cellX, y + 1, cellZ)))) continue;
          const engagesRoot = addedCells.some(({ x: cellX, z: cellZ }) => cellX >= root.x && cellX < root.x + root.w
            && cellZ >= root.z && cellZ < root.z + root.d);
          if (!engagesRoot) continue;
          const oldKey = brickKey(lower);
          const bricks = model.bricks.map((brick) => brickKey(brick) === oldKey ? after : { ...brick }).sort(compareBricks);
          const signature = `${oldKey}>${brickKey(after)}`;
          if (!proposals.has(signature)) proposals.set(signature, {
            bricks,
            before: [{ ...lower }],
            after: [{ ...after }],
            addedCells,
            targetRootBrickIds: [root.id],
            signature,
          });
          else proposals.get(signature).targetRootBrickIds.push(root.id);
        }
      }
    }
  }
  return [...proposals.values()].sort((a, b) => a.addedCells.length - b.addedCells.length
    || b.targetRootBrickIds.length - a.targetRootBrickIds.length || a.signature.localeCompare(b.signature));
}

function supersetPackingRejections(before, after) {
  const reasons = [];
  const mappedComponents = new Map();
  for (const [key, cell] of before.cells) {
    const next = after.cells.get(key);
    if (!next || next.color !== cell.color) {
      reasons.push('Existing geometry or color changed');
      break;
    }
    const mapped = mappedComponents.get(cell.component);
    if (mapped !== undefined && mapped !== next.component) {
      reasons.push('An existing stud component was split');
      break;
    }
    mappedComponents.set(cell.component, next.component);
  }
  if (after.unsupportedCellCount > before.unsupportedCellCount) reasons.push('Unsupported occupied volume increased');
  return reasons;
}

function extensionPhase({ model, plan, originalCells, preferLocalProgress, addedBudget }) {
  const phase = phaseReport();
  let currentModel = model;
  let currentPlan = plan;
  let remainingAddedCells = addedBudget;
  const attempted = new Set();
  for (let round = 0; round < MAX_ACCEPTED_ROUNDS && phase.evaluations < MAX_PLAN_CHECKS && remainingAddedCells > 0; round += 1) {
    phase.rounds += 1;
    const proposals = extensionProposals(currentModel, currentPlan, remainingAddedCells);
    phase.proposalsGenerated += proposals.length;
    const remainingRounds = MAX_ACCEPTED_ROUNDS - round;
    const roundLimit = Math.ceil((MAX_PLAN_CHECKS - phase.evaluations) / remainingRounds);
    const guarded = [];
    let checked = 0;
    for (const proposal of proposals) {
      if (attempted.has(proposal.signature)) continue;
      attempted.add(proposal.signature);
      if (checked >= roundLimit) break;
      checked += 1;
      phase.evaluations += 1;
      const candidateModel = { ...currentModel, bricks: proposal.bricks.map(({ id: _id, ...brick }) => brick) };
      const beforeProfile = packingProfile(currentModel.bricks);
      const afterProfile = packingProfile(candidateModel.bricks);
      let reasons = supersetPackingRejections(beforeProfile, afterProfile);
      const beforeDiagnostics = inspectConstruction(currentModel);
      const diagnostics = inspectConstruction(candidateModel);
      if (!diagnostics.checks.schema || !diagnostics.checks.legalFootprints || !diagnostics.checks.noCollisions) {
        reasons.push('Invalid or overlapping parts');
      }
      if (diagnostics.stats.weakSupportBrickCount > beforeDiagnostics.stats.weakSupportBrickCount) {
        reasons.push('Weak-support brick count increased');
      }
      let candidatePlan = null;
      let assessment = null;
      if (!reasons.length) {
        try {
          candidatePlan = planFor(candidateModel, preferLocalProgress);
          assessment = validatePlanCandidate({
            currentPlan,
            candidatePlan,
            originalCells,
            addedCells: proposal.addedCells,
          });
          reasons.push(...assessment.reasons);
        } catch {
          reasons.push('Assembly planning failed');
        }
      }
      reasons = [...new Set(reasons)];
      phase.attempts.push({
        before: proposal.before,
        after: proposal.after,
        addedCells: proposal.addedCells,
        targetRootBrickIds: proposal.targetRootBrickIds,
        accepted: false,
        rejectionReasons: reasons,
      });
      if (reasons.length) {
        recordRejections(phase, reasons);
        continue;
      }
      guarded.push({
        model: candidateModel,
        plan: candidatePlan,
        afterSummary: assessment.after,
        addedCells: proposal.addedCells,
        iconicBrickCount: iconicCount(candidateModel.bricks),
        signature: proposal.signature,
        attemptIndex: phase.attempts.length - 1,
      });
    }
    if (!guarded.length) break;
    guarded.sort(candidateOrder);
    const best = guarded[0];
    phase.attempts[best.attemptIndex].accepted = true;
    phase.accepted.push({
      before: phase.attempts[best.attemptIndex].before,
      after: phase.attempts[best.attemptIndex].after,
      addedCells: best.addedCells,
        targetRootBrickIds: phase.attempts[best.attemptIndex].targetRootBrickIds,
        beforeSummary: summary(currentPlan, originalCells),
        afterSummary: best.afterSummary,
        weakSupportBrickCountBefore: inspectConstruction(currentModel).stats.weakSupportBrickCount,
        weakSupportBrickCountAfter: inspectConstruction(best.model).stats.weakSupportBrickCount,
    });
    currentModel = best.model;
    currentPlan = best.plan;
    remainingAddedCells -= best.addedCells.length;
  }
  phase.limitReached = phase.evaluations >= MAX_PLAN_CHECKS;
  phase.addedCellBudget = addedBudget;
  phase.addedCellCount = addedBudget - remainingAddedCells;
  return { model: currentModel, plan: currentPlan, phase };
}

export function refineConstructionRoots(result, { allowExtensions = false } = {}) {
  if (!result || typeof result !== 'object' || !result.brickModel) throw new TypeError('result must contain a brickModel.');
  if (typeof allowExtensions !== 'boolean') throw new TypeError('allowExtensions must be a boolean.');
  const started = globalThis.performance?.now?.() ?? Date.now();
  const originalModel = result.brickModel;
  const originalPlan = result.assemblyPlan ?? createAssemblyPlan({ brickModel: originalModel });
  const originalProfile = packingProfile(originalModel.bricks);
  const originalCells = new Set(originalProfile.cells.keys());
  const preferLocalProgress = result.packingRefinement?.localOrdering?.selected === true;
  const exact = exactPhase({ model: originalModel, plan: originalPlan, originalCells, preferLocalProgress });
  const mappedCellCount = Number.isSafeInteger(result.metrics?.mappedCellCount)
    ? result.metrics.mappedCellCount : originalCells.size;
  const existingAdded = Number.isSafeInteger(result.metrics?.structuralAddedMappedCellCount)
    ? Math.max(0, result.metrics.structuralAddedMappedCellCount) : 0;
  const originalMappedCellCount = Math.max(0, mappedCellCount - existingAdded);
  const extensionBudget = Math.max(0, Math.min(24, Math.floor(originalMappedCellCount * 0.01)) - existingAdded);
  const extended = allowExtensions
    ? extensionPhase({
      model: exact.model,
      plan: exact.plan,
      originalCells,
      preferLocalProgress,
      addedBudget: extensionBudget,
    })
    : { model: exact.model, plan: exact.plan, phase: { ...phaseReport(), addedCellBudget: extensionBudget, addedCellCount: 0 } };
  const ended = globalThis.performance?.now?.() ?? Date.now();
  const accepted = [
    ...exact.phase.accepted.map((entry) => ({ ...entry, phase: 'exact' })),
    ...extended.phase.accepted.map((entry) => ({ ...entry, phase: 'extension' })),
  ];
  const attempts = [
    ...exact.phase.attempts.map((entry) => ({ ...entry, phase: 'exact' })),
    ...extended.phase.attempts.map((entry) => ({ ...entry, phase: 'extension' })),
  ];
  const rejections = {};
  for (const phase of [exact.phase, extended.phase]) for (const [reason, count] of Object.entries(phase.rejections)) {
    rejections[reason] = (rejections[reason] ?? 0) + count;
  }
  const addedCells = extended.phase.accepted.flatMap(({ addedCells: cells }) => cells);
  const report = {
    version: 1,
    policy: 'root-targeted-exact-then-concealed-extension',
    allowExtensions,
    limits: {
      maxPlanChecksPerPhase: MAX_PLAN_CHECKS,
      maxAcceptedRoundsPerPhase: MAX_ACCEPTED_ROUNDS,
      maxAddedCells: extensionBudget,
    },
    before: {
      ...summary(originalPlan, originalCells),
      weakSupportBrickCount: inspectConstruction(originalModel).stats.weakSupportBrickCount,
    },
    accepted,
    attempts,
    rejections,
    exact: exact.phase,
    extension: extended.phase,
    addedCells,
    addedCellCount: addedCells.length,
    budget: { originalMappedCellCount, existingStructuralAddedMappedCellCount: existingAdded, extensionAddedCellLimit: extensionBudget },
    after: {
      ...summary(extended.plan, originalCells),
      weakSupportBrickCount: inspectConstruction(extended.model).stats.weakSupportBrickCount,
    },
    refinementMs: ended - started,
    limitations: 'Exact local retiling and optional concealed support extensions are bounded candidates, not a strength or complete buildability proof. Unresolved prerequisites remain explicit.',
  };
  return {
    ...result,
    brickModel: {
      ...extended.model,
      meta: { ...extended.model.meta, rootRefinement: allowExtensions ? 'exact-and-concealed-extension-v1' : 'exact-v1' },
    },
    diagnostics: inspectConstruction(extended.model),
    assemblyPlan: extended.plan,
    rootRefinement: report,
  };
}
