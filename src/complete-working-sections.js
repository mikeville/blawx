import {discoverWorkingSections} from './working-section-recipes.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {unresolvedCells} from './refine-construction.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {contactCells} from './local-interface-repair.js';
import {assessAssemblyQuality} from './assembly-quality.js';


function workingScopes(plan){
 const by=new Map(plan.bricks.map(b=>[b.id,b])),adj=new Map(plan.bricks.map(b=>[b.id,[]]));
 for(const{a,b}of plan.graph.edges){adj.get(a).push(b);adj.get(b).push(a);}
 const failed=new Set(plan.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds));
 const floors=[...new Set([...failed].flatMap(id=>[by.get(id).y,by.get(id).y-1]))].filter(y=>y>0).sort((a,b)=>a-b),seen=new Set(),results=[];
 for(const floor of floors){
  const pending=new Set(plan.bricks.filter(b=>b.y>=floor).map(b=>b.id));
  while(pending.size){const ids=new Set([pending.values().next().value]);for(const id of ids){pending.delete(id);for(const next of adj.get(id))if(pending.has(next))ids.add(next);}
   const failures=[...ids].filter(id=>failed.has(id)).length,signature=[...ids].sort().join('|');
   if(failures<10||ids.size>512||seen.has(signature))continue;seen.add(signature);
   results.push({floor,ids:[...ids],failures,parts:ids.size});
  }
 }
 return results.sort((a,b)=>b.failures-a.failures||a.parts-b.parts).slice(0,4);
}


const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const hasError=s=>s.issues.some(i=>i.severity==='error');
const count=result=>createBookletPresentation(result).numbering.diagramCount;
const protectedModule=m=>['recipeFamily','mirroredAssembly','sharedHandledRecipe','repeatContinuation'].some(k=>m[k]);
const replayOptions={allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,
 groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};

function replaceScope(before,scope,proposal){
 const plan=before.assemblyPlan,selected=new Set(scope.ids);
 const owners=new Set(plan.modules.filter(m=>m.brickIds.some(id=>selected.has(id))).map(m=>m.id));
 if(plan.modules.some(m=>owners.has(m.id)&&protectedModule(m)))throw Error('Protected repeated assembly');
 let id='complete-working-sections';while(plan.modules.some(m=>m.id===id))id+='-next';
 const recipes={...replayNestedRecipes(plan),[id]:proposal.recipe};
 const replay=recipeReplay(plan,{preservePlacements:true}).flatMap(m=>{
  if(!owners.has(m.id))return[m];
  delete recipes[m.id];
  const rest=m.brickIds.filter(id=>!selected.has(id));
  if(!rest.length)return[];
  // Removing an upper region is not permission to redesign the lower work.
  // Replay the retained source actions in their original order, with all
  // placements and failures checked again by the real assembler.
  const groups=plan.steps.filter(s=>s.moduleId===m.id)
   .map(s=>s.newBrickIds.filter(id=>!selected.has(id))).filter(ids=>ids.length);
  return[{...restrictRecipe(m,rest),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups}];
 });
 const remaining=replay.flatMap((m,i)=>owners.has(m.id)?[i]:[]);
 const first=plan.modules.findIndex(m=>owners.has(m.id));
 const insertion=remaining.length?remaining[0]+1:replay.filter(m=>plan.modules.findIndex(old=>old.id===m.id)<first).length;
 replay.splice(insertion,0,{id,label:'Complete sections',kind:'detail',groupType:'work-surface',
  brickIds:scope.ids,brickOrder:scope.ids,buildContext:{kind:'work-surface',floorY:proposal.floor,joinDirection:'down'}});
 const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:recipes,...replayOptions});
 const result=retainUnchangedDiagrams(before,restoreUnchangedRecipeMetadata(before,
  prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay:replay})),{omittedContextIds:selected});
 return{result,id};
}

