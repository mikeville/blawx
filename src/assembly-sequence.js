import { createAssemblyPlan } from './assembly.js';

function unresolvedIds(plan) {
  return new Set(plan.steps.filter(step => step.kind === 'unresolved').flatMap(step =>
    step.newBrickIds.length ? step.newBrickIds : step.highlightBrickIds));
}

// This stage changes assembly order only. Construction's repair guard still uses
// its original downward-insertion plan, so trying a new sequence cannot repack.
export function sequenceAssembly({ brickModel, baselinePlan = null }) {
  const started = performance.now();
  const baseline = baselinePlan ?? createAssemblyPlan({ brickModel });
  const candidate = createAssemblyPlan({ brickModel, allowUnderAttachments: true });
  const originalUnresolved = unresolvedIds(baseline);
  const rejectionReasons = [];
  for (const metric of ['rootFailureCount', 'unresolvedBrickCount', 'blockedJoinCount', 'temporaryHoldStepCount']) {
    if (candidate.stats[metric] > baseline.stats[metric]) rejectionReasons.push(`${metric} increased`);
  }
  if (!candidate.stats.coverageComplete) rejectionReasons.push('Incomplete placement coverage');
  if ([...unresolvedIds(candidate)].some(id => !originalUnresolved.has(id))) rejectionReasons.push('A previously resolved brick became unresolved');
  const improved = candidate.stats.rootFailureCount < baseline.stats.rootFailureCount
    || candidate.stats.unresolvedBrickCount < baseline.stats.unresolvedBrickCount;
  const selected = improved && rejectionReasons.length === 0;
  return {
    plan: selected ? candidate : baseline,
    comparison: {
      selectedPolicy: selected ? 'bounded-under-attachments' : 'downward-only',
      baseline: baseline.stats,
      candidate: candidate.stats,
      upwardStepCount: selected ? candidate.steps.filter(step => step.insertionDirection === 'up').length : 0,
      rejectionReasons,
      improved,
      sequencingMs: performance.now() - started,
      scope: 'Assembly order only; packing repair feedback retains the downward-only baseline. Swept body clearance and stud engagement do not verify hand access, clutch strength or stability.',
    },
  };
}
