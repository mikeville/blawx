import {createAssemblyPlan} from './assembly.js';
import {completeBaseRegions} from './assembly-supports.js';
import {proposeSharedRecipes} from './assembly-recipes.js';
import {refineConstructionRoots} from './root-refinement.js';
import {planSubassemblies} from './plan-subassemblies.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {assemblyRejectionReasons, unresolvedCells} from './refine-construction.js';
import {assessAssemblyQuality, orderQualityRejections} from './assembly-quality.js';
import {inspectConstruction} from './construction.js';
import {measureBrickDifference} from './construction-differences.js';

// A support repair and the assembly it enables must be assessed together. A
// partially supported platform can otherwise keep every valid local support
// repair from ever reaching the separate-build planner.
export function planFoundationAssemblies(before, {rawModel, adjustments = false} = {}) {
  const plan = before.assemblyPlan;
  if (!plan || before.assemblyError || plan.bricks.length > 800
    || plan.modules.some(module => module.buildContext)) return before;
  const roots = new Set(plan.steps.flatMap(step => step.issues
    .filter(issue => issue.code === 'unsupported-addition').flatMap(issue => issue.brickIds)));
  const floors = [...new Set(plan.bricks.filter(brick => roots.has(brick.id)).map(brick => brick.y))].sort((a,b) => a-b);
  if (floors.length < 2) return before;
  const started = performance.now();
  let candidate, repair, completed, shared;
  let reasons = [];
  try {
    const repaired = refineConstructionRoots(before, {allowExtensions: adjustments, rootFloor: floors[0]});
    repair = repaired.rootRefinement;
    if (!repair.accepted.length) return before;
    candidate = planSubassemblies(prepareAssemblyGuide(repaired), {completeSupports: true});
    if (!candidate.subassemblyRefinement.selected) reasons.push('Support repairs did not enable a separate assembly');
    if (!reasons.length) {
      const replay = candidate.assemblyPlan.modules.map(module => ({...module,
        brickOrder: candidate.assemblyPlan.steps.filter(step => step.moduleId === module.id).flatMap(step => step.newBrickIds)}));
      completed = completeBaseRegions(replay, candidate.assemblyPlan);
      // Match exact component geometry here. Any added support volume is already
      // bounded and recorded by the root repair, not inferred from repetition.
      shared = proposeSharedRecipes(candidate.brickModel, completed.replay);
      candidate = prepareAssemblyGuide({...candidate, brickModel: shared.brickModel,
        assemblyPlan: createAssemblyPlan({brickModel: shared.brickModel, moduleReplay: shared.replay,
          preferLocalProgress: true, preferLocalFoundations: true})});
      reasons.push(...assemblyRejectionReasons(plan, candidate.assemblyPlan),
        ...orderQualityRejections(assessAssemblyQuality(plan), assessAssemblyQuality(candidate.assemblyPlan)));
      if (unresolvedCells(candidate.assemblyPlan).size >= unresolvedCells(plan).size) reasons.push('Unresolved volume did not decrease');
      if (candidate.assemblyPlan.stats.upwardInsertionBrickCount > plan.stats.upwardInsertionBrickCount) reasons.push('Upward insertions increased');
      if (!candidate.guide.stats.coverageComplete || !candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete
        || !candidate.assemblyEvaluation.compaction.brickCoverageComplete) reasons.push('Incomplete instruction coverage');
    }
  } catch (error) { reasons.push(error.message); }
  const report = {policy: 'supports-before-platform', selected: !reasons.length, rootFloor: floors[0],
    repair, completedBaseBricks: (completed?.moved ?? 0)+(candidate?.subassemblyRefinement?.completedSupportBrickCount ?? 0), repeatedRecipes: shared?.families ?? [],
    beforeUnresolved: plan.stats.unresolvedBrickCount, afterUnresolved: candidate?.assemblyPlan.stats.unresolvedBrickCount,
    rejectionReasons: reasons, planningMs: performance.now()-started};
  if (reasons.length) return {...before, foundationAssemblyPlanning: report};
  const partHistogram = {};
  for (const {w,d} of candidate.brickModel.bricks) {
    const key = `${Math.min(w,d)}x${Math.max(w,d)}`;
    partHistogram[key] = (partHistogram[key] ?? 0)+1;
  }
  return {...candidate, diagnostics: inspectConstruction(candidate.brickModel),
    rootRefinement: before.rootRefinement, foundationAssemblyPlanning: report,
    metrics: {...before.metrics, ...(rawModel ? measureBrickDifference(rawModel, candidate.brickModel) : {}),
      brickCount: candidate.brickModel.bricks.length, partHistogram,
      structuralAddedMappedCellCount: (before.metrics.structuralAddedMappedCellCount ?? 0)+repair.addedCellCount,
      conversionMs: before.metrics.conversionMs+report.planningMs,
      stageTiming: {...before.metrics.stageTiming, foundationAssemblyMs: report.planningMs}}};
}
