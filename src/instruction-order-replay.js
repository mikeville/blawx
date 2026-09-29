import {createGuideSections} from './guide-sections.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&sameSet(s.newBrickIds,s.highlightBrickIds);


function references(plan,steps){
  return {...plan,steps,stats:{...plan.stats,planReferenceCount:steps.reduce((n,s)=>n+s.visibleBrickIds.length+s.highlightBrickIds.length+s.newBrickIds.length,0)}};
}

export function replayInstructionOrder(result,to,end,ordered){
  const old=result.instructionPlan.steps.slice(to,end);
  if(!sameSet(ordered.map(s=>s.id),old.map(s=>s.id)))return null;
  return replayInstructionActions(result,to,end,ordered);
}

/** Repartition whole canonical operations without rewriting their payloads. */
export function replayInstructionActions(result,to,end,ordered){
  const plan=result.instructionPlan,old=plan.steps.slice(to,end),byId=new Map(plan.bricks.map(b=>[b.id,b]));
  if(!old.length||!ordered.length||!sameSet(ordered.flatMap(s=>s.newBrickIds),old.flatMap(s=>s.newBrickIds))
    ||!sameSet(ordered.flatMap(s=>s.sourceStepIds),old.flatMap(s=>s.sourceStepIds)))return null;
  const outside=new Set([...plan.steps.slice(0,to),...plan.steps.slice(end)].map(s=>s.id));
  if(new Set(ordered.map(s=>s.id)).size!==ordered.length||ordered.some(s=>outside.has(s.id)))return null;
  const allIds=old.flatMap(s=>s.newBrickIds),range=new Set(allIds);
  if(range.size!==allIds.length)return null;
  const visible=old[0].visibleBrickIds.filter(id=>!range.has(id)),scene=visible.map(id=>byId.get(id));
  const sourceMap=new Map(result.assemblyPlan.steps.map(s=>[s.id,s])),sourceIds=old.flatMap(s=>s.sourceStepIds);
  const start=result.assemblyPlan.steps.findIndex(s=>s.id===sourceIds[0]);
  if(start<0||result.assemblyPlan.steps.slice(start,start+sourceIds.length).some((s,i)=>s.id!==sourceIds[i]))return null;
  const canonical=[],diagrams=[];
  for(const diagram of ordered){
    const sources=diagram.sourceStepIds.map(id=>sourceMap.get(id));
    if(sources.some(s=>!s||!clean(s))||!sameSet(sources.flatMap(s=>s.newBrickIds),diagram.newBrickIds))return null;
    for(const s of sources){
      const prior=s.visibleBrickIds.filter(id=>!s.newBrickIds.includes(id)).map(id=>byId.get(id));
      for(const id of s.newBrickIds){
        const b=byId.get(id),supports=scene.filter(p=>p.y===b.y-1&&overlap(p,b)).map(p=>p.id);
        if(!supports.length||!sameSet(supports,prior.filter(p=>p.y===b.y-1&&overlap(p,b)).map(p=>p.id))
          ||scene.some(p=>p.y>b.y&&overlap(p,b))||visible.includes(id))return null;
        visible.push(id);scene.push(b);
      }
      canonical.push({...s,visibleBrickIds:[...visible]});
    }
    diagrams.push({...diagram,visibleBrickIds:[...visible]});
  }
  if(!sameSet(visible,old.at(-1).visibleBrickIds))return null;
  const instructionPlan=references(plan,[...plan.steps.slice(0,to),...diagrams,...plan.steps.slice(end)]);
  const assemblyPlan=references(result.assemblyPlan,[...result.assemblyPlan.steps.slice(0,start),...canonical,...result.assemblyPlan.steps.slice(start+sourceIds.length)]);
  if(JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id)))return null;
  return {...result,instructionPlan,assemblyPlan,guide:createGuideSections(instructionPlan)};
}

