import {replayInstructionOrder} from './instruction-order-replay.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {createGuideSections} from './guide-sections.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&s.newBrickIds.length===s.highlightBrickIds.length
  &&s.newBrickIds.every(id=>s.highlightBrickIds.includes(id));
const ordinary=s=>clean(s)&&!s.instructionAction&&!s.buildRegion&&!s.tableRecipe&&!s.placementTask;

function course(step,byId){
  const bricks=step.newBrickIds.map(id=>byId.get(id));
  if(!bricks.length||new Set(bricks.map(b=>b.y)).size!==1||new Set(bricks.map(b=>b.color)).size!==1)return null;
  return {y:bricks[0].y,color:bricks[0].color,bricks};
}
function quality(plan){
  const views=chooseInstructionSequence(plan);
  return {turns:[...views.values()].filter(v=>v.turned).length,
    unreadable:new Set([...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}

/** Continue a started area when every new support belongs to that same chain. */
export function scheduleAreaContinuations(result){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError||result.areaContinuationScheduling?.selected
    ||result.instructionPlan.bricks.length>1000)return result;
  const plan=result.instructionPlan,byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1)
    .flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const owner=new Map(plan.steps.flatMap((s,i)=>s.newBrickIds.map(id=>[id,i]))),proposals=[];
  for(let from=0;from<plan.steps.length;from++){
    const first=plan.steps[from],layer=course(first,byId);
    if(protectedModules.has(first.moduleId)||!ordinary(first)||!layer||!layer.y)continue;
    const supports=layer.bricks.flatMap(b=>plan.bricks.filter(p=>p.y===b.y-1&&overlap(p,b)));
    const origins=new Set(supports.map(b=>owner.get(b.id)));
    if(origins.size!==1)continue;
    const anchor=[...origins][0];if(anchor===undefined||from-anchor<4||from-anchor>64)continue;
    const base=plan.steps[anchor],baseLayer=course(base,byId);
    if(!clean(base)||!baseLayer||base.moduleId!==first.moduleId||baseLayer.color!==layer.color
      ||baseLayer.y!==layer.y-1||base.tableRecipe
      ||base.buildRegion&&base.buildRegion.index!==base.buildRegion.total)continue;
    // A completed region or deliberate action remains a unit. Only attach at
    // its end, and never move its existing steps around to make room.
    if(base.instructionAction&&!['feature','course','surface'].includes(base.instructionAction.kind))continue;
    if(base.instructionAction?.id&&plan.steps[anchor+1]?.instructionAction?.id===base.instructionAction.id)continue;
    const available=new Set(base.newBrickIds);let end=from,previous=layer.y,count=0;
    for(;end<Math.min(plan.steps.length,from+12);end++){
      const step=plan.steps[end],next=course(step,byId);
      if(!ordinary(step)||step.moduleId!==first.moduleId||!next||next.color!==layer.color
        ||next.y<previous||next.y>previous+1||next.y-layer.y>5||count+next.bricks.length>72)break;
      if(next.bricks.some(b=>{
        const lower=plan.bricks.filter(p=>p.y===b.y-1&&overlap(p,b));
        return !lower.length||lower.some(p=>!available.has(p.id));
      }))break;
      count+=next.bricks.length;previous=next.y;for(const b of next.bricks)available.add(b.id);
    }
    if(end-from<2||previous===layer.y)continue;
    const crossed=plan.steps.slice(anchor+1,from);
    if(crossed.some(s=>s.moduleId!==first.moduleId||!clean(s)||s.tableRecipe))continue;
    // Avoid presenting a cap-limited fragment as the complete continuation.
    const following=plan.steps[end],next=following&&course(following,byId);
    if(following&&ordinary(following)&&following.moduleId===first.moduleId&&next?.color===layer.color)continue;
    proposals.push({from,end,anchor});
  }
  proposals.sort((a,b)=>(b.end-b.from)-(a.end-a.from)||(b.from-b.anchor)-(a.from-a.anchor)||a.from-b.from);
  if(!proposals.length)return result;
  const baseline=quality(plan);
  for(const {from,end,anchor}of proposals.slice(0,8)){
    const to=anchor+1,run=plan.steps.slice(from,end),crossed=plan.steps.slice(to,from);
    const moved=replayInstructionOrder(result,to,end,[...run,...crossed]);if(!moved)continue;
    const view=quality(moved.instructionPlan);
    if(view.turns>baseline.turns||run.some(s=>view.unreadable.has(s.id))
      ||[...view.unreadable].some(id=>!baseline.unreadable.has(id)))continue;
    const priorRegion=plan.steps[anchor].buildRegion;
    const regionSteps=priorRegion?plan.steps.filter(s=>s.buildRegion?.id===priorRegion.id):[plan.steps[anchor]];
    const ids=[...regionSteps.map(s=>s.id),...run.map(s=>s.id)],indexes=new Map(ids.map((id,i)=>[id,i+1]));
    const instructionPlan={...moved.instructionPlan,steps:moved.instructionPlan.steps.map(s=>indexes.has(s.id)?{...s,
      buildRegion:{id:priorRegion?.id??`${s.moduleId}-continuation-${anchor}`,index:indexes.get(s.id),total:ids.length,
        firstStepId:ids[0],lastStepId:ids.at(-1)}}:s)};
    return {...moved,instructionPlan,guide:createGuideSections(instructionPlan),areaContinuationScheduling:{selected:true,
      fromIndex:from,toIndex:to,endIndex:end,anchorStepId:plan.steps[anchor].id,stepIds:run.map(s=>s.id),
      regionStepIds:ids,turnsBefore:baseline.turns,turnsAfter:view.turns}};
  }
  return result;
}
