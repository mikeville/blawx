// Quality measurements stay separate from construction validity. Fewer pictures
// or less backtracking cannot turn an unsupported placement into a valid one.
export function assessAssemblyQuality(plan) {
  const bricks = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const progress = new Map();
  const lateFoundations = [];
  const downwardReturns = [];
  const issues = new Map();
  for (const step of plan.steps) {
    for (const issue of step.issues) {
      const entry = issues.get(issue.code) ?? { code: issue.code, occurrences: 0, brickIds: new Set(), stepIds: new Set() };
      entry.occurrences++;
      for (const id of issue.brickIds) entry.brickIds.add(id);
      entry.stepIds.add(step.id);
      issues.set(issue.code, entry);
    }
    // Independent modules start their own local build; they are not backtracking
    // through a previously built object. Joins/failures are evaluated separately.
    if (step.kind !== 'build' || !step.newBrickIds.length) continue;
    const additions = step.newBrickIds.map(id => bricks.get(id));
    const low = Math.min(...additions.map(brick => brick.y));
    const high = Math.max(...additions.map(brick => brick.y));
    const prior = progress.get(step.moduleId);
    if (prior) {
      if (low === 0 && prior.highest >= 2) {
        lateFoundations.push({ stepId: step.id, moduleId: step.moduleId, brickIds: step.newBrickIds, afterCourse: prior.highest });
      }
      if (prior.lastLow - low >= 2) {
        downwardReturns.push({ stepId: step.id, moduleId: step.moduleId, fromCourse: prior.lastLow, toCourse: low, drop: prior.lastLow - low });
      }
    }
    progress.set(step.moduleId, { highest: Math.max(prior?.highest ?? 0, high), lastLow: low });
  }
  return {
    sourceStepCount: plan.steps.length,
    unresolvedBrickCount: plan.stats.unresolvedBrickCount,
    rootFailureCount: plan.stats.rootFailureCount,
    blockedJoinCount: plan.stats.blockedJoinCount,
    lateFoundationCount: lateFoundations.length,
    downwardReturnCount: downwardReturns.length,
    downwardCourseDistance: downwardReturns.reduce((sum, entry) => sum + entry.drop, 0),
    lateFoundations,
    downwardReturns,
    failureKinds: [...issues.values()].map(entry => ({ ...entry, brickIds: [...entry.brickIds], stepIds: [...entry.stepIds] })),
  };
}

export function orderQualityRejections(before, after) {
  const reasons = [];
  for (const key of ['lateFoundationCount', 'downwardReturnCount', 'downwardCourseDistance']) {
    if (after[key] > before[key]) reasons.push(`${key} increased`);
  }
  return reasons;
}

export function orderQualityImproved(before, after) {
  return ['rootFailureCount', 'unresolvedBrickCount', 'lateFoundationCount', 'downwardReturnCount', 'downwardCourseDistance']
    .some(key => after[key] < before[key]);
}
