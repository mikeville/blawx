import { createAssemblyPlan } from './assembly.js';
import { compactAssemblyPlan } from './assembly-diagrams.js';
import { createGuideSections } from './guide-sections.js';
import { assemblyRejectionReasons } from './refine-construction.js';
import { assessAssemblyQuality, orderQualityImproved, orderQualityRejections } from './assembly-quality.js';

// A bounded local evaluate/choose pass. It preserves construction evidence and
// the explicit placement sequence separately from the diagrams a builder reads.
export function prepareAssemblyGuide(result, {moduleReplay = null} = {}) {
  const started = performance.now();
  const original = result.assemblyPlan ?? createAssemblyPlan({brickModel: result.brickModel});
  const before = assessAssemblyQuality(original);
  let plan = original;
  const attempts = [];
  const workSurface = original.modules.find(module => module.buildContext?.kind === 'work-surface');
  const candidate = createAssemblyPlan({
    brickModel: result.brickModel, preferLocalProgress: true, preferLocalFoundations: true,
    ...(moduleReplay ? {moduleReplay} : workSurface ? {workSurfaceBrickIds:workSurface.brickIds,
      workSurfaceOrder:workSurface.buildContext.orderPolicy ?? 'course-first'} : {}),
  });
  const quality = assessAssemblyQuality(candidate);
  const rejectionReasons = [...assemblyRejectionReasons(original, candidate), ...orderQualityRejections(before, quality)];
  const improved = orderQualityImproved(before, quality);
  const selected = improved && !rejectionReasons.length;
  attempts.push({policy:'nearby-foundations', selected, improved, rejectionReasons, quality});
  if (selected) plan = candidate;
  const compacted = compactAssemblyPlan(plan);
  const preparationMs = performance.now() - started;
  return {
    ...result,
    assemblyPlan: plan,
    instructionPlan: compacted.plan,
    guide: createGuideSections(compacted.plan),
    assemblyEvaluation: {
      version:1,
      before,
      after:assessAssemblyQuality(plan),
      attempts,
      compaction:compacted.report,
      preparationMs,
      geometryChanges:0,
      colorChanges:0,
      scope:'Ordering and diagram consolidation only. Physical source operations and unresolved failures are preserved separately; compact diagrams are not simultaneous placement instructions or a strength certificate.',
    },
    metrics:{...result.metrics,
      conversionMs:result.metrics.conversionMs + preparationMs,
      stageTiming:{...result.metrics.stageTiming,guidePreparationMs:(result.metrics.stageTiming?.guidePreparationMs ?? 0)+preparationMs}},
  };
}
