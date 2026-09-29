import {replayInstructionOrder} from './instruction-order-replay.js';
import {chooseInstructionSequence, evaluateInstructionVisibility} from './instruction-visibility.js';
import {recognizeCourseFeature} from './course-features.js';
import {spatialRegions} from './placement-groups.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {createGuideSections} from './guide-sections.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&!s.tableRecipe
  &&s.newBrickIds.length===s.highlightBrickIds.length&&s.newBrickIds.every(id=>s.highlightBrickIds.includes(id));
const ordinary=s=>clean(s)&&!s.instructionAction&&!s.placementTask;
function course(step,byId){
  const bricks=step.newBrickIds.map(id=>byId.get(id)),first=bricks[0];
  return first?.y>0&&bricks.every(b=>b.y===first.y&&b.color===first.color)?bricks:null;
}
function quality(plan){
  const views=chooseInstructionSequence(plan);
  return {views,turns:[...views.values()].filter(v=>v.turned).length,
    unreadable:new Set([...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}

function proposals(plan,byId,protectedModules){
  const candidates=[];
  for(let start=0;start<plan.steps.length;){
    const first=plan.steps[start];let end=start+1;
    if(!clean(first)||protectedModules.has(first.moduleId)){start=end;continue;}
    while(end<plan.steps.length&&plan.steps[end].moduleId===first.moduleId&&clean(plan.steps[end]))end++;
    const pending=new Set(plan.steps.slice(start,end).filter(ordinary).filter(s=>course(s,byId)));
    while(pending.size){
      const seed=pending.values().next().value,bricks=course(seed,byId),group=[seed];pending.delete(seed);
      for(let i=0;i<group.length;i++)for(const step of pending){
        const next=course(step,byId);
        if(next[0].y!==bricks[0].y||next[0].color!==bricks[0].color)continue;
        if(spatialRegions([...group[i].newBrickIds.map(id=>byId.get(id)),...next]).length!==1)continue;
        group.push(step);pending.delete(step);
      }
      group.sort((a,b)=>plan.steps.indexOf(a)-plan.steps.indexOf(b));
      const all=group.flatMap(s=>s.newBrickIds.map(id=>byId.get(id))),regions=new Set(group.filter(s=>s.buildRegion).map(s=>s.buildRegion.id));
      if(group.length<2||all.length>24||regions.size>1||spatialRegions(all).length!==1
        ||!recognizeCourseFeature(all,{completeArea:true,elongatedProfile:true}))continue;
      const from=plan.steps.indexOf(group[0]),to=plan.steps.indexOf(group.at(-1));
      if(to-from>48)continue;
      candidates.push({from,end:to+1,group,course:bricks[0].y});
    }
    start=end;
  }
  return candidates.sort((a,b)=>a.course-b.course||a.from-b.from);
}

function complete(result,proposal,byId,baseline){
  const plan=result.instructionPlan,{from,end,group,course}=proposal,groupIds=new Set(group.map(s=>s.id));
  const owner=new Map(plan.steps.flatMap((s,i)=>s.newBrickIds.map(id=>[id,i]))),needed=new Set();
  const collect=step=>{
    for(const id of step.newBrickIds){
      const b=byId.get(id);
      for(const lower of plan.bricks.filter(p=>p.y===b.y-1&&overlap(p,b))){
        const index=owner.get(lower.id),support=plan.steps[index];
        if(index===undefined)return false;
        if(index<from||groupIds.has(support.id)||needed.has(index))continue;
        // Bring only complete ordinary lower tasks. Accepted actions and other
        // regions cannot be dismantled to make a course look complete.
        if(index>=end||!ordinary(support)||support.buildRegion
          ||support.newBrickIds.some(id=>byId.get(id).y>=course))return false;
        needed.add(index);if(!collect(support))return false;
      }
    }
    return true;
  };
  if(group.some(s=>!collect(s))||needed.size>8)return null;
  const prerequisites=[...needed].sort((a,b)=>a-b).map(i=>plan.steps[i]);
  const movedIds=new Set([...groupIds,...prerequisites.map(s=>s.id)]);
  const ordered=[...prerequisites,...group,...plan.steps.slice(from,end).filter(s=>!movedIds.has(s.id))];
  const moved=replayInstructionOrder(result,from,end,ordered);if(!moved)return null;
  const index=from+prerequisites.length,first=group[0],ids=group.flatMap(s=>s.newBrickIds),bricks=ids.map(id=>byId.get(id));
  const placed=moved.instructionPlan.steps[index+group.length-1];
  const view=evaluateInstructionVisibility({visibleBricks:placed.visibleBrickIds.map(id=>byId.get(id)),
    highlightGroups:bricks.map(b=>({id:b.id,bricks:[b]})),azimuth:baseline.views.get(first.id).azimuth});
  if(!view.passes||view.truncated||view.groups.some(g=>!g.visibleBrickCount))return null;
  const merged={...first,newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:placed.visibleBrickIds,
    sourceStepIds:group.flatMap(s=>s.sourceStepIds),orderedOperations:group.flatMap(s=>s.orderedOperations),
    label:`${first.label.split(' · add ')[0]} · add ${ids.length} bricks`};
  let steps=[...moved.instructionPlan.steps.slice(0,index),merged,...moved.instructionPlan.steps.slice(index+group.length)];
  // Region labels describe consecutive work. If prerequisites interrupt a
  // tentative region, retire that hint; never leave a misleading split range.
  const affected=new Set(group.filter(s=>s.buildRegion).map(s=>s.buildRegion.id));
  for(const id of affected){
    const positions=steps.flatMap((s,i)=>s.buildRegion?.id===id?[i]:[]),contiguous=positions.at(-1)-positions[0]+1===positions.length;
    const indexes=new Map(positions.map((pos,i)=>[pos,i+1]));
    steps=steps.map((s,i)=>{
      if(!indexes.has(i))return s;
      if(!contiguous){const {buildRegion,...rest}=s;return rest;}
      return {...s,buildRegion:{...s.buildRegion,index:indexes.get(i),total:positions.length,
        firstStepId:steps[positions[0]].id,lastStepId:steps[positions.at(-1)].id}};
    });
  }
  const instructionPlan={...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
  const after=quality(instructionPlan);
  if(after.turns>baseline.turns||after.unreadable.has(first.id)
    ||[...after.unreadable].some(id=>!baseline.unreadable.has(id)))return null;
  return {...moved,instructionPlan,guide:createGuideSections(instructionPlan),change:{stepId:first.id,
    sourceDiagramIds:group.map(s=>s.id),prerequisiteStepIds:prerequisites.map(s=>s.id),course,pieceCount:ids.length,
    fromIndex:from,endIndex:end,turnsBefore:baseline.turns,turnsAfter:after.turns}};
}

/** Complete connected courses, including the lower support work they require. */
export function completeSupportedCourses(result){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError||result.courseCompletion?.selected
    ||result.instructionPlan.bricks.length>1000)return result;
  const byId=new Map(result.instructionPlan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(result.instructionPlan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  let current=result,attempts=0;const changes=[];
  for(let pass=0;pass<8&&attempts<24;pass++){
    const options=proposals(current.instructionPlan,byId,protectedModules);if(!options.length)break;
    const baseline=quality(current.instructionPlan);let selected;
    for(const proposal of options){
      if(++attempts>24)break;
      selected=complete(current,proposal,byId,baseline);if(selected)break;
    }
    if(!selected)break;
    const {change,...next}=selected;current=next;changes.push(change);
  }
  if(!changes.length)return result;
  const compaction=current.assemblyEvaluation?.compaction;
  return {...current,courseCompletion:{selected:true,beforeDiagrams:result.instructionPlan.steps.length,
    afterDiagrams:current.instructionPlan.steps.length,changes},
    ...(compaction?{assemblyEvaluation:{...current.assemblyEvaluation,compaction:{...compaction,
      instructionDiagramCount:current.instructionPlan.steps.length,
      collapsedStepCount:current.assemblyPlan.steps.length-current.instructionPlan.steps.length,
      mergedDiagramCount:current.instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length}}}:{})};
}
