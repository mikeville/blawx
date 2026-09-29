import {createAssemblyPlan} from './assembly.js';
import {MAX_ASSEMBLY_RECIPE_BRICKS} from './assembly-recipe-limits.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {unresolvedCells} from './refine-construction.js';
import {recipeReplay,refineCaptureRecipes,restrictRecipe} from './capture-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {refineNestedAssemblyTasks} from './supported-instruction-runs.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';

function components(ids, adjacency) {
  const pending = new Set(ids),groups = [];
  while (pending.size) {
    const group = new Set([pending.values().next().value]);
    for (const id of group) {
      pending.delete(id);
      for (const next of adjacency.get(id)) if (pending.has(next)) group.add(next);
    }
    groups.push([...group]);
  }
  return groups;
}

export function discoverNestedAssemblies(plan) {
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const adjacency = new Map(plan.bricks.map(b => [b.id,new Set()]));
  for (const {a,b} of plan.graph.edges) { adjacency.get(a).add(b);adjacency.get(b).add(a); }
  const roots = new Set(plan.steps.flatMap(s => s.issues.filter(i => i.code === 'unsupported-addition').map(i => i.brickIds[0])));
  const proposals = [];
  for (const module of plan.modules.filter(m => m.kind === 'grounded' && !m.buildContext)) {
    const floors = [...new Set(module.brickIds.filter(id => roots.has(id)).map(id => byId.get(id).y))].filter(y => y > 0);
    for (const floor of floors) for (const ids of components(module.brickIds.filter(id => byId.get(id).y >= floor),adjacency)) {
      const rootCount = ids.filter(id => roots.has(id)).length;
      if (!rootCount || ids.length < 8 || ids.length > MAX_ASSEMBLY_RECIPE_BRICKS) continue;
      const bs = ids.map(id => byId.get(id));
      if (Math.max(...bs.map(b => b.y))-floor < 2
        || Math.max(...bs.map(b => b.x+b.w))-Math.min(...bs.map(b => b.x)) > 32
        || Math.max(...bs.map(b => b.z+b.d))-Math.min(...bs.map(b => b.z)) > 32) continue;
      const selected = new Set(ids),rest = module.brickIds.filter(id => !selected.has(id));
      if (rest.length) proposals.push({module,floor,ids,rest,rootCount});
    }
  }
  return proposals.sort((a,b) => b.rootCount-a.rootCount || a.floor-b.floor || a.module.id.localeCompare(b.module.id));
}

