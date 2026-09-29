/** Candidate working boundaries follow completed, connected courses. */
export function foundationRecipeVariants(plan, proposal) {
  const original = proposal.recipe.moduleReplay[0];
  const by = new Map(plan.bricks.map(b => [b.id, b]));
  const adjacency = new Map(original.brickIds.map(id => [id, new Set()]));
  for (const {a, b} of plan.graph.edges) if (adjacency.has(a) && adjacency.has(b)) {
    adjacency.get(a).add(b); adjacency.get(b).add(a);
  }
  const connected = ids => {
    const selected = new Set(ids), queue = ids.slice(0, 1), seen = new Set(queue);
    for (const id of queue) for (const other of adjacency.get(id)) {
      if (selected.has(other) && !seen.has(other)) {seen.add(other); queue.push(other);}
    }
    return seen.size === selected.size;
  };
  const operations = plan.steps.filter(s => s.moduleId === proposal.moduleId && s.newBrickIds.length);
  const courses = [...new Set(original.brickIds.map(id => by.get(id).y))].sort((a, b) => a - b);
  const floor = original.buildContext.floorY;
  const cut = courses.find(y => y > floor && connected(original.brickIds.filter(id => by.get(id).y <= y)));
  if (cut === undefined) return [proposal];
  const lower = original.brickIds.filter(id => by.get(id).y <= cut), selected = new Set(lower);
  const higher = original.brickIds.filter(id => !selected.has(id));
  const groups = operations.map(s => ({direction: s.insertionDirection ?? 'down',
    ids: s.newBrickIds.filter(id => selected.has(id))})).filter(g => g.ids.length);
  const variants = [];
  // These are proposals, not a license to reorder: complete physical replay
  // must prove every support, lift and insertion before either is adopted.
  for (const deferred of [true, false]) {
    const upper = groups.filter(g => g.direction !== 'up').map(g => g.ids);
    const under = groups.filter(g => g.direction === 'up').flatMap(g => g.ids);
    if (deferred && (!under.length || under.length > 12 || new Set(under.map(id => by.get(id).y)).size !== 1)) continue;
    const placementGroups = deferred ? [...upper, under] : groups.map(g => g.ids);
    if (!higher.length && !deferred) continue;
    const recipe = structuredClone(proposal.recipe);
    recipe.moduleReplay[0] = {...recipe.moduleReplay[0], brickIds: lower,
      brickOrder: placementGroups.flat(), placementGroups, actionOrder: true};
    if (higher.length) {
      const tail = operations.map(s => s.newBrickIds.filter(id => !selected.has(id))).filter(g => g.length);
      recipe.moduleReplay.push({id: 'upper', label: 'Upper structure', kind: 'grounded',
        groupType: 'supported-additions', brickIds: higher, brickOrder: tail.flat(),
        placementGroups: tail, actionOrder: true});
    }
    variants.push({...proposal, recipe});
  }
  return [...variants, proposal];
}
