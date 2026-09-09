import { createAssemblyPlan } from './assembly.js';
import { assessAssemblyQuality, orderQualityRejections } from './assembly-quality.js';
import { proposeBrickRefinements } from './brick-refinement.js';
import { inspectConstruction } from './construction.js';
import { measureBrickDifference } from './construction-differences.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { packingProfile, unresolvedCells, assemblyRejectionReasons } from './refine-construction.js';
import { proposeAttachmentExtensions } from './attachment-proposals.js';
import { proposeAttachmentPatches } from './attachment-patches.js';
import { remapAttachmentBand, attachmentBandRejections, attachmentBandEvidence } from './attachment-band.js';
import { mapAssemblyModules } from './assembly-module-replay.js';
import { assessAttachmentReplay } from './attachment-replay-guards.js';

const MAX_EXACT_CHECKS = 4;
const MAX_EXTENSION_CHECKS = 12;
const MAX_EXTENSION_ROUNDS = 6;
const MAX_FULL_CHECKS = 16;
const MAX_PATCH_CHECKS = 4;
const MAX_REPLAY_CHECKS = 4;
const keyOf = ({x, y, z, w, d, color}) => `${x},${y},${z}:${w}x${d}:${color}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cellsOf = brick => {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x++) for (let z = brick.z; z < brick.z + brick.d; z++) cells.push(`${x},${brick.y},${z}`);
  return cells;
};

function summary(result) {
  const {rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount, brickCount} = result.assemblyPlan.stats;
  return {rootFailureCount, unresolvedBrickCount, blockedJoinCount, temporaryHoldStepCount, brickCount,
    unresolvedCellCount: unresolvedCells(result.assemblyPlan).size,
    groundlessComponentCount: result.diagnostics.stats.groundlessComponentCount,
    heldBrickCount: heldBrickCount(result.assemblyPlan),
    quality: Object.fromEntries(Object.entries(assessAssemblyQuality(result.assemblyPlan)).filter(([, value]) => typeof value === 'number'))};
}

function heldBrickCount(plan) {
  return new Set(plan.steps.flatMap(step => step.issues.filter(issue => issue.code === 'temporary-hold').flatMap(issue => issue.brickIds))).size;
}

function bandEvidence(result) {
  const band = result.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
  if (!band) return null;
  // The established platform recipe and its real attachment contacts are fixed.
  // Unrelated continuation operations may improve when a missing interface is repaired.
  const operations = plan => plan.steps.filter(step => step.moduleId === band.id).map(step => ({
    kind: step.kind, newBrickIds: step.newBrickIds, highlightBrickIds: step.highlightBrickIds,
    issues: step.issues, insertionDirection: step.insertionDirection, joinContext: step.joinContext,
  }));
  return {brickIds: band.brickIds, buildContext: band.buildContext,
    canonical: operations(result.assemblyPlan), diagrams: operations(result.instructionPlan)};
}

function protectedKeys(result) {
  const band = result.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
  const ids = new Set(band?.brickIds ?? []);
  const join = result.assemblyPlan.steps.find(step => step.moduleId === band?.id && step.kind === 'join');
  for (const group of join?.joinContext?.supportGroups ?? []) for (const id of group.brickIds) ids.add(id);
  return new Set(result.assemblyPlan.bricks.filter(brick => ids.has(brick.id)).map(keyOf));
}

function geometryRejections(before, candidate, addedCells) {
  const reasons = [];
  const old = packingProfile(before.brickModel.bricks);
  const next = packingProfile(candidate.brickModel.bricks);
  const components = new Map();
  for (const [key, cell] of old.cells) {
    const replacement = next.cells.get(key);
    if (!replacement || replacement.color !== cell.color) {
      reasons.push('An existing occupied cell was removed or recolored');
      break;
    }
    if (components.has(cell.component) && components.get(cell.component) !== replacement.component) {
      reasons.push('An existing stud component was split');
      break;
    }
    components.set(cell.component, replacement.component);
  }
  const declared = new Map(addedCells.map(cell => [`${cell.x},${cell.y},${cell.z}`, cell.color]));
  const actual = [...next.cells].filter(([key]) => !old.cells.has(key));
  if (actual.length !== declared.size || actual.some(([key, cell]) => declared.get(key) !== cell.color)) {
    reasons.push('Added-cell receipt does not match geometry');
  }
  if (candidate.brickModel.bricks.length > before.brickModel.bricks.length) reasons.push('Part count increased');
  if (next.unsupportedCellCount > old.unsupportedCellCount) reasons.push('Unsupported occupied volume increased');
  const diagnostics = candidate.diagnostics;
  if (!diagnostics.checks.schema || !diagnostics.checks.legalFootprints || !diagnostics.checks.noCollisions) reasons.push('Invalid or colliding parts');
  if (diagnostics.stats.weakSupportBrickCount > before.diagnostics.stats.weakSupportBrickCount) reasons.push('Weak-support brick count increased');
  return reasons;
}

function planRejections(before, candidate, {bandChanged = false, addedCells = []} = {}) {
  const reasons = [...assemblyRejectionReasons(before.assemblyPlan, candidate.assemblyPlan),
    ...orderQualityRejections(assessAssemblyQuality(before.assemblyPlan), assessAssemblyQuality(candidate.assemblyPlan))];
  const oldUnresolved = unresolvedCells(before.assemblyPlan);
  const newUnresolved = unresolvedCells(candidate.assemblyPlan);
  if (newUnresolved.size >= oldUnresolved.size) reasons.push('Unresolved occupied cells did not strictly decrease');
  if (candidate.assemblyPlan.stats.unresolvedBrickCount > before.assemblyPlan.stats.unresolvedBrickCount) reasons.push('Unresolved brick count increased');
  if (heldBrickCount(candidate.assemblyPlan) > heldBrickCount(before.assemblyPlan)) reasons.push('Unique temporarily held brick count increased');
  if (candidate.assemblyPlan.stats.upwardInsertionBrickCount !== 0) reasons.push('Per-brick underside insertion was introduced');
  if (bandChanged) reasons.push(...attachmentBandRejections(before, candidate, addedCells));
  else if (!same(bandEvidence(before), bandEvidence(candidate))) reasons.push('Established platform recipe or join changed');
  const compaction = candidate.assemblyEvaluation?.compaction;
  if (!candidate.guide.stats.coverageComplete || !compaction?.brickCoverageComplete || !compaction?.sourceStepCoverageComplete) reasons.push('Guide coverage is incomplete');
  const introduced = candidate.assemblyPlan.steps.flatMap(step => step.newBrickIds);
  if (introduced.length !== candidate.brickModel.bricks.length || new Set(introduced).size !== introduced.length) reasons.push('A brick was omitted or introduced twice');
  return [...new Set(reasons)];
}

function rebuild(before, brickModel, mappedBand = null, moduleReplay = null) {
  const band = before.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
  const assemblyPlan = createAssemblyPlan({brickModel, preferLocalProgress: true, preferLocalFoundations: true,
    ...(moduleReplay ? {moduleReplay} : band ? {workSurfaceBrickIds: mappedBand?.workSurfaceBrickIds ?? band.brickIds,
      workSurfaceOrder: mappedBand?.workSurfaceOrder ?? band.buildContext.orderPolicy ?? 'course-first'} : {})});
  return prepareAssemblyGuide({...before, brickModel, assemblyPlan, diagnostics: inspectConstruction(brickModel)}, {moduleReplay});
}

function evaluateProposal(current, proposal, phase, round) {
  const attempt = {phase, round, before: proposal.before, after: proposal.after,
    addedCells: proposal.addedCells, targetBrickIds: proposal.targetIds ?? [], anchorBrickIds: proposal.anchorIds ?? [],
    direction: proposal.direction ?? null, selected: false, rejectionReasons: [], bandChanged: false};
  let candidate;
  try {
    const mappedBand = phase === 'patch' || phase === 'replay' ? remapAttachmentBand(current, proposal) : null;
    if (phase === 'replay' && mappedBand?.changed) throw new Error('Ownership replay does not revise the selected work-surface band');
    const moduleReplay = phase === 'replay' ? mapAssemblyModules(current.assemblyPlan, proposal) : null;
    attempt.bandChanged = mappedBand?.changed ?? false;
    const brickModel = {...current.brickModel, bricks: proposal.bricks.map(({id: _id, ...brick}) => brick)};
    const geometryCandidate = {...current, brickModel, diagnostics: inspectConstruction(brickModel)};
    attempt.rejectionReasons = geometryRejections(current, geometryCandidate, proposal.addedCells);
    if (!attempt.rejectionReasons.length) {
      candidate = rebuild(current, brickModel, mappedBand, moduleReplay);
      attempt.rejectionReasons = planRejections(current, candidate, {bandChanged: attempt.bandChanged, addedCells: proposal.addedCells});
      if (moduleReplay) {
        const replayCheck = assessAttachmentReplay(current, candidate, proposal);
        attempt.rejectionReasons.push(...replayCheck.rejectionReasons);
        attempt.moduleReplay = {moduleIds: moduleReplay.map(module => module.id),
          memberships: moduleReplay.map(({id, brickIds}) => ({id, brickIds})), evidence: replayCheck.evidence};
      }
      attempt.afterSummary = summary(candidate);
      if (attempt.bandChanged) {
        attempt.bandMapping = {beforeBrickIds: current.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface').brickIds,
          afterBrickIds: candidate.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface').brickIds};
        attempt.bandEvidence = attachmentBandEvidence(current, candidate);
      }
      const replacementKeys = new Set(proposal.after.map(keyOf));
      const replacementIds = new Set(candidate.assemblyPlan.bricks.filter(brick => replacementKeys.has(keyOf(brick))).map(brick => brick.id));
      const unresolved = unresolvedCells(candidate.assemblyPlan);
      attempt.connectionEvidence = {
        replacementBrickIds: [...replacementIds],
        contacts: candidate.assemblyPlan.graph.edges.filter(edge => replacementIds.has(edge.a) || replacementIds.has(edge.b)),
        sourceOperations: candidate.assemblyPlan.steps.filter(step => step.newBrickIds.some(id => replacementIds.has(id)))
          .map(step => ({id: step.id, kind: step.kind, newBrickIds: step.newBrickIds, issues: step.issues})),
        allAddedCellsResolved: proposal.addedCells.every(cell => !unresolved.has(`${cell.x},${cell.y},${cell.z}`)),
      };
      if (!attempt.connectionEvidence.allAddedCellsResolved) attempt.rejectionReasons.push('An added cell remains unresolved');
    }
  } catch (error) {
    attempt.rejectionReasons.push(`Candidate evaluation failed: ${error.message}`);
  }
  return {candidate, attempt, signature: proposal.signature};
}

function exactProposals(result) {
  const unresolved = unresolvedCells(result.assemblyPlan);
  const rootIds = new Set(result.assemblyPlan.steps.flatMap(step => step.issues
    .filter(issue => issue.code === 'unsupported-addition').flatMap(issue => issue.brickIds)));
  const byId = new Map(result.assemblyPlan.bricks.map(brick => [brick.id, brick]));
  for (const component of result.assemblyPlan.graph.components.filter(component => !component.grounded)) {
    const bricks = component.brickIds.map(id => byId.get(id));
    const floor = Math.min(...bricks.map(brick => brick.y));
    for (const brick of bricks) if (brick.y === floor && cellsOf(brick).some(cell => unresolved.has(cell))) rootIds.add(brick.id);
  }
  const targets = result.assemblyPlan.bricks.filter(brick => rootIds.has(brick.id));
  if (!targets.length) return {proposals: [], stats: {searchNodes: 0}};
  const generated = proposeBrickRefinements(result.brickModel, {targetBricks: targets,
    maxPatches: 48, maxSearchNodes: 12_000, supportOnly: true});
  return {proposals: generated.proposals.map(proposal => ({...proposal, addedCells: [],
    targetIds: targets.map(brick => brick.id),
    signature: `${proposal.before.map(keyOf).sort().join('|')}>${proposal.after.map(keyOf).sort().join('|')}`})), stats: generated.stats};
}

/** A finite post-planning repair, including detached joins absent from root counts. */
export function repairAttachmentInterfaces(before, {rawModel, allowExtensions = false} = {}) {
  if (!before?.assemblyPlan || !before?.instructionPlan || !before?.guide || !before?.diagnostics?.stats
    || !Number.isFinite(before.metrics?.conversionMs)) throw new TypeError('Attachment repair requires a prepared construction result.');
  if (typeof allowExtensions !== 'boolean') throw new TypeError('allowExtensions must be a boolean.');
  if (rawModel?.kind !== 'voxels' || !rawModel.cells?.length) throw new TypeError('rawModel must be a nonempty voxel model.');
  const started = performance.now();
  const originalCells = packingProfile(before.brickModel.bricks).cells.size;
  const priorAdded = Math.max(0, before.metrics.structuralAddedMappedCellCount ?? 0);
  const originalMappedCellCount = Math.max(0, (before.metrics.mappedCellCount ?? originalCells) - priorAdded);
  const maxAddedCells = Math.max(0, Math.min(24, Math.floor(originalMappedCellCount * 0.01)) - priorAdded);
  const report = {version: 3, policy: 'post-assembly-missing-interfaces-v3', selected: false, allowExtensions,
    limits: {maxExactChecks: MAX_EXACT_CHECKS, maxExtensionChecks: MAX_EXTENSION_CHECKS,
      maxExtensionRounds: MAX_EXTENSION_ROUNDS, maxFullChecks: MAX_FULL_CHECKS, maxPatchChecks: MAX_PATCH_CHECKS,
      maxReplayChecks: MAX_REPLAY_CHECKS, maxAddedCells},
    budget: {originalMappedCellCount, priorAdded, maxAddedCells}, before: summary(before),
    attempts: [], accepted: [], addedCells: [], addedCellCount: 0, searches: []};
  let current = before;
  const replayCandidates = [];
  let extensionChecks = 0;
  for (let round = -1; round < MAX_EXTENSION_ROUNDS; round++) {
    const exact = round === -1;
    if (!exact && (!allowExtensions || extensionChecks >= MAX_EXTENSION_CHECKS || report.addedCells.length >= maxAddedCells)) break;
    const generationStarted = performance.now();
    const generated = exact ? exactProposals(current) : proposeAttachmentExtensions(current, {
      maxAddedCells: maxAddedCells - report.addedCells.length, maxProposals: 48});
    const phase = exact ? 'exact' : 'extension';
    report.searches.push({phase, round: round + 1, ...generated.stats, generationMs: performance.now() - generationStarted});
    const protectedParts = protectedKeys(current);
    const limit = exact ? MAX_EXACT_CHECKS : MAX_EXTENSION_CHECKS - extensionChecks;
    let checked = 0;
    const accepted = [];
    for (const proposal of generated.proposals) {
      if (proposal.before.some(brick => protectedParts.has(keyOf(brick)))) continue;
      if (checked >= limit || (!exact && accepted.length >= 1)) break;
      checked++;
      if (!exact) extensionChecks++;
      const evaluated = evaluateProposal(current, proposal, phase, round + 1);
      report.attempts.push(evaluated.attempt);
      if (evaluated.attempt.rejectionReasons.length && evaluated.attempt.afterSummary) replayCandidates.push({proposal, attempt: evaluated.attempt});
      if (!evaluated.attempt.rejectionReasons.length) accepted.push(evaluated);
    }
    accepted.sort((a, b) => a.attempt.afterSummary.unresolvedCellCount - b.attempt.afterSummary.unresolvedCellCount
      || a.attempt.addedCells.length - b.attempt.addedCells.length || a.signature.localeCompare(b.signature));
    if (accepted.length) {
      const selected = accepted[0];
      selected.attempt.selected = true;
      report.accepted.push(selected.attempt);
      report.addedCells.push(...selected.attempt.addedCells);
      current = selected.candidate;
    } else if (!exact) break;
  }
  // Use only checks left by the established pass. A coordinated patch can
  // revise the selected band, but must rebuild its recipe and prove its join.
  const patchLimit = Math.min(MAX_PATCH_CHECKS, MAX_FULL_CHECKS - report.attempts.length);
  if (allowExtensions && patchLimit > 0 && report.addedCells.length < maxAddedCells) {
    const generationStarted = performance.now();
    const generated = proposeAttachmentPatches(current, {maxAddedCells: maxAddedCells - report.addedCells.length, maxProposals: 24, maxAdditionalParts: 0});
    const ownershipRejections = {};
    const eligible = generated.proposals.filter(proposal => {
      try { remapAttachmentBand(current, proposal); return true; }
      catch (error) {
        ownershipRejections[error.message] = (ownershipRejections[error.message] ?? 0) + 1;
        return false;
      }
    });
    report.searches.push({phase: 'patch', round: 1, ...generated.stats, eligibleProposalCount: eligible.length,
      ownershipRejections, generationMs: performance.now() - generationStarted});
    for (const proposal of eligible.slice(0, patchLimit)) {
      const evaluated = evaluateProposal(current, proposal, 'patch', 1);
      report.attempts.push(evaluated.attempt);
      if (evaluated.attempt.rejectionReasons.length) {
        if (evaluated.attempt.afterSummary) replayCandidates.push({proposal, attempt: evaluated.attempt});
        continue;
      }
      evaluated.attempt.selected = true;
      report.accepted.push(evaluated.attempt);
      report.addedCells.push(...evaluated.attempt.addedCells);
      current = evaluated.candidate;
      break;
    }
  }
  // A small geometry change can cause global module discovery to undo an
  // otherwise useful interface. Replay the established ownership instead;
  // every replay is a separate full check, never an uncounted retry.
  const replayLimit = Math.min(MAX_REPLAY_CHECKS, MAX_FULL_CHECKS - report.attempts.length);
  const replaySeen = new Set();
  let replayChecks = 0;
  replayCandidates.sort((a, b) => a.attempt.afterSummary.unresolvedCellCount - b.attempt.afterSummary.unresolvedCellCount
    || a.proposal.addedCells.length - b.proposal.addedCells.length || a.proposal.signature.localeCompare(b.proposal.signature));
  for (const {proposal, attempt: originalAttempt} of replayCandidates) {
    if (replayChecks >= replayLimit) break;
    // This first replay repairs a new physical interface. Exact seam-only
    // retiling remains in the existing exact stage and needs different proof.
    if (!proposal.addedCells.length || !proposal.anchorIds?.length || !proposal.targetIds?.length) continue;
    if (replaySeen.has(proposal.signature)) continue;
    replaySeen.add(proposal.signature);
    const oldKeys = new Set(proposal.before.map(keyOf));
    const currentKeys = new Set(current.brickModel.bricks.map(keyOf));
    if ([...oldKeys].some(key => !currentKeys.has(key))
      || proposal.addedCells.length + report.addedCells.length > maxAddedCells) continue;
    const remapped = {...proposal, bricks: [...current.brickModel.bricks.filter(brick => !oldKeys.has(keyOf(brick))), ...proposal.after]};
    replayChecks++;
    const evaluated = evaluateProposal(current, remapped, 'replay', 1);
    evaluated.attempt.originalPhase = originalAttempt.phase;
    evaluated.attempt.originalRejectionReasons = originalAttempt.rejectionReasons;
    report.attempts.push(evaluated.attempt);
    if (evaluated.attempt.rejectionReasons.length) continue;
    evaluated.attempt.selected = true;
    report.accepted.push(evaluated.attempt);
    report.addedCells.push(...evaluated.attempt.addedCells);
    current = evaluated.candidate;
    break;
  }
  report.selected = report.accepted.length > 0;
  report.addedCellCount = report.addedCells.length;
  report.after = summary(current);
  const difference = report.selected ? measureBrickDifference(rawModel, current.brickModel) : {};
  report.stageMs = performance.now() - started;
  report.limitations = 'Bounded ordinary-brick interface repair. A band patch preserves its old occupied cells, ordering policy and physical join contacts, with the table build replayed. An optional ownership replay preserves the established module partition and fully checks every build/join; it cannot revise the selected band or its independent supports. At most one added cell per patch may be uncovered above. Added cells can change the silhouette; visual acceptance, clutch strength, balance and hand clearance remain unverified. Unrepairable interfaces remain explicit.';
  const partHistogram = {};
  for (const {w, d} of current.brickModel.bricks) {
    const key = `${Math.min(w, d)}x${Math.max(w, d)}`;
    partHistogram[key] = (partHistogram[key] ?? 0) + 1;
  }
  return {...current, attachmentRefinement: report, metrics: {...before.metrics, ...difference,
    brickCount: current.brickModel.bricks.length, partHistogram,
    structuralAddedMappedCellCount: priorAdded + report.addedCellCount,
    attachmentRepairAddedMappedCellCount: report.addedCellCount,
    conversionMs: before.metrics.conversionMs + report.stageMs,
    stageTiming: {...before.metrics.stageTiming, attachmentRepairMs: report.stageMs}}};
}
