import {scheduleSupportedContinuations} from './supported-continuation-order.js';
import {completeFoundationRecipes} from './complete-foundation-recipes.js';
import {completeDeferredBranches} from './complete-deferred-branches.js';
import {scheduleAttachmentDependencies} from './attachment-dependency-order.js';
import { completeGroundBranches } from './ground-branch-tasks.js';
import { completeWorkingSections } from './complete-working-sections.js';
import {completeFeatureTasks} from './complete-feature-tasks.js';
import {completeNestedGroundLayouts,consolidateCompactNestedAreas} from './nested-ground-layouts.js';
import {completeNestedCourseDiagrams} from './nested-course-diagrams.js';
import {completeSupportedComponentRecipes} from './supported-component-recipes.js';
import {completeComponentOwnership} from './complete-component-ownership.js';
import {completeNestedDetachedComponents} from './nested-detached-components.js';
import {completeDetachedComponents} from './complete-detached-components.js';
import {completeGroundedComponents} from './complete-grounded-components.js';
import {completeRecipeDependents} from './complete-recipe-dependents.js';
import {consolidateUnderAttachmentTasks} from './under-attachment-tasks.js';
import {prepareNestedRecipePresentation} from './nested-recipe-presentation.js';
import {completeReceiverUndersides} from './receiver-undersides.js';
import {completeReceiverSupports} from './complete-receiver-supports.js';
import {completeReceiverConnections} from './complete-receiver-connections.js';
import {completeHeldAssemblies} from './complete-held-assemblies.js';
import {completeUndersideAssemblies} from './complete-underside-assemblies.js';
import {repairReceiverDetails} from './receiver-detail-repair.js';
import {completeAssemblyRecipes} from './complete-assembly-recipes.js';
import {repairLocalInterfaces} from './local-interface-repair.js';
import {replanReceiverRecipes} from './receiver-recipes.js';
import {shareHandledRecipes} from './shared-handled-recipes.js';
import {replanWorkAreaTasks} from './work-area-tasks.js';
import {replanRecipeTasks, replanRecipeFloors, replanSupportedRecipeCourses} from './recipe-tasks.js';
import {refineRepeatedSupportCores} from './repeated-support-cores.js';
import {refineMixedCourseTasks} from './mixed-course-tasks.js';
import {completeSupportedCourses} from './course-completion.js';
import {scheduleAreaContinuations} from './area-continuations.js';
import {scheduleRepeatedDetails} from './repeated-detail-order.js';
import {scheduleBuildRegions, scheduleSupportedBuildRegions} from './build-regions.js';
import {refineSupportedInstructionRuns, refineSupportedInstructionAreas} from './supported-instruction-runs.js';
import {refineOfflineRecipes} from './offline-recipes.js';
import {consolidatePlacementTasks} from './placement-task-diagrams.js';
import {refineCourseFeatures} from './course-features.js';
import { convertToBricks } from './construction.js';
import { refineConstruction, assemblyRejectionReasons } from './refine-construction.js';
import { refineConstructionRoots } from './root-refinement.js';
import { measureBrickDifference } from './construction-differences.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { createGuideSections } from './guide-sections.js';
import { assessAssemblyQuality, orderQualityRejections } from './assembly-quality.js';
import { planSubassemblies, revisitSubassembliesAfterAttachment } from './plan-subassemblies.js';
import { repairAttachmentInterfaces } from './attachment-repair.js';
import { repairConstructionContinuity } from './construction-continuity.js';
import { refineAssemblySequence } from './refine-assembly-sequence.js';
import { refineAssemblyBands } from './assembly-bands.js';
import { consolidateSurfaceDiagrams } from './surface-diagrams.js';
import { planFoundationAssemblies } from './foundation-assemblies.js';
import { planConnectedAssemblies } from './connected-assemblies.js';
import { planComponentPacking } from './component-packing.js';
import {completeGroundLayout} from './ground-layout.js';
import {completeComponentTasks} from './component-tasks.js';
import {scheduleUnderAttachments} from './under-attachment-order.js';
import {planElevatedAssemblies} from './elevated-assemblies.js';
import {planHangingAssemblies} from './hanging-assemblies.js';
import { refineRepeatedSupports } from './assembly-supports.js';

