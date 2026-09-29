import {chooseInstructionSequence} from './instruction-visibility.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {replayInstructionOrder} from './instruction-order-replay.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&sameSet(s.newBrickIds,s.highlightBrickIds);

function detailKey(step,byId,bricks){
  if(!clean(step)||step.instructionAction||step.buildRegion||step.tableRecipe||step.placementTask
    ||step.newBrickIds.length>12)return null;
  const added=step.newBrickIds.map(id=>byId.get(id)),ids=new Set(step.newBrickIds);
  if(added.some(b=>b.y===0)||new Set(added.map(b=>b.y)).size>3)return null;
  // A finished detail has no further placements above it. Do not pull forward
  // a fragment of a wall or split work that continues into a larger assembly.
  if(added.some(b=>bricks.some(p=>!ids.has(p.id)&&p.y>b.y&&overlap(p,b))))return null;
  const connected=new Set([added[0]]);
  for(const b of connected)for(const p of added){
    if(Math.abs(b.y-p.y)===1&&overlap(b,p))connected.add(p);
  }
  if(connected.size!==added.length)return null;
  const minX=Math.min(...added.map(b=>b.x)),minZ=Math.min(...added.map(b=>b.z));
  return JSON.stringify(added.map(b=>[b.x-minX,b.y,b.z-minZ,b.w,b.d,b.color]).sort());
}


function views(plan){
  const sequence=chooseInstructionSequence(plan);
  return {turns:[...sequence.values()].filter(v=>v.turned).length,
    unreadable:new Set([...sequence].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}

/** Bring a delayed complete detail beside an identical earlier placement. */
export function scheduleRepeatedDetails(result){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError||result.repeatedDetailScheduling?.selected
    ||result.instructionPlan.bricks.length>1000)return result;
  const plan=result.instructionPlan,byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1)
    .flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const keys=plan.steps.map(s=>protectedModules.has(s.moduleId)?null:detailKey(s,byId,plan.bricks)),proposals=[];
  for(let from=0;from<plan.steps.length;from++){
    if(!keys[from])continue;
    for(let anchor=from-4;anchor>=0;anchor--){
      if(plan.steps[anchor].moduleId!==plan.steps[from].moduleId)break;
      if(keys[anchor]!==keys[from])continue;
      const range=plan.steps.slice(anchor+1,from+1);
      if(range.length>96||range.some(s=>!clean(s)||s.moduleId!==plan.steps[from].moduleId||s.tableRecipe))continue;
      proposals.push({from,to:anchor+1,anchor});break;
    }
  }
  proposals.sort((a,b)=>(b.from-b.to)-(a.from-a.to)||a.from-b.from);
  if(!proposals.length)return result;
  const baseline=views(plan);
  for(const {from,to,anchor}of proposals.slice(0,8)){
    const range=plan.steps.slice(to,from+1);
    const candidate=replayInstructionOrder(result,to,from+1,[range.at(-1),...range.slice(0,-1)]);if(!candidate)continue;
    const quality=views(candidate.instructionPlan),movedId=plan.steps[from].id;
    if(quality.turns>baseline.turns||quality.unreadable.has(movedId)
      ||[...quality.unreadable].some(id=>!baseline.unreadable.has(id)))continue;
    return {...candidate,repeatedDetailScheduling:{selected:true,stepId:movedId,
      matchingStepId:plan.steps[anchor].id,fromIndex:from,toIndex:to,
      turnsBefore:baseline.turns,turnsAfter:quality.turns}};
  }
  return result;
}
