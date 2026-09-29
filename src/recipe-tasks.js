import {regroupSupportedRun} from './component-tasks.js';
import {discoverWorkAreaTasks} from './work-area-tasks.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {refreshNestedRecipeReferences} from './nested-recipe-references.js';
import {createGuideSections} from './guide-sections.js';

const sameScope=(a,b)=>a.moduleId===b.moduleId
  &&JSON.stringify(a.nestedRecipe??null)===JSON.stringify(b.nestedRecipe??null)
  &&JSON.stringify(a.nestedRecipePath??null)===JSON.stringify(b.nestedRecipePath??null);
const clean=s=>s.kind==='build'&&s.newBrickIds.length>0&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&!s.componentTask&&!s.tableRecipe
  &&s.newBrickIds.length===s.highlightBrickIds.length&&s.newBrickIds.every(id=>s.highlightBrickIds.includes(id));

function handlingChange(beforePlan, afterPlan, moduleId) {
  const before=assessWorkSurfaceQuality(beforePlan).modules.find(m=>m.moduleId===moduleId);
  const after=assessWorkSurfaceQuality(afterPlan).modules.find(m=>m.moduleId===moduleId);
  const noWorse=['peakLooseBrickCount','peakComponentCount','finalComponentCount'].every(key=>after[key]<=before[key])
    &&(before.firstBondAtAddition===null||after.firstBondAtAddition!==null&&after.firstBondAtAddition<=before.firstBondAtAddition);
  return noWorse?{handlingBefore:before,handlingAfter:after}:null;
}

/** Re-plan within one existing table context; never discover or move a join. */
export function replanRecipeTasks(result,{moduleIds=null}={}){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError
    ||result.recipeTaskPlanning?.selected&&!moduleIds||result.brickModel.bricks.length>1000)return result;
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const modules=new Map(result.assemblyPlan.modules.map(m=>[m.id,m])),by=new Map(result.assemblyPlan.bricks.map(b=>[b.id,b]));
  const tableFloor=step=>step.nestedRecipe?.floorY??modules.get(step.moduleId)?.buildContext?.floorY;
  const eligible=step=>modules.get(step.moduleId)?.buildContext?.kind==='work-surface'
    &&(!moduleIds||moduleIds.has(step.moduleId))
    &&!modules.get(step.moduleId).brickIds.some(id=>repeated.has(id))&&clean(step)
    // Preserve the first nested table course and its scope anchor. Supported
    // work above it can change without renumbering or flattening the child.
    &&step.newBrickIds.every(id=>step.nestedRecipe?by.get(id).y>tableFloor(step):by.get(id).y>=tableFloor(step));
  let current=result;const changes=[];
  for(let start=0;start<current.instructionPlan.steps.length;){
    const steps=current.instructionPlan.steps,first=steps[start];
    if(!eligible(first)){start++;continue;}
    let end=start+1;while(end<steps.length&&sameScope(first,steps[end])&&eligible(steps[end]))end++;
    if(end-start>=4){
      const next=regroupSupportedRun(current,start,end,discoverWorkAreaTasks,eligible,{balancePanels:true,
        minimumTaskReturns:0,minimumSavedDiagrams:2,tableFloor:tableFloor(first),preserveNestedContext:true});
      if(next){
        const handling=handlingChange(current.assemblyPlan,next.assemblyPlan,first.moduleId);
        // Whole table panels can enlarge a bonded component before it joins
        // the largest one. Record that size/exposure tradeoff; do not confuse
        // it with more loose pieces or more separate components. Their peaks,
        // the first bond and completed state remain bounded. Joins stay exact.
        if(handling){changes.push({...next.componentTaskPlanning,context:{moduleId:first.moduleId,nestedRecipe:first.nestedRecipe??null,floorY:tableFloor(first)},...handling});current=next;start+=next.componentTaskPlanning.afterDiagrams;continue;}
      }
    }
    start=end;
  }
  return changes.length?{...current,recipeTaskPlanning:{selected:true,changes}}:result;
}