/** Judge a complete replacement in its real receiving scene. */
export function validateWorkingSectionCandidate(before,after,{ids,moduleId}){
 const p=after.assemblyPlan,q=after.instructionPlan,selected=new Set(ids);
 if(!same(before.brickModel,after.brickModel)||!same(before.assemblyPlan.bricks,p.bricks))throw Error('Working recipe changed geometry');
 const expected=sorted(p.bricks.map(b=>b.id));
 if(!same(sorted(p.steps.flatMap(s=>s.newBrickIds)),expected)
  ||!same(sorted(q.steps.flatMap(s=>s.newBrickIds)),expected)
  ||!same(q.steps.flatMap(s=>s.sourceStepIds),p.steps.map(s=>s.id))
  ||!same(after.guide.sections.flatMap(s=>s.stepIds),q.steps.map(s=>s.id)))throw Error('Incomplete working recipe coverage');
 const oldBad=unresolvedCells(before.assemblyPlan),bad=unresolvedCells(p);
 if(bad.size>=oldBad.size||[...bad].some(c=>!oldBad.has(c)))throw Error('Working recipe did not safely resolve placements');
 if(p.steps.some(s=>s.moduleId===moduleId&&hasError(s))
  ||!p.steps.some(s=>s.moduleId===moduleId&&s.kind==='join'&&!s.nestedRecipe))throw Error('Working sections cannot attach');
 const operation=s=>[s.id,s.kind,s.newBrickIds,s.highlightBrickIds,s.issues,s.insertionDirection??'down',s.workingOrientation??null];
 const sources=new Map(p.steps.map(s=>[s.id,s])),stepIds=new Set(q.steps.map(s=>s.id));
 for(const step of q.steps){
  if(!same(step.orderedOperations.map(operation),step.sourceStepIds.map(id=>operation(sources.get(id)))))throw Error('Working recipe lost literal operations');
  if(step.tableRecipe&&!stepIds.has(step.tableRecipe.completionStepId)
   ||step.componentTask&&!stepIds.has(step.componentTask.lastStepId))throw Error('Stale working recipe reference');
 }
 // Compare the original tasks after removing the replaced region from their
 // visible context. Recovered geometry must not fragment another work area.
 // A prior diagram may straddle the new assembly boundary. Its retained
 // pieces need a newly validated step too; compare every wholly unaffected
 // diagram exactly, rather than counting a necessary split as a regression.
 const boundary=new Set(before.instructionPlan.steps.filter(s=>s.newBrickIds.some(id=>selected.has(id)))
  .flatMap(s=>s.newBrickIds));
 const affected=id=>selected.has(id)||boundary.has(id);
 const outside=result=>result.instructionPlan.steps
  .filter(s=>!s.newBrickIds.some(affected)&&!s.highlightBrickIds.some(affected))
  .map(s=>({kind:s.kind,new:s.newBrickIds,highlight:sorted(s.highlightBrickIds),
   visible:sorted(s.visibleBrickIds.filter(id=>!selected.has(id))),direction:s.insertionDirection??'down',
   issues:s.kind==='unresolved'&&!s.newBrickIds.length?[]:s.issues}));
 if(!same(outside(before),outside(after)))throw Error('Working recipe changed outside tasks');
 for(const old of before.assemblyPlan.steps.filter(s=>s.kind==='join'&&!hasError(s)&&!s.highlightBrickIds.some(id=>selected.has(id)))){
  const next=p.steps.find(s=>s.kind==='join'&&s.moduleId===old.moduleId&&s.nestedRecipe?.id===old.nestedRecipe?.id);
  if(!next||hasError(next)||!same(contactCells(before.assemblyPlan,old),contactCells(p,next)))throw Error('Working recipe changed an outside attachment');
 }
 const repeat=result=>createBookletPresentation(result).presentation.sections.filter(s=>s.repeatCount>1)
  .map(s=>[s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i=>i.brickIds))]);
 if(!same(repeat(before),repeat(after)))throw Error('Working recipe changed repeated construction');
 const views=chooseInstructionSequence(q);
 if(q.steps.some(s=>s.moduleId===moduleId&&s.kind==='build'
  &&(s.insertionDirection!=='up'||s.workingOrientation)
  &&(!views.get(s.id)?.passes||views.get(s.id)?.truncated)))throw Error('Working recipe obscures new pieces');
 // An unresolved diagram may stand for many impossible placements. Its old
 // count is not a fair simplicity target; still bound recovery overhead to
 // the number of placements actually made buildable.
 const recovered=before.assemblyPlan.stats.unresolvedBrickCount-p.stats.unresolvedBrickCount;
 if(count(after)>count(before)+recovered)throw Error('Working recipe has excessive recovery overhead');
 const replay=createAssemblyPlan({brickModel:after.brickModel,moduleReplay:recipeReplay(p,{preservePlacements:true}),
  moduleRecipes:replayNestedRecipes(p),...replayOptions});
 if(!same(sorted(unresolvedCells(replay)),sorted(bad))||replay.steps.some(s=>s.moduleId===moduleId&&hasError(s)))throw Error('Working recipe cannot replay');
}

/** Final bounded search: never feed a tentative pose back into earlier packing. */
export function completeWorkingSections(before){
 if(!before.instructionPlan||before.assemblyError||before.semanticGuide||before.workingSectionCompletion?.selected
  ||!before.assemblyPlan?.stats.unresolvedBrickCount||before.assemblyPlan.bricks.length>1000)return before;
 const by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b])),attempts=[];
 let best=before;
 for(const scope of workingScopes(before.assemblyPlan)){
  const found=discoverWorkingSections(scope.ids.map(id=>by.get(id)));
  const attempt={floor:scope.floor,parts:scope.parts,failedParts:scope.failures,local:found.attempts,global:[]};
  for(const proposal of found.candidates){
   const record={weight:proposal.weight,rootIndex:proposal.rootIndex,direction:proposal.direction};
   try{
    const {result,id}=replaceScope(before,scope,proposal);
    validateWorkingSectionCandidate(before,result,{ids:scope.ids,moduleId:id});
    Object.assign(record,{diagrams:count(result),unresolved:result.assemblyPlan.stats.unresolvedBrickCount,reasons:[]});
    if(best===before||record.unresolved<best.assemblyPlan.stats.unresolvedBrickCount
     ||record.unresolved===best.assemblyPlan.stats.unresolvedBrickCount&&record.diagrams<count(best)){
     best={...result,workingSectionCompletion:{selected:true,moduleId:id,parts:scope.parts,
      beforeUnresolved:before.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:record.unresolved,
      beforeDiagrams:count(before),afterDiagrams:record.diagrams}};
    }
   }catch(error){record.reasons=[error.message];}
   attempt.global.push(record);
  }
  attempts.push(attempt);
 }
 if(best===before)return attempts.length?{...before,workingSectionCompletion:{selected:false,attempts}}:before;
 return{...best,workingSectionCompletion:{...best.workingSectionCompletion,attempts},
  assemblyEvaluation:{...best.assemblyEvaluation,after:assessAssemblyQuality(best.assemblyPlan)}};
}