// Compete small flat captures with complete parent recipes. Each nested recipe
// is discovered locally, then reconstructed and joined in the actual global
// scene. No failed internal operation is excused by a lower global error count.
export function planNestedAssemblies(before,{prepareCandidate=null,preservePlacements=false,discoverNestedRecipe=null,allowUnderAttachments=true}={}) {
  const original = before.assemblyPlan;
  if (!original || before.assemblyError || !original.stats.rootFailureCount
    || original.bricks.length > 800) return before;
  const attempts = [],candidates = [],oldBad = unresolvedCells(original);
  const flat = refineCaptureRecipes(before.brickModel,original,{preservePlacements,allowUnderAttachments});
  if (flat.accepted.length) candidates.push({plan:flat.plan,replay:flat.replay,kind:'flat-captures',captures:flat.accepted});
  const replay = recipeReplay(original,{preservePlacements}),byId = new Map(original.bricks.map(b => [b.id,b]));
  const strategies=discoverNestedRecipe?[false,true,'complete']:[false,true];
  for (const {module,floor,ids,rest} of discoverNestedAssemblies(original).slice(0,8)) for (const strategy of strategies) {
    const groupUnderAttachments=strategy!==false;
    try {
      let recipe,captures=[];
      if(strategy==='complete'){
        // The caller owns the bounded deeper search. Local discovery does not
        // receive this callback, so it cannot recursively re-enter itself.
        recipe=discoverNestedRecipe(ids.map(id=>byId.get(id)));
      }else{
        const brickModel = {version:1,kind:'bricks',bricks:ids.map(id => {
          const {id:_,...b} = byId.get(id);return {...b,y:b.y-floor};
        })};
        const seed = createAssemblyPlan({brickModel,integratedBuild:true,allowUnderAttachments,groupUnderAttachments,
          preferLocalProgress:true,preferLocalFoundations:true});
        const local = refineCaptureRecipes(brickModel,seed,{groupUnderAttachments,allowUnderAttachments});
        if (local.plan.stats.unresolvedBrickCount) {
          attempts.push({moduleId:module.id,floor,parts:ids.length,strategy,groupUnderAttachments,localUnresolved:local.plan.stats.unresolvedBrickCount,rejectionReasons:['Incomplete internal recipe']});
          continue;
        }
        recipe={moduleReplay:recipeReplay(local.plan),groupUnderAttachments};
        captures=local.accepted;
      }
      const id = `${module.id}-nested-${floor}`;
      const next = replay.flatMap(m => m.id !== module.id ? [m] : [
        restrictRecipe(m,rest),
        {id,label:'Separate section',kind:'detail',groupType:'work-surface',brickIds:ids,brickOrder:ids,
          buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first'}},
      ]);
      const plan = createAssemblyPlan({brickModel:before.brickModel,moduleReplay:next,moduleRecipes:{...original.moduleRecipes,[id]:recipe},
        integratedBuild:original.integratedBuild ?? false,allowUnderAttachments,allowWorkSurfaceUnderAttachments:allowUnderAttachments,
        preferLocalProgress:true,preferLocalFoundations:true});
      const bad = unresolvedCells(plan),parent = plan.steps.filter(s => s.moduleId === id),reasons = [];
      if (bad.size >= oldBad.size || [...bad].some(cell => !oldBad.has(cell))) reasons.push('Must remove failures without adding unresolved cells');
      if (!parent.some(s => s.kind === 'join' && !s.nestedRecipe)
        || parent.some(s => s.issues.some(i => i.severity === 'error'))) reasons.push('Incomplete parent recipe or real attachment');
      attempts.push({moduleId:module.id,floor,parts:ids.length,strategy,groupUnderAttachments,localUnresolved:0,unresolved:plan.stats.unresolvedBrickCount,rejectionReasons:reasons});
      if (!reasons.length) candidates.push({plan,replay:next,kind:'nested-component',moduleId:id,floor,parts:ids.length,strategy,groupUnderAttachments,captures});
    } catch (error) { attempts.push({moduleId:module.id,floor,parts:ids.length,strategy,groupUnderAttachments,rejectionReasons:[error.message]}); }
  }
  const prepare=candidate=>refineNestedAssemblyTasks(retainUnchangedDiagrams(before,
    prepareAssemblyGuide({...before,assemblyPlan:candidate.plan},{moduleReplay:candidate.replay})));
  const evaluated=prepareCandidate?candidates.flatMap(candidate=>{
    try{
      const result=prepareCandidate(before,prepare(candidate));
      return [{...candidate,plan:result.assemblyPlan,result,diagrams:createBookletPresentation(result).numbering.diagramCount}];
    }catch(error){attempts.push({moduleId:candidate.moduleId,kind:candidate.kind,rejectionReasons:[error.message]});return [];}
  }):candidates;
  evaluated.sort((a,b) => unresolvedCells(a.plan).size-unresolvedCells(b.plan).size || (a.diagrams??a.plan.steps.length)-(b.diagrams??b.plan.steps.length));
  const winner = evaluated[0];
  const result = winner ? winner.result??prepare(winner) : before;
  return {...result,nestedAssemblyPlanning:{selected:!!winner,flatAttempts:flat.attempts,attempts,
    ...(winner ? {kind:winner.kind,moduleId:winner.moduleId,floor:winner.floor,parts:winner.parts,strategy:winner.strategy,groupUnderAttachments:winner.groupUnderAttachments,captures:winner.captures,
      beforeUnresolved:original.stats.unresolvedBrickCount,afterUnresolved:result.assemblyPlan.stats.unresolvedBrickCount} : {})}};
}