/** A flat first course needs no vertical task merge to form a coherent panel. */
export function replanRecipeFloors(result,{moduleIds=null}={}) {
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError
    ||result.recipeFloorPlanning?.selected&&!moduleIds||result.brickModel.bricks.length>1000)return result;
  const modules=new Map(result.assemblyPlan.modules.map(m=>[m.id,m]));
  const by=new Map(result.assemblyPlan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const floor=step=>step.nestedRecipe?.floorY??modules.get(step.moduleId)?.buildContext?.floorY;
  const eligible=step=>modules.get(step.moduleId)?.buildContext?.kind==='work-surface'
    &&(!moduleIds||moduleIds.has(step.moduleId))
    &&!modules.get(step.moduleId).brickIds.some(id=>repeated.has(id))
    &&step.kind==='build'&&step.newBrickIds.length>0&&!step.issues.length
    &&(step.insertionDirection??'down')==='down'&&!step.componentTask
    &&(!step.tableRecipe||step.tableRecipe.layerTask===true)
    &&step.newBrickIds.length===step.highlightBrickIds.length
    &&step.newBrickIds.every(id=>step.highlightBrickIds.includes(id)&&by.get(id).y===floor(step));
  let current=result;const changes=[];
  for(let start=0;start<current.instructionPlan.steps.length;){
    const steps=current.instructionPlan.steps,first=steps[start];
    if(!eligible(first)){start++;continue;}
    let end=start+1;
    while(end<steps.length&&sameScope(first,steps[end])&&eligible(steps[end]))end++;
    if(end-start>=3){
      const next=regroupSupportedRun(current,start,end,discoverWorkAreaTasks,eligible,{balancePanels:true,
        minimumTaskReturns:0,minimumSavedDiagrams:1,tableFloor:floor(first),preserveNestedContext:true,flatTableCourse:true});
      const handling=next&&handlingChange(current.assemblyPlan,next.assemblyPlan,first.moduleId);
      if(handling){
        const plans=refreshNestedRecipeReferences(next.assemblyPlan,next.instructionPlan);
        changes.push({...next.componentTaskPlanning,context:{moduleId:first.moduleId,nestedRecipe:first.nestedRecipe??null,floorY:floor(first)},...handling});
        current={...next,...plans,guide:createGuideSections(plans.instructionPlan)};
        start+=next.componentTaskPlanning.afterDiagrams;continue;
      }
    }
    start=end;
  }
  return changes.length?{...current,recipeFloorPlanning:{selected:true,changes}}:result;
}

/** Finish one supported layer within its recipe, regardless of color patches. */
export function replanSupportedRecipeCourses(result,{moduleIds=null}={}) {
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError
    ||result.supportedRecipeCoursePlanning?.selected&&!moduleIds||result.brickModel.bricks.length>1000)return result;
  const modules=new Map(result.assemblyPlan.modules.map(m=>[m.id,m]));
  const by=new Map(result.assemblyPlan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const floor=s=>s.nestedRecipe?.floorY??modules.get(s.moduleId)?.buildContext?.floorY;
  const course=s=>by.get(s.newBrickIds[0])?.y;
  const eligible=s=>modules.get(s.moduleId)?.buildContext?.kind==='work-surface'
    &&(!moduleIds||moduleIds.has(s.moduleId))
    &&!modules.get(s.moduleId).brickIds.some(id=>repeated.has(id))&&clean(s)
    // An authored layer sweep already has a shared direction and completion
    // boundary. Keep its panels; reconsider only locally fragmented features.
    &&s.instructionAction?.destination?.kind!=='layer'
    &&course(s)>floor(s)&&s.newBrickIds.every(id=>by.get(id).y===course(s));
  let current=result;const changes=[];
  for(let start=0;start<current.instructionPlan.steps.length;){
    const steps=current.instructionPlan.steps,first=steps[start];
    if(!eligible(first)){start++;continue;}
    let end=start+1;
    while(end<steps.length&&sameScope(first,steps[end])&&eligible(steps[end])&&course(first)===course(steps[end]))end++;
    if(end-start>=3){
      const next=regroupSupportedRun(current,start,end,discoverWorkAreaTasks,eligible,{balancePanels:true,
        minimumTaskReturns:0,minimumSavedDiagrams:1,tableFloor:floor(first),preserveNestedContext:true,supportedCourse:true});
      const handling=next&&handlingChange(current.assemblyPlan,next.assemblyPlan,first.moduleId);
      if(handling){
        const plans=refreshNestedRecipeReferences(next.assemblyPlan,next.instructionPlan);
        changes.push({...next.componentTaskPlanning,course:course(first),context:{moduleId:first.moduleId,nestedRecipe:first.nestedRecipe??null,floorY:floor(first)},...handling});
        current={...next,...plans,guide:createGuideSections(plans.instructionPlan)};
        start+=next.componentTaskPlanning.afterDiagrams;continue;
      }
    }
    start=end;
  }
  return changes.length?{...current,supportedRecipeCoursePlanning:{selected:true,changes}}:result;
}
