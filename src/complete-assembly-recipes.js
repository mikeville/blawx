import {planAssemblyRecipes} from './assembly-recipe-planning.js';
import {replanRecipeTasks,replanRecipeFloors,replanSupportedRecipeCourses} from './recipe-tasks.js';
import {replanWorkAreaTasks} from './work-area-tasks.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreRepeatedOrder,contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {discoverCompleteComponentRecipe,discoverLayeredComponentRecipe} from './component-recipe-discovery.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const count=result=>createBookletPresentation(result).numbering.diagramCount;
const scope=m=>m.buildContext&&[m.buildContext.kind,m.buildContext.floorY,m.buildContext.joinDirection??'down'];
const membership=(a,b)=>a&&b&&a.kind===b.kind&&same(sorted(a.brickIds),sorted(b.brickIds))&&same(scope(a),scope(b));
const joinScope=s=>s.nestedRecipe&&[s.nestedRecipe.id,s.nestedRecipe.parentModuleId,s.nestedRecipe.floorY,s.nestedRecipe.separate];
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';
const unchangedTasks=(plan,changed)=>plan.steps.filter(s=>!changed.has(s.moduleId)).map(s=>({moduleId:s.moduleId,kind:s.kind,new:sorted(s.newBrickIds),
  highlighted:sorted(s.highlightBrickIds),visible:sorted(s.visibleBrickIds),issues:s.issues,direction:s.insertionDirection??'down'}));

function placements(plan,moduleId){
  return plan.steps.filter(s=>s.moduleId===moduleId).flatMap(s=>s.newBrickIds.map(id=>({id,kind:s.kind,direction:s.insertionDirection??'down',
    scope:s.nestedRecipe&&[s.nestedRecipe.parentModuleId,s.nestedRecipe.floorY,s.nestedRecipe.separate],issues:s.issues})))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

/** Retain recipe identity only where membership and placement evidence survive. */
export function restoreUnchangedRecipeMetadata(before,candidate){
  const old=before.assemblyPlan,next=candidate.assemblyPlan;
  const modules=next.modules.map(module=>{
    const prior=old.modules.find(m=>m.id===module.id);
    if(!membership(prior,module)||!same(placements(old,prior.id),placements(next,module.id)))return module;
    const restored={...module};
    for(const field of ['recipeFamily','sharedHandledRecipe','localInterfaceRepair','componentRecipe'])if(prior[field])restored[field]=structuredClone(prior[field]);
    if(prior.mirroredAssembly) {
      const sourceId=prior.mirroredAssembly.sourceModuleId,oldSource=old.modules.find(m=>m.id===sourceId),newSource=next.modules.find(m=>m.id===sourceId);
      if(membership(oldSource,newSource)&&same(placements(old,sourceId),placements(next,sourceId)))restored.mirroredAssembly=structuredClone(prior.mirroredAssembly);
    }
    if(prior.repeatContinuation){
      const original=old.steps.find(s=>s.id===prior.repeatContinuation.joinSourceStepId);
      const join=next.steps.find(s=>s.kind==='join'&&s.moduleId===original?.moduleId&&!s.nestedRecipe);
      if(join&&!join.issues.length&&direction(join)===direction(original)&&same(contactCells(old,original),contactCells(next,join)))
        restored.repeatContinuation={...structuredClone(prior.repeatContinuation),joinSourceStepId:join.id};
    }
    return restored;
  });
  const assemblyPlan=restoreRepeatedOrder({...next,modules});
  const instructionPlan={...candidate.instructionPlan,modules};
  return {...candidate,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

function validateCandidate(before,after,changed){
  const old=before.assemblyPlan,next=after.assemblyPlan,reasons=[];
  if(!same(before.brickModel,after.brickModel))reasons.push('Recipe discovery changed geometry');
  const priorBad=unresolvedCells(old),bad=unresolvedCells(next);
  if(bad.size>=priorBad.size||[...bad].some(c=>!priorBad.has(c)))reasons.push('Failed geometry did not strictly improve');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id))
    ||!same(sorted(next.steps.flatMap(s=>s.newBrickIds)),sorted(next.bricks.map(b=>b.id))))reasons.push('Incomplete source coverage');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const current=next.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&same(joinScope(s),joinScope(join)));
    if(!current||current.issues.length||direction(current)!==direction(join)||!same(contactCells(old,join),contactCells(next,current)))reasons.push('Existing attachment changed');
  }
  const repeat=result=>createBookletPresentation(result).presentation.sections.filter(s=>s.repeatCount>1)
    .map(s=>({copies:s.repeatCount,steps:s.stepIds.length,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeat(before),repeat(after)))reasons.push('Existing repeated recipe changed');
  if(!same(unchangedTasks(before.instructionPlan,changed),unchangedTasks(after.instructionPlan,changed)))reasons.push('Unrelated diagram tasks changed');
  const oldHandling=assessWorkSurfaceQuality(old).modules,newHandling=assessWorkSurfaceQuality(next).modules;
  for(const handling of newHandling){
    if(handling.finalComponentCount!==1)reasons.push('Recipe cannot be lifted as one assembly');
    const prior=oldHandling.find(m=>m.moduleId===handling.moduleId);
    if(prior&&!changed.has(handling.moduleId)&&['peakLooseBrickCount','peakComponentCount','firstBondAtAddition'].some(k=>handling[k]>prior[k]))reasons.push('Existing recipe handling worsened');
  }
  const views=chooseInstructionSequence(after.instructionPlan);
  // Upward operations use the reader's underside camera and are deliberately
  // absent from the downward sequence view map. Their placement is replayed
  // by the assembly planner; do not treat a missing overhead view as occlusion.
  if(after.instructionPlan.steps.filter(s=>changed.has(s.moduleId)&&s.kind==='build'&&s.insertionDirection!=='up').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))reasons.push('New recipe additions are obscured');
  // A newly completed child assembly needs its own attachment diagram even
  // when it remains inside an existing parent module.
  const newJoins=next.steps.filter(s=>s.kind==='join'&&!s.issues.length&&!old.steps.some(prior=>prior.kind==='join'&&!prior.issues.length
    &&prior.moduleId===s.moduleId&&same(joinScope(prior),joinScope(s)))).length;
  if(count(after)>count(before)+newJoins)reasons.push('Recipe rebuild fragments the guide');
  if(reasons.length)throw Error([...new Set(reasons)].join('; '));
  return newHandling.map(({stepStates,...record})=>record);
}

