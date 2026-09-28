import {createPlacementGroups, facesTouch, placementFootprint} from './placement-groups.js';

const overlaps = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.z < b.z+b.d && b.z < a.z+a.d;

// An action is a single course with an explicit endpoint. A foundation strip
// and the course that ties it together remain separate, consecutive actions.
function courseRows(items, axis, reverse=false) {
  const span=axis==='x'?'w':'d';
  const leading=b=>reverse?-(b[axis]+b[span]):b[axis];
  const ordered=[...items].sort((a,b)=>leading(a)-leading(b)||a.z-b.z||a.x-b.x);
  const rows=[];
  for(const brick of ordered) {
    const last=rows.at(-1);
    if(last && leading(last[0])===leading(brick)) last.push(brick);
    else rows.push([brick]);
  }
  const groups=[];
  for(const row of rows) {
    const previous=groups.at(-1),combined=previous?[...previous,...row]:row;
    const bounds=placementFootprint(combined);
    const depth=Math.max(...combined.map(b=>b[axis]+b[span]))-Math.min(...combined.map(b=>b[axis]));
    if(previous&&combined.length<=12&&depth<=4&&bounds.width<=12&&bounds.depth<=12) previous.push(...row);
    else groups.push(row);
  }
  return groups.flatMap(group=>{
    const bounds=placementFootprint(group);
    return group.length<=12&&bounds.width<=12&&bounds.depth<=12
      ? [group.map(b=>b.id)] : createPlacementGroups(group);
  });
}

function completeCourseGroups(items) {
  const candidates=['z','x'].flatMap(axis=>[false,true].map(reverse=>courseRows(items,axis,reverse)));
  const byId=new Map(items.map(b=>[b.id,b]));
  const partVariety=groups=>groups.reduce((sum,ids)=>sum+new Set(ids.map(id=>{
    const b=byId.get(id);return `${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`;
  })).size,0);
  candidates.sort((a,b)=>a.filter(g=>g.length===1).length-b.filter(g=>g.length===1).length
    ||a.length-b.length||partVariety(a)-partVariety(b));
  return candidates[0];
}

export function planAssemblyActions(bricks, {axis='z', reverse=false, width=4, workSurface=false}={}) {
  const floor = Math.min(...bricks.map(b=>b.y));
  const pending = new Set(bricks);
  const actions = [];
  const coordinate = b => reverse ? -(b[axis]+(axis==='x'?b.w:b.d)) : b[axis];
  const order = (a,b) => a.y-b.y || coordinate(a)-coordinate(b) || a.z-b.z || a.x-b.x;
  function emit(items, kind) {
    if (!items.length) return;
    const byId=new Map(items.map(b=>[b.id,b]));
    // Small complete courses and foundation layouts are deliberate endpoints,
    // even when a contour is irregular or studs do not yet join the floor.
    const bounds=placementFootprint(items);
    const groups=items.length<=8 && bounds.width<=12 && bounds.depth<=12
      ? [items.sort(order).map(b=>b.id)] : kind==='course' ? completeCourseGroups(items) : createPlacementGroups(items);
    for(const ids of groups) {
      actions.push({kind,brickIds:ids});
      for(const id of ids) pending.delete(byId.get(id));
    }
  }
  if (workSurface) {
    while([...pending].some(b=>b.y===floor+1)) {
      const upper=[...pending].filter(b=>b.y===floor+1).sort((a,b)=>coordinate(a)-coordinate(b)||order(a,b));
      const lowerFor=patch=>[...pending].filter(b=>b.y===floor && patch.some(top=>overlaps(b,top)));
      const attached=patch=>bricks.some(b=>!pending.has(b)&&b.y===floor&&patch.some(top=>overlaps(b,top)));
      const hasUpper=bricks.some(b=>b.y===floor+1&&!pending.has(b));
      const candidates=[];
      for(const seed of upper) {
        let patch=[seed];
        if(hasUpper&&!attached(patch)) continue;
        for(let size=1;size<6;size++) {
          const additions=upper.filter(b=>!patch.includes(b)&&patch.some(a=>facesTouch(a,b)))
            .map(b=>({b,bounds:placementFootprint([...patch,b]),lower:lowerFor([...patch,b])}))
            .filter(c=>c.lower.length<=width && c.bounds.width<=12 && c.bounds.depth<=12)
            .sort((a,b)=>b.bounds.fill-a.bounds.fill||coordinate(a.b)-coordinate(b.b)||order(a.b,b.b));
          if(!additions.length) break;
          patch.push(additions[0].b);
        }
        const bounds=placementFootprint(patch),lower=lowerFor(patch);
        if(lower.length>width) continue;
        // Prefer complete straight runs, enough progress to avoid tiny tails,
        // and a small number of prerequisites over a greedy single bond.
        const score=patch.length*3+bounds.fill*5-lower.length*.5;
        candidates.push({patch,lower,score});
      }
      candidates.sort((a,b)=>b.score-a.score||coordinate(a.patch[0])-coordinate(b.patch[0]));
      const choice=candidates[0];
      if(!choice) throw new RangeError('No connected foundation action fits the handling bound.');
      emit(choice.lower,'foundation');
      emit(choice.patch,'bond');
    }
  }
  while(pending.size) {
    const first=[...pending].sort(order)[0];
    emit([...pending].filter(b=>b.y===first.y),'course');
  }
  return actions;
}

