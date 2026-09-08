import { convertToBricks } from './construction.js';
import { refineConstruction, assemblyRejectionReasons } from './refine-construction.js';
import { refineConstructionRoots } from './root-refinement.js';
import { measureBrickDifference } from './construction-differences.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { createGuideSections } from './guide-sections.js';
import { assessAssemblyQuality, orderQualityRejections } from './assembly-quality.js';
import { planSubassemblies } from './plan-subassemblies.js';

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

export function completeConstruction(options) {
  let result = convertToBricks(options);
  try {
    result = refineConstruction(result);
    result = prepareAssemblyGuide(result);
    result = repairPreparedConstruction(result, {
      rawModel: options.rawModel, allowExtensions: options.adjustments === true,
    });
    return planSubassemblies(result);
  } catch (error) {
    result.assemblyError = error.message || 'Assembly planning failed.';
    if (result.assemblyPlan && !result.guide) result.guide = createGuideSections(result.assemblyPlan);
    return result;
  }
}
