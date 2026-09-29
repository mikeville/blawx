import {recognizeCourseFeature} from './course-features.js';
import {evaluateInstructionVisibility, chooseInstructionSequence} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&sameSet(s.newBrickIds,s.highlightBrickIds);
const footprint=bricks=>bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.z+Math.floor(i/b.w)}`)).sort().join('|');

function taskKind(step,byId){
  if(!clean(step)||step.placementTask||step.buildRegion||step.tableRecipe)return null;
  const bricks=step.newBrickIds.map(id=>byId.get(id));
  const ordinary=!step.instructionAction||step.instructionAction.kind==='course'&&!step.instructionAction.destination;
  if(ordinary&&bricks.every(b=>b.y===0))return 'ground-layout';
  if(ordinary&&bricks.every(b=>b.y>0)&&new Set(bricks.map(b=>b.y)).size===1)return 'supported-course';
  if(step.instructionAction?.kind==='feature'&&step.instructionAction.destination?.kind==='pattern'
    &&new Set(bricks.map(b=>b.y)).size===1)return 'upright-layers';
  return null;
}

function combinedTask(steps,kind,byId,sourceMap,sequence){
  const ids=steps.flatMap(s=>s.newBrickIds),bricks=ids.map(id=>byId.get(id));
  if(bricks.length>24||new Set(ids).size!==ids.length)return null;
  // Ordinary courses can carry the same repeated upright geometry as an
  // explicitly planned pattern. Recognize the complete candidate here so
  // same-height surface consolidation still competes in the run partition.
  if(kind==='supported-course'&&new Set(bricks.map(b=>b.y)).size>1)kind='upright-layers';
  const sourceIds=steps.flatMap(s=>s.sourceStepIds),sources=sourceIds.map(id=>sourceMap.get(id));
  if(sources.some(s=>!s||!clean(s))||JSON.stringify(sources.flatMap(s=>s.newBrickIds))!==JSON.stringify(ids)
    ||JSON.stringify(steps.flatMap(s=>s.orderedOperations.map(o=>o.id)))!==JSON.stringify(sourceIds))return null;
  const prior=steps[0].visibleBrickIds.filter(id=>!ids.includes(id)).map(id=>byId.get(id));
  if(kind==='ground-layout'||kind==='supported-course'){
    if(new Set(bricks.map(b=>b.y)).size!==1||!recognizeCourseFeature(bricks,{completeArea:true}))return null;
    if(kind==='ground-layout'){
      if(bricks.some(b=>b.y!==0||prior.some(p=>overlap(p,b))))return null;
    }else if(bricks.some(b=>!prior.some(p=>p.y===b.y-1&&overlap(p,b))
      ||prior.some(p=>p.y>b.y&&overlap(p,b))))return null;
  }else{
    const layers=steps.map(s=>s.newBrickIds.map(id=>byId.get(id)));
    if(steps.length>3||new Set(bricks.map(b=>b.color)).size!==1
      ||layers.some((layer,i)=>layer[0].y!==layers[0][0].y+i||footprint(layer)!==footprint(layers[0])
        ||recognizeCourseFeature(layer)!=='pattern'))return null;
    // Replay the unchanged operations, so dependent courses are introduced
    // from the bottom up and cannot hide unsupported or blocked placements.
    const placed=[...prior];
    for(const b of bricks){
      if(!placed.some(p=>p.y===b.y-1&&overlap(p,b))||placed.some(p=>p.y>b.y&&overlap(p,b)))return null;
      placed.push(b);
    }
  }
  if(!sameSet([...prior.map(b=>b.id),...ids],steps.at(-1).visibleBrickIds))return null;
  const azimuth=sequence.get(steps[0].id)?.azimuth;
  if(azimuth===undefined||azimuth!==sequence.get(steps.at(-1).id)?.azimuth)return null;
  const view=evaluateInstructionVisibility({visibleBricks:steps.at(-1).visibleBrickIds.map(id=>byId.get(id)),
    highlightGroups:bricks.map(b=>({id:b.id,bricks:[b]})),azimuth});
  if(!view.passes||view.truncated)return null;
  const last=steps.at(-1),first=steps[0];
  return {...last,id:`${first.id}-${kind}`,newBrickIds:ids,highlightBrickIds:[...ids],sourceStepIds:sourceIds,
    orderedOperations:steps.flatMap(s=>s.orderedOperations),
    label:`${first.label.split(' · add ')[0]} · add ${ids.length} bricks`,
    placementTask:{kind,layerCount:new Set(bricks.map(b=>b.y)).size,sourceDiagramIds:steps.map(s=>s.id)}};
}

function viewQuality(plan){
  const views=[...chooseInstructionSequence(plan)];
  return {turns:views.filter(([,v])=>v.turned).length,
    unreadable:new Set(views.filter(([,v])=>!v.passes||v.truncated).map(([id])=>id))};
}

/** Combine readable tasks without changing a single canonical operation. */
export function consolidatePlacementTasks(result){
  const plan=result.instructionPlan;
  if(!plan||!result.assemblyPlan||result.assemblyError||plan.bricks.length>1000)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),sourceMap=new Map(result.assemblyPlan.steps.map(s=>[s.id,s]));
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1)
    .flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const sequence=chooseInstructionSequence(plan);
  const steps=[],merges=[];
  for(let start=0;start<plan.steps.length;){
    const first=plan.steps[start],kind=!protectedModules.has(first.moduleId)&&taskKind(first,byId);
    if(!kind){steps.push(first);start++;continue;}
    let end=start+1;
    while(end<plan.steps.length&&plan.steps[end].moduleId===first.moduleId&&taskKind(plan.steps[end],byId)===kind)end++;
    const run=plan.steps.slice(start,end),best=Array(run.length+1);best[run.length]={steps:[],merges:[],singletons:0};
    // Partition the entire run before deciding: avoid a long prefix followed
    // by a one-layer cleanup when two balanced tasks are equally short.
    for(let i=run.length-1;i>=0;i--){
      const tail=best[i+1];best[i]={steps:[run[i],...tail.steps],merges:tail.merges,singletons:tail.singletons+1};
      for(let length=2;length<=Math.min(kind==='upright-layers'?3:8,run.length-i);length++){
        const merged=combinedTask(run.slice(i,i+length),kind,byId,sourceMap,sequence);if(!merged)continue;
        const tail=best[i+length],candidate={steps:[merged,...tail.steps],merges:[merged,...tail.merges],singletons:tail.singletons};
        if(candidate.steps.length<best[i].steps.length||candidate.steps.length===best[i].steps.length&&candidate.singletons<best[i].singletons)best[i]=candidate;
      }
    }
    steps.push(...best[0].steps);merges.push(...best[0].merges);start=end;
  }
  if(!merges.length)return result;
  for(const key of ['newBrickIds','sourceStepIds','orderedOperations']){
    if(JSON.stringify(steps.flatMap(s=>s[key]))!==JSON.stringify(plan.steps.flatMap(s=>s[key])))return result;
  }
  const instructionPlan={...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
  const before=viewQuality(plan),after=viewQuality(instructionPlan);
  if(after.turns>before.turns||merges.some(s=>after.unreadable.has(s.id))||[...after.unreadable].some(id=>!before.unreadable.has(id)))return result;
  const compaction=result.assemblyEvaluation?.compaction;
  return {...result,instructionPlan,guide:createGuideSections(instructionPlan),
    placementTaskConsolidation:{beforeDiagrams:plan.steps.length,afterDiagrams:steps.length,
      tasks:merges.map(s=>({stepId:s.id,...s.placementTask}))},
    ...(compaction?{assemblyEvaluation:{...result.assemblyEvaluation,compaction:{...compaction,
      instructionDiagramCount:steps.length,collapsedStepCount:compaction.sourceStepCount-steps.length,
      mergedDiagramCount:steps.filter(s=>s.sourceStepIds.length>1).length}}}:{})};
}