export function actionReplay(module, bricks, options={}) {
  const actions=planAssemblyActions(bricks,{...options,workSurface:module.buildContext?.kind==='work-surface'});
  return {...module,actionOrder:true,actions,
    placementGroups:actions.map(a=>a.brickIds),brickOrder:actions.flatMap(a=>a.brickIds),
    ...(module.buildContext?{buildContext:{...module.buildContext,orderPolicy:'planned-actions'}}:{})};
}

export function annotateActions(plan, replay) {
  const actions=new Map(replay.flatMap(m=>(m.actions??[]).flatMap((a,i)=>a.brickIds.map(id=>[id,{id:`${m.id}-action-${i+1}`,kind:a.kind,
    ...(a.destination ? {destination:a.destination} : {})}]))));
  return {...plan,steps:plan.steps.map(s=>{
    const a=actions.get(s.newBrickIds[0]);
    return a && s.newBrickIds.every(id=>actions.get(id)?.id===a.id) ? {...s,instructionAction:a} : s;
  })};
}

export function assessActionSequence(plan) {
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const builds=plan.steps.filter(s=>s.kind==='build'&&s.newBrickIds.length);
  return {
    mixedCourseSteps:builds.filter(s=>new Set(s.newBrickIds.map(id=>byId.get(id).y)).size>1).length,
    singlePieceSteps:builds.filter(s=>s.newBrickIds.length===1).length,
    diagrams:plan.steps.length,
  };
}

export function actionCompletionRejections(plan) {
  const seenByModule=new Map(),reasons=[];
  for(let i=0;i<plan.steps.length;i++) {
    const step=plan.steps[i];
    if(!seenByModule.has(step.moduleId)) seenByModule.set(step.moduleId,new Set());
    const seen=seenByModule.get(step.moduleId);
    step.newBrickIds.forEach(id=>seen.add(id));
    if(!['bond','complete-band','complete-layer'].includes(step.instructionAction?.kind)
      ||plan.steps[i+1]?.instructionAction?.id===step.instructionAction.id) continue;
    const adjacency=new Map([...seen].map(id=>[id,[]]));
    for(const {a,b} of plan.graph.edges) if(seen.has(a)&&seen.has(b)) {
      adjacency.get(a).push(b);adjacency.get(b).push(a);
    }
    const connected=new Set([seen.values().next().value]);
    for(const id of connected) for(const neighbor of adjacency.get(id)) connected.add(neighbor);
    if(connected.size!==seen.size) reasons.push('Connecting action leaves disconnected foundation pieces');
  }
  return [...new Set(reasons)];
}
