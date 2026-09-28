import {discoverDeferredBranchRecipe} from './deferred-branch-recipes.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {unresolvedCells} from './refine-construction.js';
import {contactCells} from './local-interface-repair.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=xs=>[...xs].sort();
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const options={allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};
const physical=s=>[s.kind,s.newBrickIds,s.highlightBrickIds,s.visibleBrickIds,s.insertionDirection??'down',s.workingOrientation??null,
  s.nestedRecipe?[s.nestedRecipe.id,s.nestedRecipe.parentModuleId,s.nestedRecipe.separate,s.nestedRecipe.floorY]:null,s.joinContext??null,s.issues];

export function planDeferredBranch(before,moduleId,proposal){
  const old=before.assemblyPlan,replay=recipeReplay(old,{preservePlacements:true});
  const module=replay.find(m=>m.id===moduleId);if(!module)throw Error('Missing handled module');
  module.groupType='work-surface';module.buildContext={kind:'work-surface',floorY:proposal.floor,joinDirection:'down'};
  delete module.placementGroups;delete module.actionOrder;
  for(const m of replay)if(m.id!==moduleId&&!old.steps.some(s=>s.moduleId===m.id&&s.nestedRecipe)){
    m.placementGroups=old.steps.filter(s=>s.moduleId===m.id).map(s=>s.newBrickIds).filter(g=>g.length);
    m.brickOrder=m.placementGroups.flat();m.actionOrder=true;
  }
  const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:{...replayNestedRecipes(old),[moduleId]:proposal.recipe},...options});
  const after=retainUnchangedDiagrams(before,restoreUnchangedRecipeMetadata(before,prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay:replay})));
  const p=after.assemblyPlan,q=after.instructionPlan;
  if(!same(before.brickModel,after.brickModel)||!same(old.bricks,p.bricks)||!same(sorted(unresolvedCells(old)),sorted(unresolvedCells(p))))throw Error('Deferred branch changed source geometry or failed placements');
  const outside=plan=>plan.steps.filter(s=>s.moduleId!==moduleId).map(physical);
  if(!same(outside(old),outside(p))||!same(outside(before.instructionPlan),outside(q)))throw Error('Deferred branch changed outside work');
  const target=p.steps.filter(s=>s.moduleId===moduleId);
  if(target.some(s=>s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning'))||!target.some(s=>s.kind==='join'&&!s.nestedRecipe))throw Error('Deferred branch is not a complete attachable workpiece');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.some(i=>i.severity==='error'))){
    const next=p.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
    if(!next||next.issues.some(i=>i.severity==='error')||!same(contactCells(old,join),contactCells(p,next))||(join.insertionDirection??'down')!==(next.insertionDirection??'down'))throw Error('Deferred branch changed an existing attachment');
  }
  const expected=sorted(p.bricks.map(b=>b.id));
  if(!same(sorted(p.steps.flatMap(s=>s.newBrickIds)),expected)||!same(sorted(q.steps.flatMap(s=>s.newBrickIds)),expected)||!same(q.steps.flatMap(s=>s.sourceStepIds),p.steps.map(s=>s.id)))throw Error('Deferred branch lost operation coverage');
  const source=new Map(p.steps.map(s=>[s.id,s]));
  for(const s of p.steps)if(s.nestedRecipe){
    const scope=s.nestedRecipe,first=source.get(scope.firstStepId),join=source.get(scope.attachmentStepId);
    if(!first||first.nestedRecipe?.id!==scope.id||scope.attachmentStepId&&(!join||join.nestedRecipe?.id!==scope.id||join.kind!=='join'))throw Error('Deferred branch left a stale recipe reference');
  }
  const diagramIds=new Set(q.steps.map(s=>s.id));
  if(!same(after.guide.sections.flatMap(s=>s.stepIds),q.steps.map(s=>s.id))||q.steps.some(s=>s.tableRecipe&&!diagramIds.has(s.tableRecipe.completionStepId)||s.componentTask&&!diagramIds.has(s.componentTask.lastStepId)))throw Error('Deferred branch left a stale guide reference');
  const literal=s=>[s.kind,s.newBrickIds,s.highlightBrickIds,s.insertionDirection??'down',s.workingOrientation??null,s.issues];
  if(q.steps.some(s=>!same(s.orderedOperations.map(literal),s.sourceStepIds.map(id=>literal(source.get(id))))))throw Error('Deferred branch changed literal operations');
  const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>[s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i=>i.brickIds))]);
  if(!same(repeats(before),repeats(after)))throw Error('Deferred branch changed repetition');
  const views=chooseInstructionSequence(q);
  if(q.steps.some(s=>s.moduleId===moduleId&&s.kind==='build'&&(!views.get(s.id)?.passes||views.get(s.id)?.truncated)))throw Error('Deferred branch obscures new pieces');
  if(count(after)>count(before))throw Error('Deferred branch fragments the guide');
  return{...after,assemblyEvaluation:{...after.assemblyEvaluation,after:assessAssemblyQuality(p)}};
}

/** Replace scattered, temporarily held starts with complete working assemblies. */
export function completeDeferredBranches(before){
  if(!before.instructionPlan||before.assemblyError||before.semanticGuide||before.deferredBranchCompletion?.selected||before.assemblyPlan.bricks.length>1000)return before;
  const p=before.assemblyPlan,by=new Map(p.bricks.map(b=>[b.id,b])),attempts=[];
  const eligible=p.modules.filter(m=>m.kind==='detail'&&!m.buildContext&&!p.moduleRecipes?.[m.id]
    &&!['recipeFamily','mirroredAssembly','sharedHandledRecipe','repeatContinuation'].some(k=>m[k])&&m.brickIds.length>=24&&m.brickIds.length<=512
    &&p.steps.some(s=>s.moduleId===m.id&&s.issues.some(i=>i.code==='temporary-hold'))).slice(0,4);
  let result=before;
  for(const m of eligible){
    const found=discoverDeferredBranchRecipe(m.brickIds.map(id=>by.get(id))),row={moduleId:m.id,discovery:found.attempts};
    if(found.candidate)try{
      const next=planDeferredBranch(result,m.id,found.candidate);
      row.beforeDiagrams=count(result);row.afterDiagrams=count(next);row.selected=true;
      result=next;
    }catch(error){row.error=error.message;}
    attempts.push(row);
  }
  return attempts.length?{...result,deferredBranchCompletion:{selected:result!==before,attempts}}:before;
}
