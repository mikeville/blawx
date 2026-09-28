import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {unresolvedCells} from './refine-construction.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';

// A connected unresolved region may be a complete hanging component. Its
// receiving assembly must exist before the component can attach from below.
export function planUndersideAssemblies(before,{prepareCandidate=null,preservePlacements=false,discoverRecipe=null,allowUnderAttachments=true}={}) {
  const original=before.assemblyPlan;
  if(!original||before.assemblyError||!original.stats.unresolvedBrickCount)return before;
  const byId=new Map(original.bricks.map(b=>[b.id,b]));
  const owners=new Map(original.modules.flatMap((m,index)=>m.brickIds.map(id=>[id,index])));
  const adjacency=new Map(original.bricks.map(b=>[b.id,new Set()]));
  for(const {a,b}of original.graph.edges){adjacency.get(a).add(b);adjacency.get(b).add(a);}
  const failed=new Set(original.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds));
  const movableOwners=new Set(original.modules.flatMap((m,index)=>m.kind==='grounded'&&!m.buildContext
    &&!['recipeFamily','sharedHandledRecipe','repeatContinuation','componentRecipe','mirroredAssembly'].some(key=>m[key])?[index]:[]));
  const replay=recipeReplay(original,{preservePlacements});
  const oldBad=unresolvedCells(original),proposals=[],fallbacks=[],seen=new Set();
  for(const [ownerIndex,module]of original.modules.entries()){
    if(module.kind!=='grounded'||module.buildContext||discoverRecipe&&!movableOwners.has(ownerIndex))continue;
    const pending=new Set(module.brickIds.filter(id=>failed.has(id)));
    while(pending.size){
      const ids=new Set([pending.values().next().value]);
      for(const id of ids){pending.delete(id);for(const next of adjacency.get(id))if(pending.has(next))ids.add(next);}
      const originalIds=new Set(ids);
      // Earlier cuts can leave a hanging piece's dependent details in another
      // grounded continuation. Discover the complete failed component across
      // those boundaries instead of moving its support away on its own.
      if(discoverRecipe&&movableOwners.has(ownerIndex))for(const id of ids){
        for(const next of adjacency.get(id))if(failed.has(next)&&movableOwners.has(owners.get(next)))ids.add(next);
      }
      const variants=ids.size===originalIds.size?[ids]:[ids,originalIds];
      for(const [variant,parts]of variants.entries()){
        if(parts.size<(discoverRecipe?1:2)||parts.size>64)continue;
        const key=[...parts].sort().join('|');
        if(seen.has(key))continue;seen.add(key);
        const floor=Math.min(...[...parts].map(id=>byId.get(id).y));
        if(floor<=0)continue;
        const receiving=new Set();
        for(const id of parts)for(const next of adjacency.get(id)){
          if(!parts.has(next)&&byId.get(next).y>byId.get(id).y)receiving.add(owners.get(next));
        }
        if(!receiving.size)continue;
        (variant?fallbacks:proposals).push({module,ownerIndex,ids:parts,floor,after:Math.max(...receiving)});
      }
    }
  }
  const attempts=[],candidates=[];
  // Keep the original bounded alternatives when an expanded component cannot
  // be built or attached. Expansion must not suppress an existing valid repair.
  for(const [ordinal,{module,ids,floor,after}]of [...proposals.slice(0,8),...fallbacks.slice(0,8)].entries()){
    let suffix=ordinal+1;
    while(original.modules.some(m=>m.id===`${module.id}-underside-${suffix}`))suffix++;
    const id=`${module.id}-underside-${suffix}`;
    const descriptor={id,label:'Separate underside assembly',kind:'detail',groupType:'work-surface',
      brickIds:[...ids],brickOrder:[...ids],buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first',joinDirection:'up'}};
    const next=replay.flatMap((m,index)=>{
      const rest=m.brickIds.filter(id=>!ids.has(id));
      return [...(rest.length?[rest.length!==m.brickIds.length?restrictRecipe(m,rest):m]:[]),...(index===after?[descriptor]:[])];
    });
    try{
      const recipe=discoverRecipe?.([...ids].map(id=>byId.get(id)));
      const recipes=discoverRecipe?{...replayNestedRecipes(original),[id]:recipe}:original.moduleRecipes;
      const plan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:next,moduleRecipes:recipes,
        integratedBuild:original.integratedBuild??false,allowUnderAttachments,allowWorkSurfaceUnderAttachments:allowUnderAttachments,
        preferLocalProgress:true,preferLocalFoundations:true});
      const bad=unresolvedCells(plan),steps=plan.steps.filter(s=>s.moduleId===id),reasons=[];
      if(bad.size>=oldBad.size||[...bad].some(cell=>!oldBad.has(cell)))reasons.push('Must remove failures without adding unresolved cells');
      if(!steps.some(s=>s.kind==='join'&&s.joinContext?.direction==='up')||steps.some(s=>s.issues.some(i=>i.severity==='error')))reasons.push('Incomplete recipe or upward attachment');
      let result;
      if(!reasons.length){
        result=retainUnchangedDiagrams(before,prepareAssemblyGuide({...before,assemblyPlan:plan},{moduleReplay:next}),
          {omittedContextIds:ids});
        if(prepareCandidate)result=prepareCandidate(before,result);
        const outside=guide=>guide.instructionPlan.steps.filter(s=>s.moduleId!==id
          && !(s.newBrickIds.length&&s.newBrickIds.every(brickId=>ids.has(brickId)))).length;
        if(outside(result)>outside(before))reasons.push('Would fragment existing work outside the new assembly');
      }
      attempts.push({moduleId:module.id,parts:ids.size,rejectionReasons:reasons});
      if(!reasons.length)candidates.push({plan,result,moduleId:id,parts:ids.size});
    }catch(error){attempts.push({moduleId:module.id,parts:ids.size,rejectionReasons:[error.message]});}
  }
  candidates.sort((a,b)=>unresolvedCells(a.plan).size-unresolvedCells(b.plan).size||a.plan.steps.length-b.plan.steps.length);
  const winner=candidates[0];
  if(!winner)return {...before,undersideAssemblyPlanning:{selected:false,attempts}};
  return {...winner.result,undersideAssemblyPlanning:{selected:true,attempts,moduleId:winner.moduleId,parts:winner.parts}};
}
