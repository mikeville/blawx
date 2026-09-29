import {proposeCourseFeatures,recognizeCourseFeature} from './course-features.js';
import {spatialRegions} from './placement-groups.js';
import {replayInstructionActions} from './instruction-order-replay.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {deriveGuidePresentation} from './guide-presentation.js';

const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length&&!s.tableRecipe
  &&(s.insertionDirection??'down')==='down'&&s.newBrickIds.length===s.highlightBrickIds.length
  &&s.newBrickIds.every(id=>s.highlightBrickIds.includes(id));
const ordinary=s=>clean(s)&&!s.instructionAction&&!s.buildRegion&&!s.placementTask;
function layers(step,byId){
  if(!ordinary(step))return null;
  const bricks=step.newBrickIds.map(id=>byId.get(id)),ys=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b);
  if(ys[0]===0)return null;
  if(ys.length===1&&new Set(bricks.map(b=>b.color)).size>1)return {y:ys[0],lower:[],upper:bricks};
  if(ys.length!==2||ys[1]!==ys[0]+1)return null;
  return {y:ys[0],lower:bricks.filter(b=>b.y===ys[0]),upper:bricks.filter(b=>b.y===ys[1])};
}
function quality(plan){
  const views=chooseInstructionSequence(plan);
  return {turns:[...views.values()].filter(v=>v.turned).length,
    bad:new Set([...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}
function candidates(plan,byId,protectedModules){
  const choices=[];
  for(let start=0;start<plan.steps.length;){
    const first=plan.steps[start];let end=start+1;
    if(!clean(first)||protectedModules.has(first.moduleId)){start=end;continue;}
    while(end<plan.steps.length&&plan.steps[end].moduleId===first.moduleId&&clean(plan.steps[end]))end++;
    const pending=new Set(plan.steps.slice(start,end).map(step=>({step,layers:layers(step,byId)})).filter(s=>s.layers));
    while(pending.size){
      const seed=pending.values().next().value,group=[seed];pending.delete(seed);
      for(const item of group)for(const next of pending){
        if(next.layers.y===seed.layers.y&&Boolean(next.layers.lower.length)===Boolean(seed.layers.lower.length)&&spatialRegions([...item.layers.upper,...next.layers.upper]).length===1){
          group.push(next);pending.delete(next);
        }
      }
      group.sort((a,b)=>plan.steps.indexOf(a.step)-plan.steps.indexOf(b.step));
      const lower=group.flatMap(g=>g.layers.lower),upper=group.flatMap(g=>g.layers.upper);
      if(group.length<2||group.length>6||lower.length+upper.length>64
        ||(lower.length&&recognizeCourseFeature(lower)!=='pattern')||spatialRegions(upper).length!==1)continue;
      const from=plan.steps.indexOf(group[0].step),to=plan.steps.indexOf(group.at(-1).step);
      if(to-from>32)continue;
      choices.push({from,end:to+1,steps:group.map(g=>g.step),lower,upper});
    }
    start=end;
  }
  return choices.sort((a,b)=>b.steps.length-a.steps.length||a.from-b.from);
}

function repartition(result,choice,byId){
  const {from,end,steps,lower,upper}=choice,plan=result.instructionPlan;
  const groupIds=new Set(steps.map(s=>s.id)),newIds=new Set([...lower,...upper].map(b=>b.id));
  const owner=new Map(plan.steps.flatMap((s,i)=>s.newBrickIds.map(id=>[id,i]))),needed=new Set();
  const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
  const bottom=Math.min(...[...lower,...upper].map(b=>b.y));
  const collect=step=>{
    for(const id of step.newBrickIds){
      const brick=byId.get(id);
      for(const support of plan.bricks.filter(b=>b.y===brick.y-1&&overlaps(b,brick))){
        const index=owner.get(support.id),task=plan.steps[index];
        if(index===undefined)return false;
        if(index<from||groupIds.has(task.id)||needed.has(index))continue;
        if(index>=end||!ordinary(task)||task.newBrickIds.some(id=>byId.get(id).y>=bottom))return false;
        needed.add(index);if(!collect(task))return false;
      }
    }
    return true;
  };
  if(steps.some(s=>!collect(s))||needed.size>8)return null;
  const prerequisites=[...needed].sort((a,b)=>a-b).map(i=>plan.steps[i]);
  const initial=steps[0].visibleBrickIds.filter(id=>!newIds.has(id));
  const scene=[...initial.map(id=>byId.get(id)),...prerequisites.flatMap(s=>s.newBrickIds.map(id=>byId.get(id)))],features=[];
  for(const layer of [lower,upper].filter(layer=>layer.length)){
    const groups=proposeCourseFeatures(layer,scene,{completeArea:true,contextualPanels:true});if(!groups)return null;
    const rank=new Map(layer.map((b,i)=>[b.id,i]));
    groups.sort((a,b)=>Math.min(...a.brickIds.map(id=>rank.get(id)))-Math.min(...b.brickIds.map(id=>rank.get(id))));
    features.push(...groups.map(g=>({...g,course:layer[0].y})));scene.push(...layer);
  }
  if(features.length>steps.length)return null;
  const sourceMap=new Map(result.assemblyPlan.steps.map(s=>[s.id,s])),sources=steps.flatMap(s=>s.sourceStepIds.map(id=>sourceMap.get(id)));
  if(sources.some(s=>!s||!ordinary(s)))return null;
  const operations=new Map(steps.flatMap(s=>s.orderedOperations.map(o=>[o.id,o]))),diagrams=[];
  for(const [i,feature]of features.entries()){
    const ids=new Set(feature.brickIds),owned=sources.filter(s=>s.newBrickIds.some(id=>ids.has(id)));
    // A source operation is indivisible. Never split its additions just to
    // obtain a cleaner drawing or rewrite the original support history.
    if(owned.some(s=>s.newBrickIds.some(id=>!ids.has(id)))||owned.reduce((n,s)=>n+s.newBrickIds.length,0)!==ids.size)return null;
    const sourceIds=owned.map(s=>s.id),brickIds=owned.flatMap(s=>s.newBrickIds);
    diagrams.push({...steps[0],id:`${steps[0].id}-task-${i+1}`,newBrickIds:brickIds,highlightBrickIds:[...brickIds],
      sourceStepIds:sourceIds,orderedOperations:sourceIds.map(id=>operations.get(id)),
      instructionAction:{id:`${steps[0].id}-task-action-${i+1}`,kind:'feature',destination:{kind:feature.kind,course:feature.course}},
      label:`${steps[0].label.split(' · add ')[0]} · add ${brickIds.length} bricks`});
  }
  const moved=replayInstructionActions(result,from,end,[...prerequisites,...diagrams,
    ...plan.steps.slice(from,end).filter((s,i)=>!groupIds.has(s.id)&&!needed.has(from+i))]);
  if(!moved)return null;
  const instructionPlan={...moved.instructionPlan,stats:{...moved.instructionPlan.stats,stepCount:moved.instructionPlan.steps.length,
    maxBricksPerStep:Math.max(...moved.instructionPlan.steps.map(s=>s.newBrickIds.length))}};
  return {...moved,instructionPlan,change:{oldStepIds:steps.map(s=>s.id),newStepIds:diagrams.map(s=>s.id),
    fromIndex:from,endIndex:end,prerequisiteStepIds:prerequisites.map(s=>s.id),features:features.map(f=>({kind:f.kind,course:f.course,pieceCount:f.brickIds.length}))}};
}

/** Complete mixed courses and the lower support tasks their shared features require. */
export function refineMixedCourseTasks(result){
  const plan=result.instructionPlan;
  if(!plan||!result.assemblyPlan||result.assemblyError||result.mixedCourseTaskRefinement?.selected||plan.bricks.length>1000)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1)
    .flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  let current=result,attempts=0;const changes=[];
  for(let pass=0;pass<4&&attempts<24;pass++){
    const options=candidates(current.instructionPlan,byId,protectedModules);if(!options.length)break;
    const before=quality(current.instructionPlan);let accepted;
    for(const choice of options){
      if(++attempts>24)break;
      const candidate=repartition(current,choice,byId);if(!candidate)continue;
      const after=quality(candidate.instructionPlan);
      if(after.turns>before.turns||candidate.change.newStepIds.some(id=>after.bad.has(id))
        ||[...after.bad].some(id=>!before.bad.has(id)))continue;
      accepted=candidate;changes.push({...candidate.change,turnsBefore:before.turns,turnsAfter:after.turns});break;
    }
    if(!accepted)break;
    const {change,...selected}=accepted;current=selected;
  }
  if(!changes.length)return result;
  const compaction=result.assemblyEvaluation?.compaction;
  return {...current,mixedCourseTaskRefinement:{selected:true,...changes[0],changes,
    beforeDiagrams:plan.steps.length,afterDiagrams:current.instructionPlan.steps.length,turnsAfter:changes.at(-1).turnsAfter},
    ...(compaction?{assemblyEvaluation:{...result.assemblyEvaluation,compaction:{...compaction,
      instructionDiagramCount:current.instructionPlan.steps.length,
      collapsedStepCount:current.assemblyPlan.steps.length-current.instructionPlan.steps.length,
      mergedDiagramCount:current.instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length}}}:{})};
}
