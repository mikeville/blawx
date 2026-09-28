// A whole assembly must enter before another assembly closes its downward
// insertion corridor. Stud supports are a subset of the same lower-before-upper
// constraints. Keep established order wherever those constraints allow it.
export function orderAssemblyDependencies(groups, above) {
  const owner = new Map(groups.flatMap((group, index) => group.indexes.map(brick => [brick, index])));
  const predecessors = groups.map(() => new Set());
  groups.forEach((group, lowerGroup) => {
    if (group.kind === 'floating') return;
    for (const lower of group.indexes) for (const upper of above[lower]) {
      const upperGroup = owner.get(upper);
      if (upperGroup !== lowerGroup && groups[upperGroup].kind !== 'floating') {
        predecessors[upperGroup].add(lowerGroup);
      }
    }
  });
  const remaining = new Set(groups.map((_, index) => index));
  const ordered = [];
  while (remaining.size) {
    const next = [...remaining].find(index => [...predecessors[index]].every(prior => !remaining.has(prior)));
    // Interleaving geometry needs a different assembly partition. Never hide a
    // dependency cycle by discarding one of its edges or part of the model.
    if (next === undefined) return groups;
    ordered.push(groups[next]);
    remaining.delete(next);
  }
  // Continuations use the joined work-surface scene. Preserve that contract;
  // a partition needing intervening assemblies requires explicit replanning.
  if (ordered.some((group, index) => group.groupType === 'continuation'
    && ordered[index - 1]?.groupType !== 'work-surface')) return groups;
  return ordered;
}
