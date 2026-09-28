import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {discoverCompleteTableRecipe} from './component-recipe-discovery.js';
export {discoverCompleteTableRecipe} from './component-recipe-discovery.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {replanRecipeTasks,replanRecipeFloors} from './recipe-tasks.js';
import {replanWorkAreaTasks} from './work-area-tasks.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=x=>[...x].sort();
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1)
  .map(s=>({copies:s.repeatCount,steps:s.stepIds.length,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
const tasks=(p,id)=>p.steps.filter(s=>s.moduleId!==id).map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,
  highlight:s.highlightBrickIds,visible:sorted(s.visibleBrickIds),issues:s.issues,direction:direction(s)}));

/** Replace suspended placements with a complete table recipe and a real join. */
export function completeHeldAssemblies(before) {
  if(!before.assemblyPlan||!before.instructionPlan||before.assemblyError||before.heldAssemblyCompletion?.selected
    ||before.brickModel.bricks.length>1000)return before;
  const protectedIds=new Set(repeats(before).flatMap(r=>r.ids));
  const candidates=before.assemblyPlan.modules.filter(m=>m.kind==='detail'&&!m.buildContext
    &&m.brickIds.length>=4&&m.brickIds.length<=160&&!m.recipeFamily&&!m.sharedHandledRecipe&&!m.repeatContinuation
    &&!m.componentRecipe&&!m.mirroredAssembly
    &&!m.brickIds.some(id=>protectedIds.has(id))
    &&before.assemblyPlan.steps.some(s=>s.moduleId===m.id&&s.issues.some(i=>i.code==='temporary-hold'))
    &&before.assemblyPlan.steps.filter(s=>s.moduleId===m.id).every(s=>!s.nestedRecipe&&!s.issues.some(i=>i.severity==='error')));
  let current=before;const attempts=[];
  // Compare at most two strategies for each bounded section. A locally valid
  // underside recovery can still fragment the complete recipe. The alternative
  // discovers a separate upper assembly, then validates it in the real scene.
  for(const original of candidates.slice(0,4)) {
   const seen=new Set();
   for(const allowUnderAttachments of [true,false])try {
    const old=current.assemblyPlan,module=old.modules.find(m=>m.id===original.id),id=module.id;
    const bricks=old.bricks.filter(b=>module.brickIds.includes(b.id)),{floor,recipe}=discoverCompleteTableRecipe(bricks,{allowUnderAttachments});
    if(floor<=0)continue;
    const signature=JSON.stringify(recipe);
    if(seen.has(signature))continue;
    seen.add(signature);
    // The complete global replay below validates these child descriptors again;
    // success in the isolated discovery scene cannot waive a real operation.
    const moduleReplay=recipeReplay(old,{preservePlacements:true}).map(m=>m.id===id?{...m,groupType:'work-surface',actionOrder:false,
      placementGroups:undefined,buildContext:{kind:'work-surface',floorY:floor,joinDirection:'down'}}:m);
    const recipes={...replayNestedRecipes(old),[id]:recipe};
    const plan=createAssemblyPlan({brickModel:current.brickModel,moduleReplay,moduleRecipes:recipes,integratedBuild:old.integratedBuild??false,
      allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
    let candidate=restoreUnchangedRecipeMetadata(current,prepareAssemblyGuide({...current,assemblyPlan:plan},{moduleReplay}));
    candidate=retainUnchangedDiagrams(current,candidate);
    const changed=new Set([id]);
    candidate=replanWorkAreaTasks(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds:changed}),{moduleIds:changed}),{consolidateCourses:true,moduleIds:changed});
    candidate=retainUnchangedDiagrams(current,candidate);
    const next=candidate.assemblyPlan,steps=next.steps.filter(s=>s.moduleId===id),oldBad=unresolvedCells(old),bad=unresolvedCells(next);
    if(steps.some(s=>s.issues.length)||!steps.some(s=>s.kind==='join'&&!s.nestedRecipe&&s.joinContext))throw Error('Incomplete assembly or final insertion');
    if([...bad].some(c=>!oldBad.has(c)))throw Error('New unresolved geometry');
    if(!same(sorted(next.steps.flatMap(s=>s.newBrickIds)),sorted(old.bricks.map(b=>b.id)))
      ||!same(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id)))throw Error('Incomplete source coverage');
    for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)) {
      const nextJoin=next.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
      if(!nextJoin||nextJoin.issues.length||direction(join)!==direction(nextJoin)
        ||!same(contactCells(old,join),contactCells(next,nextJoin)))throw Error('Established attachment changed');
    }
    if(!same(tasks(current.instructionPlan,id),tasks(candidate.instructionPlan,id)))throw Error('Unrelated tasks changed');
    if(!same(repeats(current),repeats(candidate)))throw Error('Established repetition changed');
    const handling=assessWorkSurfaceQuality(next).modules,priorHandling=assessWorkSurfaceQuality(old).modules;
    if(handling.some(m=>m.moduleId===id&&m.finalComponentCount!==1))throw Error('Assembly cannot be lifted together');
    for(const prior of priorHandling) {
      const nextHandling=handling.find(m=>m.moduleId===prior.moduleId);
      if(!nextHandling||nextHandling.finalComponentCount!==prior.finalComponentCount
        ||['peakLooseBrickCount','peakComponentCount','firstBondAtAddition','detachedBrickExposure'].some(k=>nextHandling[k]>prior[k]))throw Error('Established handling worsened');
    }
    const views=chooseInstructionSequence(candidate.instructionPlan);
    if(candidate.instructionPlan.steps.filter(s=>s.moduleId===id&&s.kind==='build'&&direction(s)!=='up')
      .some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))throw Error('New additions are obscured');
    const extraJoins=steps.filter(s=>s.kind==='join').length-old.steps.filter(s=>s.moduleId===id&&s.kind==='join').length;
    if(count(candidate)>count(current)+Math.max(0,extraJoins))throw Error('Recipe fragments the guide');
    if(candidate.instructionPlan.steps.some(s=>s.tableRecipe&&!candidate.instructionPlan.steps.some(t=>t.id===s.tableRecipe.completionStepId)))throw Error('Stale recipe reference');
    attempts.push({moduleId:id,allowUnderAttachments,selected:true,before:count(current),after:count(candidate),handling:handling.filter(m=>m.moduleId===id).map(({stepStates,...s})=>s)});
    current=candidate;
    break;
   }catch(error){attempts.push({moduleId:original.id,allowUnderAttachments,selected:false,reasons:[error.message]});}
  }
  if(!attempts.length)return before;
  return {...current,assemblyEvaluation:{...current.assemblyEvaluation,after:assessAssemblyQuality(current.assemblyPlan)},
    heldAssemblyCompletion:{selected:current!==before,attempts}};
}
