import {proposeCourseFeatures} from './course-features.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {refreshNestedRecipeReferences} from './nested-recipe-references.js';

const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
function clean(step){
  return step.kind==='build'&&step.newBrickIds.length&&!step.issues.length
    &&(step.insertionDirection??'down')==='down'&&!step.instructionAction&&!step.buildRegion
    &&sameSet(step.newBrickIds,step.highlightBrickIds);
}
function stats(plan,steps){
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.visibleBrickIds.length+s.highlightBrickIds.length+s.newBrickIds.length,0)}};
}
function cameraQuality(plan){
  const views=chooseInstructionSequence(plan);
  return {turns:[...views.values()].filter(v=>v.turned).length,
    unreadable:new Set([...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}

// A rejected global assembly proposal must not prevent improvements to a
// supported portion of its old guide. Warning-bearing operations stay exact.
export function refineSupportedInstructionRuns(result){
  return refineSupportedRuns(result,false);
}

/** Plan a whole clean work area after preserving established local actions. */
export function refineSupportedInstructionAreas(result){
  return refineSupportedRuns(result,true);
}

// A validated parent has its own receiving scene. Plan inside that scene,
// without crossing a child recipe, attachment, or table-supported floor.
export function refineNestedInstructionRuns(result){
  return refineSupportedRuns(result,false,true);
}

export function refineNestedInstructionAreas(result){
  return refineSupportedRuns(result,true,true);
}

export function refineNestedAssemblyTasks(result){
  if(!result.assemblyPlan?.moduleRecipes)return result;
  let current=result;const changes=[];
  for(let pass=0;pass<4;pass++){
    const before=current;
    for(const [refine,field]of [[refineNestedInstructionRuns,'supportedRunRefinement'],[refineNestedInstructionAreas,'supportedAreaRefinement']]){
      const next=refine(current);
      if(next!==current){changes.push({pass,...next[field]});current=next;}
    }
    if(current===before)break;
  }
  if(current===result)return result;
  const {assemblyPlan,instructionPlan}=refreshNestedRecipeReferences(current.assemblyPlan,current.instructionPlan);
  return {...current,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),nestedTaskPlanning:{changes,
    beforeDiagrams:result.instructionPlan.steps.length,afterDiagrams:instructionPlan.steps.length}};
}

function refineSupportedRuns(result,completeArea,nestedOnly=false){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError||result.brickModel.bricks.length>1000)return result;
  const plan=result.instructionPlan,byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1)
    .flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const sameContext=(a,b)=>a.moduleId===b.moduleId&&a.nestedRecipe?.id===b.nestedRecipe?.id;
  const allowed=s=>nestedOnly ? s.nestedRecipe&&!s.nestedRecipe.separate
    &&s.newBrickIds.every(id=>byId.get(id).y>s.nestedRecipe.floorY) : !protectedModules.has(s.moduleId);
  const choices=[];
  for(let start=0;start<plan.steps.length;start++){
    if(!allowed(plan.steps[start]))continue;
    let lengths=[8,6,4,2];
    if(completeArea){
      const eligible=s=>allowed(s)&&clean(s)&&s.newBrickIds.every(id=>byId.get(id).y>0);
      if(!eligible(plan.steps[start]))continue;
      if(start&&sameContext(plan.steps[start-1],plan.steps[start])&&eligible(plan.steps[start-1]))continue;
      let end=start+1;
      while(end<plan.steps.length&&sameContext(plan.steps[end],plan.steps[start])&&eligible(plan.steps[end]))end++;
      if(end-start<=8)continue;
      lengths=[end-start];
    }
    for(const length of lengths){
      const steps=plan.steps.slice(start,start+length);
      if(steps.length!==length||steps.some(s=>!allowed(s)||!clean(s)||!sameContext(s,steps[0])))continue;
      const bricks=steps.flatMap(s=>s.newBrickIds.map(id=>byId.get(id))),courses=new Set(bricks.map(b=>b.y));
      if(bricks.length>(completeArea?256:96)||courses.size>(completeArea?16:6)||Math.min(...courses)===0)continue;
      const mixed=steps.filter(s=>new Set(s.newBrickIds.map(id=>byId.get(id).y)).size>1).length;
      choices.push({start,end:start+length,steps,bricks,mixed});
    }
  }
  if(!choices.length)return result;
  choices.sort((a,b)=>b.mixed-a.mixed||b.steps.length-a.steps.length||a.start-b.start);
  const sourceMap=new Map(result.assemblyPlan.steps.map(s=>[s.id,s]));
  const candidates=[];
  for(const choice of choices.slice(0,96)){
    const {start,end,steps,bricks,mixed}=choice,newIds=new Set(bricks.map(b=>b.id));
    const initial=steps[0].visibleBrickIds.filter(id=>!newIds.has(id)),scene=initial.map(id=>byId.get(id));
    const sourceIds=steps.flatMap(s=>s.sourceStepIds),sourceStart=result.assemblyPlan.steps.findIndex(s=>s.id===sourceIds[0]);
    const originals=sourceIds.map(id=>sourceMap.get(id));
    if(originals.some(s=>!s||!clean(s))
      ||sourceStart<0||result.assemblyPlan.steps.slice(sourceStart,sourceStart+sourceIds.length).some((s,i)=>s.id!==sourceIds[i]))continue;
    if(!sameSet(originals.flatMap(s=>s.newBrickIds),bricks.map(b=>b.id)))continue;
    const origin=new Map(originals.flatMap(s=>s.newBrickIds.map(id=>[id,s]))),features=[];
    let valid=true;
    for(const y of [...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b)){
      const layer=bricks.filter(b=>b.y===y),proposal=proposeCourseFeatures(layer,scene,{completeArea});
      if(!proposal){valid=false;break;}
      for(const feature of proposal){
        for(const id of feature.brickIds){
          const b=byId.get(id),old=origin.get(id);
          const expected=old.visibleBrickIds.filter(p=>!old.newBrickIds.includes(p)).map(p=>byId.get(p))
            .filter(p=>p.y===b.y-1&&overlaps(p,b)).map(p=>p.id);
          const support=scene.filter(p=>p.y===b.y-1&&overlaps(p,b)).map(p=>p.id);
          if(!support.length||expected.some(id=>!support.includes(id))||scene.some(p=>p.y>b.y&&overlaps(p,b))){valid=false;break;}
        }
        if(!valid)break;
        features.push({...feature,course:y});scene.push(...feature.brickIds.map(id=>byId.get(id)));
      }
      if(!valid)break;
    }
    if(!valid||features.length>steps.length||features.length===steps.length&&(completeArea||!mixed)
      ||!sameSet(scene.map(b=>b.id),steps.at(-1).visibleBrickIds))continue;
    const visible=[...initial],canonical=[],diagrams=[];
    for(const [i,f]of features.entries()){
      const action={id:`${steps[0].id}-supported-action-${i+1}`,kind:'feature',destination:{kind:f.kind,course:f.course}};
      const operations=[];
      for(const id of f.brickIds){
        visible.push(id);
        const original=origin.get(id),sourceId=`${sourceIds[0]}-supported-${canonical.length+1}`;
        const step={...original,id:sourceId,newBrickIds:[id],highlightBrickIds:[id],visibleBrickIds:[...visible],
          sourceOperationId:original.sourceOperationId??original.id,instructionAction:action};
        canonical.push(step);
        operations.push({id:sourceId,kind:'build',insertionDirection:'down',newBrickIds:[id],highlightBrickIds:[id],issues:[]});
      }
      diagrams.push({...steps[0],id:`${steps[0].id}-supported-${i+1}`,newBrickIds:f.brickIds,highlightBrickIds:[...f.brickIds],
        visibleBrickIds:[...visible],instructionAction:action,sourceStepIds:operations.map(s=>s.id),orderedOperations:operations,
        label:`${steps[0].label.split(' · add ')[0]} · add ${f.brickIds.length} bricks`});
    }
    const assemblyPlan=stats(result.assemblyPlan,[...result.assemblyPlan.steps.slice(0,sourceStart),...canonical,...result.assemblyPlan.steps.slice(sourceStart+sourceIds.length)]);
    const instructionPlan=stats(plan,[...plan.steps.slice(0,start),...diagrams,...plan.steps.slice(end)]);
    if(JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id)))continue;
    candidates.push({assemblyPlan,instructionPlan,diagrams,start,end,mixed,gain:steps.length-diagrams.length,sourceIds});
  }
  candidates.sort((a,b)=>b.mixed-a.mixed||b.gain-a.gain||a.start-b.start);
  if(!candidates.length)return result;
  const baseline=cameraQuality(plan);
  for(const candidate of candidates.slice(0,8)){
    const quality=cameraQuality(candidate.instructionPlan);
    if(quality.turns>baseline.turns||candidate.diagrams.some(s=>quality.unreadable.has(s.id))
      ||[...quality.unreadable].some(id=>!baseline.unreadable.has(id)))continue;
    const compaction={...result.assemblyEvaluation?.compaction,sourceStepCount:candidate.assemblyPlan.steps.length,
      instructionDiagramCount:candidate.instructionPlan.steps.length,collapsedStepCount:candidate.assemblyPlan.steps.length-candidate.instructionPlan.steps.length,
      mergedDiagramCount:candidate.instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length,
      brickCoverageComplete:true,sourceStepCoverageComplete:true};
    return {...result,assemblyPlan:candidate.assemblyPlan,instructionPlan:candidate.instructionPlan,
      guide:createGuideSections(candidate.instructionPlan),assemblyEvaluation:{...result.assemblyEvaluation,compaction},
      [completeArea?'supportedAreaRefinement':'supportedRunRefinement']:{selected:true,oldStepIds:plan.steps.slice(candidate.start,candidate.end).map(s=>s.id),
        newStepIds:candidate.diagrams.map(s=>s.id),mixedStepsRemoved:candidate.mixed,diagramsRemoved:candidate.gain}};
  }
  return result;
}
