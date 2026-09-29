import {createAssemblyPlan} from './assembly.js';
import {unresolvedCells} from './refine-construction.js';

export function recipeReplay(plan,{preservePlacements=false}={}) {
  return plan.modules.map(module => {
    const steps=plan.steps.filter(s=>s.moduleId===module.id);
    const groups = steps.filter(s => s.newBrickIds.length).map(s => [...s.newBrickIds]);
    const preserve=preservePlacements&&steps.every(s=>!s.issues.length&&!s.nestedRecipe);
    return {id:module.id,label:module.label,kind:module.kind,
      groupType:module.groupType,brickIds:[...module.brickIds],brickOrder:groups.flat(),
      ...(module.actionOrder||preserve ? {actionOrder:true,placementGroups:groups} : {}),
      ...(module.buildContext ? {buildContext:{...module.buildContext}} : {})};
  });
}

export function restrictRecipe(module, brickIds) {
  const selected = new Set(brickIds);
  return {...module,brickIds:[...brickIds],brickOrder:module.brickOrder.filter(id => selected.has(id)),
    ...(module.placementGroups ? {placementGroups:module.placementGroups
      .map(group => group.filter(id => selected.has(id))).filter(group => group.length)} : {})};
}

// Capture an unsupported lower piece with a directly adjoining upper brick.
// Shared lower roots belong to the same small recipe. The receiver consists of
// validated work, rather than a height cut that could strand underside pieces.
export function discoverCaptureRecipes(plan) {
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const owners = new Map(plan.modules.flatMap(m => m.brickIds.map(id => [id,m])));
  const roots = new Set(plan.steps.flatMap(s => s.issues.filter(i => i.code === 'unsupported-addition').map(i => i.brickIds[0])));
  const failed = new Set(plan.steps.filter(s => s.kind === 'unresolved').flatMap(s => s.newBrickIds));
  const lower = new Map(plan.bricks.map(b => [b.id,[]]));
  for (const {a,b} of plan.graph.edges) {
    const lo = byId.get(a).y < byId.get(b).y ? a : b, hi = lo === a ? b : a;
    lower.get(hi).push(lo);
  }
  const proposals = [];
  for (const [cap,below] of lower) {
    const captured = below.filter(id => roots.has(id));
    if (!captured.length || captured.length > 7) continue;
    const owner = owners.get(cap),floor = byId.get(captured[0]).y;
    if (!floor || owner.kind !== 'grounded' || owner.buildContext
      || captured.some(id => owners.get(id) !== owner)) continue;
    const ids = [cap,...captured],selected = new Set(ids);
    const prefix = owner.brickIds.filter(id => !selected.has(id) && !failed.has(id));
    const rest = owner.brickIds.filter(id => !selected.has(id) && failed.has(id));
    // A continuation can use a completed earlier receiver without adding a
    // fresh prefix. The full replay remains responsible for proving that join.
    if (!prefix.length && plan.modules.indexOf(owner) === 0) continue;
    proposals.push({owner,cap,floor,ids,prefix,rest});
  }
  return proposals.sort((a,b) => a.floor-b.floor || b.ids.length-a.ids.length || a.cap.localeCompare(b.cap));
}

export function refineCaptureRecipes(brickModel, original, {maxChecks=32,maxRounds=4,groupUnderAttachments=false,preservePlacements=false,allowUnderAttachments=true}={}) {
  let plan = original,replay = recipeReplay(original,{preservePlacements}),checks = 0;
  const attempts = [],accepted = [];
  if (original.bricks.length > 800) return {plan,replay,attempts,accepted};
  for (let round=0;round<maxRounds && checks<maxChecks;round++) {
    const previous = unresolvedCells(plan),candidates = [];
    for (const proposal of discoverCaptureRecipes(plan)) {
      if (checks >= maxChecks) break;
      checks++;
      const {owner,cap,floor,ids,prefix,rest} = proposal;
      const originalModule = replay.find(m => m.id === owner.id);
      const id = `${owner.id}-capture-${round}-${cap}`;
      const next = replay.flatMap(m => m.id !== owner.id ? [m] : [
        ...(prefix.length ? [restrictRecipe(originalModule,prefix)] : []),
        {id,label:'Small assembly',kind:'detail',groupType:'work-surface',brickIds:ids,brickOrder:ids,
          buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first'}},
        ...(rest.length ? [{...restrictRecipe(originalModule,rest),actionOrder:false,placementGroups:undefined,
          id:`${owner.id}-continue`,groupType:'continuation'}] : []),
      ]);
      try {
        const candidate = createAssemblyPlan({brickModel,moduleReplay:next,moduleRecipes:plan.moduleRecipes,integratedBuild:plan.integratedBuild ?? false,
          allowUnderAttachments,allowWorkSurfaceUnderAttachments:allowUnderAttachments,groupUnderAttachments,preferLocalProgress:true,preferLocalFoundations:true});
        const unresolved = unresolvedCells(candidate),recipe = candidate.steps.filter(s => s.moduleId === id);
        const reasons = [];
        if (!recipe.some(s => s.kind === 'join') || recipe.some(s => s.issues.some(i => i.severity === 'error'))) reasons.push('Incomplete capture recipe or attachment');
        if (unresolved.size >= previous.size || [...unresolved].some(cell => !previous.has(cell))) reasons.push('Must remove failures without adding unresolved cells');
        attempts.push({round,parts:ids.length,floor,rejectionReasons:reasons});
        if (!reasons.length) candidates.push({plan:candidate,replay:next,id,parts:ids.length,floor});
      } catch (error) { attempts.push({round,parts:ids.length,floor,rejectionReasons:[error.message]}); }
    }
    candidates.sort((a,b) => unresolvedCells(a.plan).size-unresolvedCells(b.plan).size || a.parts-b.parts);
    if (!candidates.length) break;
    const winner = candidates[0];plan = winner.plan;replay = winner.replay;
    accepted.push({moduleId:winner.id,parts:winner.parts,floor:winner.floor});
  }
  return {plan,replay,attempts,accepted};
}