function partHistogram(bricks) {
  const counts = {};
  for (const {w, d} of bricks) {
    const key = `${Math.min(w, d)}x${Math.max(w, d)}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function measuredRepair(before, repaired, rawModel) {
  const started = performance.now();
  const difference = measureBrickDifference(rawModel, repaired.brickModel);
  const metricMs = performance.now() - started;
  const report = repaired.rootRefinement;
  return {
    ...repaired,
    rootRefinement: {...report, selected: report.accepted.length > 0},
    metrics: {
      ...before.metrics,
      ...difference,
      conversionMs: before.metrics.conversionMs + report.refinementMs + metricMs,
      brickCount: repaired.brickModel.bricks.length,
      partHistogram: partHistogram(repaired.brickModel.bricks),
      rootRepairAddedMappedCellCount: report.addedCellCount,
      structuralAddedMappedCellCount: before.metrics.structuralAddedMappedCellCount + report.addedCellCount,
      stageTiming: {...before.metrics.stageTiming, rootRefinementMs: report.refinementMs, rootMetricMs: metricMs},
    },
  };
}

// The browser and evaluator share this stage. Its final guard includes the
// resulting order, not just the local patch that initiated the repair.
export function repairPreparedConstruction(before, {rawModel, allowExtensions = false}) {
  const started = performance.now();
  const refined = refineConstructionRoots(before, {allowExtensions});
  refined.rootRefinement.refinementMs = performance.now() - started;
  const repaired = measuredRepair(before, refined, rawModel);
  if (!repaired.rootRefinement.accepted.length) return repaired;
  const candidate = prepareAssemblyGuide(repaired);
  const reasons = [
    ...assemblyRejectionReasons(before.assemblyPlan, candidate.assemblyPlan),
    ...orderQualityRejections(assessAssemblyQuality(before.assemblyPlan), assessAssemblyQuality(candidate.assemblyPlan)),
  ];
  if (!reasons.length) return candidate;
  return {
    ...before,
    rootRefinement: {
      ...candidate.rootRefinement,
      selected: false,
      proposedAfter: candidate.rootRefinement.after,
      after: candidate.rootRefinement.before,
      proposedAccepted: candidate.rootRefinement.accepted,
      accepted: [],
      proposedAddedCells: candidate.rootRefinement.addedCells,
      addedCells: [],
      addedCellCount: 0,
      finalRejectionReasons: reasons,
    },
    metrics: {
      ...before.metrics,
      conversionMs: candidate.metrics.conversionMs,
      stageTiming: candidate.metrics.stageTiming,
    },
  };
}

function construct(options, converted = convertToBricks(options)) {
  let result = converted;
  try {
    result = refineConstruction(result);
    result = prepareAssemblyGuide(result);
    result = repairPreparedConstruction(result, {
      rawModel: options.rawModel, allowExtensions: options.adjustments === true,
    });
    result = planSubassemblies(result);
    return revisitSubassembliesAfterAttachment(repairAttachmentInterfaces(result, {
      rawModel: options.rawModel, allowExtensions: options.adjustments === true,
    }));
  } catch (error) {
    result.assemblyError = error.message || 'Assembly planning failed.';
    if (result.assemblyPlan && !result.guide) result.guide = createGuideSections(result.assemblyPlan);
    return result;
  }
}

function constructComplete(options) {
  const started = performance.now();
  const result = planFoundationAssemblies(construct(options), options);
  if (!options.adjustments || result.assemblyError || !result.assemblyPlan?.stats.unresolvedBrickCount
    || result.brickModel.bricks.length > 800) return result;
  // This is a bounded local repair, not a global redesign of heavily fragmented
  // models. Leave those to the existing planner instead of repeating expensive
  // searches with little prospect of solving all affected interfaces.
  if (result.assemblyPlan.stats.rootFailureCount > 8
    || result.assemblyPlan.stats.unresolvedBrickCount === 1 && result.assemblyPlan.stats.blockedJoinCount) return result;
  try {
    const recoveryOptions = {...options,preserveThinLayers:true};
    const converted = convertToBricks(recoveryOptions);
    const seed = converted.metrics.recoveredThinLayerCellCount ? construct(recoveryOptions, converted) : result;
    const repaired = seed.assemblyError ? result : repairConstructionContinuity(result,seed,options.rawModel);
    return {...repaired,metrics:{...repaired.metrics,conversionMs:performance.now()-started}};
  } catch (error) {
    return {...result,metrics:{...result.metrics,conversionMs:performance.now()-started},
      continuityRefinement:{selected:false,rejectionReasons:[error.message]}};
  }
}

export function completeConstruction(options) {
  const planned = scheduleBuildRegions(refineCourseFeatures(consolidateSurfaceDiagrams(refineAssemblyBands(refineAssemblySequence(planElevatedAssemblies(planHangingAssemblies(planConnectedAssemblies(planComponentPacking(constructComplete(options))))), options)))));
  const local = refineSupportedInstructionAreas(refineOfflineRecipes(refineSupportedInstructionRuns(planned)));
  const grouped = consolidatePlacementTasks(local);
  const ordered = scheduleAreaContinuations(scheduleRepeatedDetails(scheduleSupportedBuildRegions(grouped)));
  const tasks = replanWorkAreaTasks(completeComponentTasks(completeGroundLayout(scheduleUnderAttachments(refineRepeatedSupports(refineMixedCourseTasks(completeSupportedCourses(ordered)))))));
  const recipes = replanReceiverRecipes(refineRepeatedSupportCores(replanSupportedRecipeCourses(replanRecipeFloors(replanRecipeTasks(tasks)))));
  const connected = completeDetachedComponents(repairLocalInterfaces(shareHandledRecipes(replanWorkAreaTasks(recipes,{consolidateCourses:true})),{allowExtensions:options.adjustments===true,rawModel:options.rawModel}));
  const completed=completeReceiverSupports(completeReceiverUndersides(completeAssemblyRecipes(repairReceiverDetails(connected,{allowExtensions:options.adjustments===true,rawModel:options.rawModel}))));
  const attached=consolidateUnderAttachmentTasks(completeRecipeDependents(completeGroundedComponents(completeUndersideAssemblies(completeHeldAssemblies(completeReceiverConnections(completed,{allowExtensions:options.adjustments===true,rawModel:options.rawModel}))))));
  const prepared = prepareNestedRecipePresentation(completeNestedGroundLayouts(attached));
  const owned = completeComponentOwnership(completeSupportedComponentRecipes(completeNestedCourseDiagrams(completeNestedDetachedComponents(prepared))));
  const features = completeFeatureTasks(consolidateCompactNestedAreas(completeNestedGroundLayouts(owned)));
  // Component discovery can introduce table recipes after the earlier local
  // pass. Give those completed scopes the same course-planning alternatives,
  // then restore the reader's repeated-recipe presentation if sections changed.
  const working=completeWorkingSections(completeGroundBranches(prepareNestedRecipePresentation(refineOfflineRecipes(features))));
  // Late planning can expose small handled repairs around a completed receiver.
  // Try completing those with it; physical replay still rejects blocked paths.
  return completeNestedDetachedComponents(scheduleAttachmentDependencies(completeDeferredBranches(completeFoundationRecipes(scheduleSupportedContinuations(replanReceiverRecipes(working,{allowChildStrengthAdvisories:true}))))),{workingOrientation:true});
}
