import { createAssemblyPlan } from './assembly.js';
import { assessAssemblyQuality, orderQualityRejections } from './assembly-quality.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { assemblyRejectionReasons } from './refine-construction.js';
import { assessWorkSurfaceQuality } from './work-surface-quality.js';
import { assessBandRegularity, assessLayerGrouping } from './layer-regularity.js';

function measurements(result, moduleId) {
  return {
    canonical: assessWorkSurfaceQuality(result.assemblyPlan).aggregate,
    diagrams: assessWorkSurfaceQuality(result.instructionPlan).aggregate,
    bandDiagramCount: result.instructionPlan.steps.filter(step => step.moduleId === moduleId).length,
    instructionDiagramCount: result.instructionPlan.steps.length,
    grouping: assessLayerGrouping(result.instructionPlan, moduleId),
    assembly: Object.fromEntries(Object.entries(assessAssemblyQuality(result.assemblyPlan))
      .filter(([, value]) => typeof value === 'number')),
  };
}

function operationEvidence({moduleId, kind, newBrickIds, visibleBrickIds, highlightBrickIds, insertionDirection, issues, joinContext}) {
  // Step IDs/labels are renumbered after changing the band's operation count.
  // The actual additions, context, contacts and every warning stay authoritative.
  return {moduleId, kind, newBrickIds, visibleBrickIds, highlightBrickIds, insertionDirection, issues, joinContext};
}

export function workSurfacePreservationRejections(before, candidate, module) {
  const original = before.assemblyPlan;
  const plan = candidate.assemblyPlan;
  const reasons = assemblyRejectionReasons(original, plan);
  for (const field of ['bricks', 'inventory', 'graph']) {
    if (JSON.stringify(original[field]) !== JSON.stringify(plan[field])) reasons.push(`${field} changed`);
  }
  if (JSON.stringify(before.brickModel) !== JSON.stringify(candidate.brickModel)) reasons.push('Brick model changed');
  const band = plan.modules.find(item => item.id === module.id);
  if (JSON.stringify(module.brickIds) !== JSON.stringify(band?.brickIds)) reasons.push('Selected band changed');
  const outsideOperations = assembly => assembly.steps.filter(step => step.moduleId !== module.id)
    .map(operationEvidence);
  if (JSON.stringify(outsideOperations(original)) !== JSON.stringify(outsideOperations(plan))) reasons.push('Operations outside the selected band changed');
  const oldJoin = original.steps.find(step => step.moduleId === module.id && step.kind === 'join');
  const newJoin = plan.steps.find(step => step.moduleId === module.id && step.kind === 'join');
  if (!oldJoin || !newJoin || JSON.stringify(operationEvidence(oldJoin)) !== JSON.stringify(operationEvidence(newJoin))
    || newJoin.issues.some(issue => issue.severity === 'error')) reasons.push('Successful join or its support contacts changed');
  if (plan.steps.some(step => step.moduleId === module.id && step.newBrickIds.length
    && (step.kind !== 'build' || step.issues.some(issue => issue.severity === 'error')))) reasons.push('Band build failed');
  if (plan.stats.upwardInsertionBrickCount > original.stats.upwardInsertionBrickCount) reasons.push('Upward additions increased');
  const coverage = candidate.assemblyEvaluation?.compaction;
  if (!candidate.instructionPlan.stats.coverageComplete || !candidate.guide.stats.coverageComplete
    || !coverage?.sourceStepCoverageComplete || !coverage?.brickCoverageComplete) reasons.push('Guide coverage changed');
  return reasons;
}

