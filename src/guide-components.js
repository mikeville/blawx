// Logical ownership is established by construction planning. Never infer it from
// labels or nearby steps: a component can contain several physical assemblies.
export function guideComponents(plan) {
  const modules = new Map((plan.modules ?? []).map(m => [m.id, m]));
  const candidates = new Map();
  for (const module of modules.values()) {
    const component = module.componentRecipe;
    if (typeof component?.id === 'string') candidates.set(component.id, component);
  }
  const sameIds = (a, b) => Array.isArray(a) && Array.isArray(b)
    && a.length === b.length && new Set(a).size === a.length
    && a.every(id => b.includes(id));
  const result = [];
  for (const component of candidates.values()) {
    const {id, moduleIds, brickIds, receiverModuleId} = component;
    if (!Array.isArray(moduleIds) || !Array.isArray(brickIds) || !moduleIds.length || !brickIds.length || !modules.has(receiverModuleId)
      || moduleIds.includes(receiverModuleId) || new Set(moduleIds).size !== moduleIds.length) continue;
    const owned = moduleIds.map(id => modules.get(id));
    if (owned.some(m => !m || m.componentRecipe?.id !== id
      || m.componentRecipe.receiverModuleId !== receiverModuleId
      || !sameIds(m.componentRecipe.moduleIds, moduleIds)
      || !sameIds(m.componentRecipe.brickIds, brickIds))) continue;
    if (!sameIds(owned.flatMap(m => m.brickIds), brickIds)) continue;
    if ([...modules.values()].some(m => !moduleIds.includes(m.id)
      && (m.componentRecipe?.id === id || m.brickIds.some(b => brickIds.includes(b))))) continue;
    const indexes = plan.steps.flatMap((s, i) => moduleIds.includes(s.moduleId) ? [i] : []);
    if (!indexes.length || indexes.at(-1) - indexes[0] + 1 !== indexes.length) continue;
    const steps = plan.steps.slice(indexes[0], indexes.at(-1) + 1);
    if (!sameIds(steps.flatMap(s => s.newBrickIds), brickIds)) continue;
    const attachment = plan.steps.find((s, i) => i > indexes.at(-1) && s.moduleId === receiverModuleId
      && s.kind === 'join' && !s.nestedRecipe && !s.issues?.length
      && s.joinContext?.supportGroups?.some(g => g.brickIds?.some(b => brickIds.includes(b))));
    if (!attachment) continue;
    result.push({...component, steps, attachment});
  }
  return result;
}
