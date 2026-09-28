import {recipeWorkingFrame} from './recipe-working-frame.js';
import {recipeBrickId} from './assembly-recipes.js';

// These are grouping proposals, not validity receipts. The diagram planner
// checks the current operations, working scope, geometry and visibility again.
export function recipeDiagramGroups(plan) {
  if (!plan.moduleRecipes) return [];
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const groups = [];
  function visit(recipe, members, floor, parentId, depth) {
    if (!recipe || depth >= 3) return;
    const frame = recipeWorkingFrame(recipe,members.map(id=>byId.get(id)),floor);
    const localIds = new Map(members.map(id => [recipeBrickId(frame.toLocal(byId.get(id))), id]));
    for (const group of recipe.diagramGroups ?? []) {
      if (!Array.isArray(group) || group.length < 2 || new Set(group).size !== group.length) continue;
      const ids = group.map(id => localIds.get(id));
      const feature=(recipe.featureDiagramGroups??[]).some(task=>Array.isArray(task)
        &&task.length===group.length&&task.every(id=>group.includes(id)));
      if (ids.every(Boolean)) groups.push({moduleId:parentId, brickIds:ids,...(feature?{kind:'supported-feature'}:{}),...(recipe.allowMixedMaterialCourses?{allowMixedMaterials:true}:{})});
    }
    for (const child of recipe.moduleReplay ?? []) {
      const ids = child.brickIds.map(id => localIds.get(id));
      if (ids.every(Boolean)) visit(recipe.moduleRecipes?.[child.id], ids,
        floor+(child.buildContext?.floorY ?? 0), parentId, depth+1);
    }
  }
  for (const [id, recipe] of Object.entries(plan.moduleRecipes)) {
    const module = plan.modules.find(module => module.id === id);
    if (module?.buildContext?.kind === 'work-surface') visit(recipe, module.brickIds, module.buildContext.floorY, id, 0);
  }
  return groups;
}