// One usability comparison AFTER a band has passed the structural search. The
// baseline remains available; clearer grouping cannot excuse new failures.
export function refineWorkSurfaceOrder(result) {
  const module = result.assemblyPlan.modules.find(item => item.buildContext?.kind === 'work-surface');
  if (!module) return result;
  const started = performance.now();
  const selectedIds = new Set(module.brickIds);
  const regularity = assessBandRegularity(result.assemblyPlan.bricks.filter(brick => selectedIds.has(brick.id)));
  const policy = regularity.eligible ? 'rectangular-layers' : 'connected-patches';
  const before = measurements(result, module.id);
  const limits = {maxFullCandidates:1, maxAdditionalBandDiagrams:policy === 'rectangular-layers' ? 2
    : Math.max(2, Math.ceil(before.bandDiagramCount / 2))};
  let candidate = null;
  let candidateMetrics = null;
  const rejectionReasons = [];
  try {
    const assemblyPlan = createAssemblyPlan({brickModel:result.brickModel,
      workSurfaceBrickIds:module.brickIds, workSurfaceOrder:policy,
      preferLocalProgress:true, preferLocalFoundations:true});
    candidate = prepareAssemblyGuide({...result, assemblyPlan});
    candidateMetrics = measurements(candidate, module.id);
    rejectionReasons.push(...workSurfacePreservationRejections(result, candidate, module),
      ...orderQualityRejections(before.assembly, candidateMetrics.assembly));
    if (policy === 'rectangular-layers') {
      const originalGrouping = before.grouping;
      const newGrouping = candidateMetrics.grouping;
      if (newGrouping.mixedCourseDiagramCount !== 0 || newGrouping.courseReturnCount !== 0) {
        rejectionReasons.push('Rectangular layer progression mixes or revisits courses');
      }
      if (newGrouping.rectangularCoverageRatio + 1e-9 < originalGrouping.rectangularCoverageRatio) {
        rejectionReasons.push('Rectangular group coverage decreased');
      }
      if (newGrouping.partialLineExposure > originalGrouping.partialLineExposure) {
        rejectionReasons.push('Cumulative layer frontier became more fragmented');
      }
      if (newGrouping.mixedCourseDiagramCount >= originalGrouping.mixedCourseDiagramCount
        && newGrouping.rectangleEmptyCellCount >= originalGrouping.rectangleEmptyCellCount) {
        rejectionReasons.push('Layer grouping did not strictly improve');
      }
      // Regular table layouts intentionally need not minimize loose parts. Keep
      // those measurements, while the assembly and join guards remain binding.
      if (candidateMetrics.canonical.finalComponentCount !== before.canonical.finalComponentCount) {
        rejectionReasons.push('Final work-surface connectivity changed');
      }
    } else {
      for (const scope of ['canonical', 'diagrams']) {
        for (const key of ['peakComponentCount', 'peakDetachedBrickCount', 'peakStepDetachedBrickCount', 'peakLooseBrickCount', 'detachedBrickExposure', 'finalComponentCount']) {
          if (candidateMetrics[scope][key] > before[scope][key]) rejectionReasons.push(`${scope}.${key} increased`);
        }
        const oldBond = before[scope].firstBondAtAddition;
        const newBond = candidateMetrics[scope].firstBondAtAddition;
        if (oldBond !== null && (newBond === null || newBond > oldBond)) rejectionReasons.push(`${scope}.firstBondAtAddition delayed`);
      }
      if (candidateMetrics.canonical.detachedBrickExposure >= before.canonical.detachedBrickExposure) {
        rejectionReasons.push('Detached-brick exposure did not strictly decrease');
      }
    }
    if (candidateMetrics.bandDiagramCount > before.bandDiagramCount + limits.maxAdditionalBandDiagrams
      || candidateMetrics.instructionDiagramCount > before.instructionDiagramCount + limits.maxAdditionalBandDiagrams) {
      rejectionReasons.push('Additional diagrams exceed the bounded ordering tradeoff');
    }
  } catch (error) {
    rejectionReasons.push(`Ordering evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const selected = rejectionReasons.length === 0;
  const chosen = selected ? candidate : result;
  const orderingMs = performance.now() - started;
  return {...chosen,
    workSurfaceOrdering:{version:2, policy, regularity, selected, limits,
      rejectionReasons:[...new Set(rejectionReasons)], before, candidate:candidateMetrics,
      after:selected ? candidateMetrics : before, orderingMs, geometryChanges:0, colorChanges:0,
      limitations:'Regular platforms favor rectangular same-course groups; irregular bands favor early connections. Rectangularity and loose-part exposure are separate presentation/handling proxies, not strength, table stability or finger-access checks. At most one alternative is evaluated for the selected band; rejected alternatives retain the prior guide.'},
    metrics:{...chosen.metrics, conversionMs:result.metrics.conversionMs + orderingMs,
      stageTiming:{...result.metrics.stageTiming, workSurfaceOrderingMs:orderingMs}},
  };
}
