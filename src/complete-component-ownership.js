import {discoverComponentExpansions} from './component-ownership.js';
import {discoverLayeredComponentRecipe} from './component-recipe-discovery.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {replanRecipeTasks,replanRecipeFloors,replanSupportedRecipeCourses} from './recipe-tasks.js';
import {prepareNestedRecipePresentation} from './nested-recipe-presentation.js';
import {completeNestedCourseDiagrams} from './nested-course-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {unresolvedCells} from './refine-construction.js';
import {contactCells} from './local-interface-repair.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sort=a=>[...a].sort();
const hasError=s=>s.issues.some(i=>i.severity==='error');
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const direction=s=>s.insertionDirection??'down';
const orderedReplay=plan=>recipeReplay(plan,{preservePlacements:true}).map(m=>m.actionOrder&&m.buildContext
  ?{...m,buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:m);

function validate(before,after,proposal){
  const p=after.assemblyPlan,q=after.instructionPlan,selected=new Set(proposal.brickIds);
  if(!same(before.brickModel,after.brickModel)||!same(before.assemblyPlan.bricks,p.bricks))throw Error('Component expansion changed geometry');
  const ids=sort(p.bricks.map(b=>b.id));
  if(!same(sort(p.steps.flatMap(s=>s.newBrickIds)),ids)||!same(sort(q.steps.flatMap(s=>s.newBrickIds)),ids)
    ||!same(q.steps.flatMap(s=>s.sourceStepIds),p.steps.map(s=>s.id)))throw Error('Incomplete component coverage');
  const sources=new Map(p.steps.map(s=>[s.id,s])),stepIds=new Set(q.steps.map(s=>s.id));
  const operation=s=>[s.id,s.kind,s.newBrickIds,s.issues,direction(s)];
  for(const s of q.steps){
    if(!same(sort(s.newBrickIds),sort(s.sourceStepIds.flatMap(id=>sources.get(id).newBrickIds)))
      ||!same(s.orderedOperations.map(operation),s.sourceStepIds.map(id=>operation(sources.get(id)))))throw Error('Diagram operations changed');
    if(s.tableRecipe&&!stepIds.has(s.tableRecipe.completionStepId)||s.componentTask&&!stepIds.has(s.componentTask.lastStepId))throw Error('Stale component reference');
  }
  if(!same(after.guide.sections.flatMap(s=>s.stepIds),q.steps.map(s=>s.id)))throw Error('Incomplete component guide');
  const bad=unresolvedCells(before.assemblyPlan),next=unresolvedCells(p);
  if(next.size>=bad.size||[...next].some(c=>!bad.has(c)))throw Error('Component expansion did not resolve existing failures');
  if(p.steps.some(s=>s.moduleId===proposal.parentId&&hasError(s)))throw Error('Incomplete expanded component');
  const outside=r=>r.instructionPlan.steps.filter(s=>!s.newBrickIds.some(id=>selected.has(id))&&!s.highlightBrickIds.some(id=>selected.has(id)))
    .map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:sort(s.highlightBrickIds.filter(id=>!selected.has(id))),
      visible:sort(s.visibleBrickIds.filter(id=>!selected.has(id))),direction:direction(s),
      // Already-failed joins must be checked in the newly completed scene.
      // Their actual collision diagnostics remain in the returned guide.
      issues:s.kind==='unresolved'&&!s.newBrickIds.length?[]:s.issues}));
  if(!same(outside(before),outside(after)))throw Error('An outside task changed');
  for(const s of before.assemblyPlan.steps.filter(s=>s.kind==='join'&&!hasError(s)&&!s.highlightBrickIds.some(id=>selected.has(id)))){
    const t=p.steps.find(t=>t.kind==='join'&&t.moduleId===s.moduleId&&t.nestedRecipe?.id===s.nestedRecipe?.id);
    if(!t||hasError(t)||!same(contactCells(before.assemblyPlan,s),contactCells(p,t)))throw Error('An outside attachment changed');
  }
  const views=chooseInstructionSequence(q);
  if(q.steps.some(s=>s.moduleId===proposal.parentId&&s.kind==='build'&&(direction(s)!=='down'||!views.get(s.id)?.passes||views.get(s.id)?.truncated)))throw Error('Expanded component has hidden or upward additions');
  const repeated=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1)
    .map(s=>[s.repeatCount,s.stepIds.length,sort(s.instances.flatMap(i=>i.brickIds))]);
  if(!same(repeated(before),repeated(after)))throw Error('Repeated construction changed');
  if(count(after)>count(before))throw Error('Component expansion fragments the guide');
  const replay=createAssemblyPlan({brickModel:after.brickModel,moduleReplay:orderedReplay(p),moduleRecipes:replayNestedRecipes(p),
    integratedBuild:p.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  if(!same(sort(unresolvedCells(replay)),sort(next))||replay.steps.some(s=>s.moduleId===proposal.parentId&&hasError(s)))throw Error('Expanded component cannot replay');
}

function expand(before,proposal){
  const old=before.assemblyPlan,by=new Map(old.bricks.map(b=>[b.id,b])),selected=new Set(proposal.brickIds),parentId=proposal.parentId;
  const found=discoverLayeredComponentRecipe(proposal.brickIds.map(id=>by.get(id)));
  const recipes=replayNestedRecipes(old)??{};
  const replay=orderedReplay(old).flatMap(m=>{
    if(m.id===parentId){recipes[m.id]=found.recipe;return [{id:m.id,label:m.label,kind:'detail',groupType:'work-surface',
      brickIds:proposal.brickIds,brickOrder:proposal.brickIds,buildContext:{kind:'work-surface',floorY:found.floor,joinDirection:'down'}}];}
    const ids=m.brickIds.filter(id=>!selected.has(id));
    if(!ids.length){delete recipes[m.id];return [];}
    if(ids.length===m.brickIds.length)return [m];
    if(recipes[m.id])throw Error('Cannot partially remove an existing handled recipe');
    const retained=restrictRecipe(m,ids),steps=old.steps.filter(s=>s.moduleId===m.id&&s.newBrickIds.some(id=>ids.includes(id)));
    if(steps.some(s=>s.nestedRecipe||hasError(s)))throw Error('Donor contains unresolved or nested work outside the component');
    const groups=steps.map(s=>s.newBrickIds.filter(id=>ids.includes(id)));
    return [{...retained,brickOrder:groups.flat(),placementGroups:groups,actionOrder:true}];
  });
  const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:recipes,
    integratedBuild:old.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  let result=retainUnchangedDiagrams(before,restoreUnchangedRecipeMetadata(before,prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay:replay})));
  const options={moduleIds:new Set([parentId])};
  result=replanSupportedRecipeCourses(replanRecipeFloors(replanRecipeTasks(result,options),options),options);
  result=prepareNestedRecipePresentation(result);
  // Recheck newly-created scopes even if an earlier pass completed other layers.
  const fresh={...result};delete fresh.completeNestedCourseDiagrams;
  result=completeNestedCourseDiagrams(fresh);
  validate(before,result,proposal);
  return {...result,assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(result.assemblyPlan)},
    componentOwnershipCompletion:{selected:true,parentId,componentParts:proposal.brickIds.length,capturedParts:proposal.captured.flat().length,
      beforeUnresolved:old.stats.unresolvedBrickCount,afterUnresolved:result.assemblyPlan.stats.unresolvedBrickCount,
      beforeDiagrams:count(before),afterDiagrams:count(result)}};
}

/** Reconsider a component boundary before preserving its failed continuation. */
export function completeComponentOwnership(before){
  if(!before.instructionPlan||before.assemblyError||before.componentOwnershipCompletion?.selected||before.semanticGuide)return before;
  const attempts=[];let best=before;
  for(const proposal of discoverComponentExpansions(before.assemblyPlan))try{
    const candidate=expand(before,proposal);attempts.push({...candidate.componentOwnershipCompletion,reasons:[]});
    if(best===before||candidate.assemblyPlan.stats.unresolvedBrickCount<best.assemblyPlan.stats.unresolvedBrickCount)best=candidate;
  }catch(error){attempts.push({parentId:proposal.parentId,parts:proposal.brickIds.length,reasons:[error.message]});}
  return best===before?before:{...best,componentOwnershipCompletion:{...best.componentOwnershipCompletion,attempts}};
}
