import {recipeWorkingFrame} from './recipe-working-frame.js';
import {MAX_ASSEMBLY_RECIPE_BRICKS} from './assembly-recipe-limits.js';

const signature = b => `${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;

function connected(ids, adjacency) {
  if (!ids.size) return false;
  const visited = new Set([ids.values().next().value]);
  for (const id of visited) for (const next of adjacency.get(id)) {
    if (ids.has(next)) visited.add(next);
  }
  return visited.size === ids.size;
}

// Rebuild the supplied child recipe in table coordinates. A caller supplies
// ownership/order, never a trusted "valid" flag or a precomputed join result.
export function createNestedModuleBuild({module, recipe, bricks, createAssemblyPlan,
  nextStepId, reserveStep, allowUnderAttachments, allowWorkSurfaceUnderAttachments, nestedRecipeDepth = 0}) {
  // An independent foundation may finish its connected table core before adding
  // feet underneath. The explicit recipe still proves every operation locally.
  const foundation = recipe?.kind === 'foundation' && module.kind === 'grounded' && !module.buildContext
    && module.indexes.some(i => bricks[i].y === 0);
  if ((recipe?.kind === 'foundation' && !foundation)
    || (!foundation && module.buildContext?.kind !== 'work-surface') || module.brickIds.length > MAX_ASSEMBLY_RECIPE_BRICKS
    || !recipe || !Array.isArray(recipe.moduleReplay)) {
    throw new RangeError('A nested recipe requires a bounded work-surface parent and child module replay.');
  }
  if (nestedRecipeDepth >= 3) throw new RangeError('Nested recipes exceed the three-level construction limit.');
  if(recipe.allowUnderAttachments!==undefined&&typeof recipe.allowUnderAttachments!=='boolean'){
    throw new TypeError('Recipe allowUnderAttachments must be a boolean.');
  }
  const floor = foundation ? 0 : module.buildContext.floorY;
  const parentBricks = module.indexes.map(i => bricks[i]);
  const frame = recipeWorkingFrame(recipe,parentBricks,floor);
  // A turn-over is one bounded, connected core, not a new license to rotate
  // arbitrary child joins or lift loose layouts.
  if(frame.inverted && (recipe.moduleReplay.length !== 1 || recipe.moduleReplay[0].kind !== 'grounded'
    || Object.keys(recipe.moduleRecipes ?? {}).length)) {
    throw new RangeError('An inverted recipe requires one grounded core without child recipes.');
  }
  const brickModel = {version:1, kind:'bricks', bricks:parentBricks.map(({id,...b})=>frame.toLocal(b))};
  const local = createAssemblyPlan({brickModel, moduleReplay:recipe.moduleReplay,
    moduleRecipes:recipe.moduleRecipes ?? null, nestedRecipeDepth:nestedRecipeDepth+1,
    integratedBuild:true, preferLocalProgress:true, preferLocalFoundations:true,
    allowUnderAttachments:allowUnderAttachments && recipe.allowUnderAttachments !== false,
    allowWorkSurfaceUnderAttachments:recipe.allowUnderAttachments === false ? false : allowWorkSurfaceUnderAttachments,
    groupUnderAttachments:recipe.groupUnderAttachments ?? false});
  if (!local.stats.coverageComplete || local.stats.unresolvedBrickCount
    || local.modules.some(m => m.kind !== 'grounded' && !m.buildContext)
    || local.steps.some(s => s.issues.some(i => i.severity === 'error'))) {
    throw new RangeError('The nested recipe has unresolved internal operations or attachments.');
  }
  if(frame.inverted && local.graph.components.length !== 1)throw new RangeError('An inverted core must be connected before turning over.');
  if(foundation && local.graph.components.length !== 1)throw new RangeError('A completed foundation recipe must be connected.');
  const adjacency = new Map(local.bricks.map(b => [b.id,new Set()]));
  for (const {a,b} of local.graph.edges) { adjacency.get(a).add(b); adjacency.get(b).add(a); }
  for (const step of local.steps.filter(s => s.insertionDirection === 'up' && s.workingOrientation?.kind !== 'inverted')) {
    const before = new Set(step.visibleBrickIds.filter(id => !step.newBrickIds.includes(id)));
    if (!connected(before,adjacency)) throw new RangeError('A loose nested layout cannot be lifted for an underside attachment.');
  }
  const globalByGeometry = new Map(parentBricks.map(b => [signature(b),b.id]));
  const mapped = new Map(local.bricks.map(b => [b.id,globalByGeometry.get(signature(frame.fromLocal(b)))]));
  if ([...mapped.values()].some(id => !id) || new Set(mapped.values()).size !== parentBricks.length) {
    throw new RangeError('The nested recipe must cover its parent geometry exactly.');
  }
  const mapIds = ids => ids.map(id => mapped.get(id));
  const stepIds = new Map(local.steps.map(s => [s.id,`step-${nextStepId()}`]));
  const childModules = new Map(local.modules.map(m => [m.id,m]));
  const steps = local.steps.map(step => {
    const child = childModules.get(step.moduleId);
    const members = local.steps.filter(s => s.moduleId === child.id);
    const attachment = members.find(s => s.kind === 'join' && !s.nestedRecipe);
    const joinContext = step.joinContext && {...step.joinContext,supportFloorY:floor+(step.joinContext.supportFloorY ?? 0),
      supportGroups:step.joinContext.supportGroups.map(group => ({...group,brickIds:mapIds(group.brickIds),
        contacts:group.contacts.map(c => ({...c,supportBrickId:mapped.get(c.supportBrickId),bandBrickId:mapped.get(c.bandBrickId)}))}))};
    const parentScope={id:`${module.id}/${child.id}`,parentModuleId:module.id,
      separate:child.kind !== 'grounded',firstStepId:stepIds.get(members[0].id),
      ...(attachment ? {attachmentStepId:stepIds.get(attachment.id)} : {}),
      floorY:(child.buildContext?.floorY ?? 0)+floor};
    const mapScope=scope=>({...scope,id:`${module.id}/${scope.id}`,parentModuleId:module.id,
      firstStepId:stepIds.get(scope.firstStepId),
      ...(scope.attachmentStepId ? {attachmentStepId:stepIds.get(scope.attachmentStepId)} : {}),
      floorY:scope.floorY+floor});
    const nestedPath=step.nestedRecipe ? [parentScope,...(step.nestedRecipePath ?? [step.nestedRecipe]).map(mapScope)] : null;
    if(frame.inverted && (step.kind !== 'build' || step.nestedRecipe || step.joinContext)) {
      throw new RangeError('An inverted core cannot contain child attachments.');
    }
    const orientation = frame.inverted ? {kind:'inverted',surfaceY:frame.surfaceY}
      : step.workingOrientation ? {...step.workingOrientation,surfaceY:step.workingOrientation.surfaceY+floor} : null;
    const result = {...step,
      ...(frame.inverted ? {insertionDirection:step.insertionDirection === 'up' ? 'down' : 'up'} : {}),
      ...(orientation ? {workingOrientation:orientation} : {}),id:stepIds.get(step.id),moduleId:module.id,
      newBrickIds:mapIds(step.newBrickIds),highlightBrickIds:mapIds(step.highlightBrickIds),visibleBrickIds:mapIds(step.visibleBrickIds),
      issues:step.issues.map(i => ({...i,brickIds:mapIds(i.brickIds)})),
      nestedRecipe:nestedPath?.at(-1) ?? parentScope,
      ...(nestedPath ? {nestedRecipePath:nestedPath} : {}),
      ...(joinContext ? {joinContext} : {})};
    reserveStep(result);
    return result;
  });
  return {steps,unresolved:false,validIndexes:new Set(module.indexes)};
}