function moduleEvidence(plan,moduleId){
  return {placements:placements(plan,moduleId),joins:plan.steps.filter(s=>s.moduleId===moduleId&&!s.newBrickIds.length)
    .map(s=>({kind:s.kind,direction:direction(s),scope:joinScope(s),highlight:sorted(s.highlightBrickIds),issues:s.issues}))};
}

/** Prepare changed ownership and newly usable dependents before judging a cut. */
export function prepareCompleteRecipeCandidate(prior,proposal){
  const changed=new Set([...prior.assemblyPlan.modules,...proposal.assemblyPlan.modules].filter(m=>{
    const old=prior.assemblyPlan.modules.find(p=>p.id===m.id),next=proposal.assemblyPlan.modules.find(p=>p.id===m.id);
    if(!membership(old,next))return true;
    // A previously failed dependent attachment can become usable after its
    // receiver is completed. It is part of this repair, not unrelated work.
    const failed=prior.assemblyPlan.steps.some(s=>s.moduleId===m.id&&s.issues.some(i=>i.severity==='error'));
    return failed&&!same(moduleEvidence(prior.assemblyPlan,m.id),moduleEvidence(proposal.assemblyPlan,m.id));
  }).map(m=>m.id));
  let candidate=restoreUnchangedRecipeMetadata(prior,proposal);
  candidate=retainUnchangedDiagrams(prior,candidate);
  // Scoped grouping cannot repair fragmentation in an unchanged module.
  // Reject it before spending time regrouping the rest of a large guide.
  if(!same(unchangedTasks(prior.instructionPlan,changed),unchangedTasks(candidate.instructionPlan,changed)))throw Error('Unrelated diagram tasks changed');
  // Old result-level receipts must not suppress grouping in a reconstructed
  // scope. Unchanged modules retain their established task choices.
  candidate=replanWorkAreaTasks(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds:changed}),{moduleIds:changed}),{consolidateCourses:true,moduleIds:changed});
  candidate=replanSupportedRecipeCourses(candidate,{moduleIds:changed});
  candidate=retainUnchangedDiagrams(prior,candidate);
  const handling=validateCandidate(prior,candidate,changed);
  return {candidate,changed,handling};
}

/** Evaluate complete recipes after restoring repeats and grouping changed scopes. */
export function completeAssemblyRecipes(before){
  if(!before.assemblyPlan?.stats.rootFailureCount||!before.instructionPlan||before.assemblyError
    ||before.brickModel.bricks.length>1000||before.completeRecipePlanning?.selected)return before;
  const attempts=[];
  const prepareCandidate=(prior,proposal)=>{
    try{
      const {candidate,changed,handling}=prepareCompleteRecipeCandidate(prior,proposal);
      attempts.push({modules:[...changed],beforeDiagrams:count(prior),afterDiagrams:count(candidate),beforeUnresolved:prior.assemblyPlan.stats.unresolvedBrickCount,
        afterUnresolved:candidate.assemblyPlan.stats.unresolvedBrickCount,handling,reasons:[]});
      return candidate;
    }catch(error){attempts.push({reasons:[error.message]});throw error;}
  };
  // The same component may be reconsidered after its receiver changes. Reuse
  // its local search, but always replay and validate its actual global join.
  const recipes=new Map();
  const discoverWith=discover=>bricks=>{
    const key=discover.name+JSON.stringify(bricks.map(({id,...brick})=>brick));
    if(!recipes.has(key)){
      try{recipes.set(key,{recipe:discover(bricks).recipe});}
      catch(error){recipes.set(key,{error:error.message});}
    }
    const stored=recipes.get(key);
    if(stored.error)throw Error(stored.error);
    return stored.recipe;
  };
  let result=planAssemblyRecipes(before,{preservePlacements:true,prepareCandidate,
    discoverNestedRecipe:discoverWith(discoverCompleteComponentRecipe)});
  // Try the bounded downward-course strategy only when ordinary discovery
  // cannot improve this guide. Replay and acceptance remain identical.
  if(result===before)result=planAssemblyRecipes(before,{preservePlacements:true,prepareCandidate,
    discoverNestedRecipe:discoverWith(discoverLayeredComponentRecipe)});
  if(result===before)return attempts.length?{...before,completeRecipePlanning:{selected:false,attempts}}:before;
  return {...result,assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(result.assemblyPlan)},
    completeRecipePlanning:{selected:true,attempts,stages:result.assemblyRecipePlanning.stages}};
}
