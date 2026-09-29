import {placementFootprint, facesTouch} from './placement-groups.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';

const brickOverlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const contains=(a,b)=>a.minX<=b.minX&&a.maxX>=b.maxX&&a.minZ<=b.minZ&&a.maxZ>=b.maxZ;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const course=(step,byId)=>byId.get(step.newBrickIds[0]).y;

function cleanAddition(step,byId,ordinary=false){
  return step.kind==='build'&&step.newBrickIds.length>0&&!step.issues.length
    &&(step.insertionDirection??'down')==='down'
    &&sameSet(step.newBrickIds,step.highlightBrickIds)
    &&(ordinary
      ? !step.buildRegion&&!step.tableRecipe
        &&(!step.instructionAction||['course','feature','surface'].includes(step.instructionAction.kind))
        &&step.newBrickIds.every(id=>byId.get(id).y>0)
      : ['course','feature','surface'].includes(step.instructionAction?.kind)
        &&new Set(step.newBrickIds.map(id=>byId.get(id).y)).size===1);
}

// Existing complete actions are indivisible. Actual stud contacts keep their
// structure together; same-color lateral contacts keep complementary course
// strips together without claiming that side contact is a stud connection.
// Bounding rectangles alone can swallow an independent column in a wall's
// empty corner while splitting that same wall along an arbitrary brick seam.
function actionNeighbors(steps,byId){
  const owner=new Map(steps.flatMap(s=>s.newBrickIds.map(id=>[id,s.id])));
  const bounds=new Map(steps.filter(s=>s.newBrickIds.length).map(s=>[s.id,placementFootprint(s.newBrickIds.map(id=>byId.get(id)))]));
  const bricks=[...owner.keys()].map(id=>byId.get(id)),neighbors=new Map(steps.map(s=>[s.id,new Set()]));
  for(let i=0;i<bricks.length;i++)for(let j=i+1;j<bricks.length;j++){
    const a=bricks[i],b=bricks[j],first=owner.get(a.id),second=owner.get(b.id);
    if(first===second)continue;
    // A differently colored inset belongs with the rim it touches. Mere
    // containment in an empty bounding corner is insufficient.
    const inset=contains(bounds.get(first),bounds.get(second))||contains(bounds.get(second),bounds.get(first));
    if(Math.abs(a.y-b.y)===1&&brickOverlap(a,b)
      ||a.y===b.y&&(a.color===b.color||inset)&&facesTouch(a,b)){
      neighbors.get(first).add(second);neighbors.get(second).add(first);
    }
  }
  return neighbors;
}

function regionsFor(steps,byId,ordinary,neighbors){
  const items=steps.map((step,index)=>({step,index}));
  const pending=new Set(items),regions=[];
  while(pending.size){
    const group=[pending.values().next().value];pending.delete(group[0]);
    for(const item of group)for(const next of pending)if(neighbors.get(item.step.id).has(next.step.id)){group.push(next);pending.delete(next);}
    group.sort((a,b)=>a.index-b.index);
    regions.push({steps:group.map(i=>i.step),indexes:group.map(i=>i.index),
      bounds:placementFootprint(group.flatMap(i=>i.step.newBrickIds.map(id=>byId.get(id))))});
  }
  if(regions.length<2||regions.length>4||regions.some(r=>r.steps.length>18)||regions.filter(r=>new Set(ordinary?r.steps.flatMap(s=>s.newBrickIds.map(id=>byId.get(id).y)):r.steps.map(s=>course(s,byId))).size>1).length<2)return null;
  const owner=new Map(regions.flatMap((r,i)=>r.steps.map(s=>[s.id,i])));
  const visits=steps.reduce((n,s,i)=>n+Number(!i||owner.get(s.id)!==owner.get(steps[i-1].id)),0);
  const returns=visits-regions.length;
  return returns>0?{regions,returns}:null;
}

function permutations(items){
  if(!items.length)return [[]];
  return items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j)).map(tail=>[item,...tail]));
}

function updateReferences(plan,steps){
  return {...plan,steps,stats:{...plan.stats,
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}

function viewQuality(plan){
  const views=chooseInstructionSequence(plan);
  return {turns:[...views.values()].filter(v=>v.turned).length,
    unreadable:[...views.values()].filter(v=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).length,
    unreadableStepIds:[...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id)};
}

/** Replay literal validated operations, retaining each diagram's exact additions. */
function replayRegionOrder(result,start,end,order,byId,ordinary){
  const old=result.instructionPlan.steps.slice(start,end),replacement=order.flatMap(r=>r.steps);
  const rangeIds=new Set(old.flatMap(s=>s.newBrickIds));
  const initial=old[0].visibleBrickIds.filter(id=>!rangeIds.has(id));
  const sourceById=new Map(result.assemblyPlan.steps.map(s=>[s.id,s]));
  const oldSources=old.flatMap(s=>s.sourceStepIds),sources=replacement.flatMap(s=>s.sourceStepIds);
  if(!sameSet(sources,oldSources))throw Error('Region scheduling changed source operations');
  const sourceStart=result.assemblyPlan.steps.findIndex(s=>s.id===oldSources[0]);
  if(sourceStart<0||result.assemblyPlan.steps.slice(sourceStart,sourceStart+oldSources.length).some((s,i)=>s.id!==oldSources[i])){
    throw Error('Region source operations are not consecutive');
  }
  const scene=initial.map(id=>byId.get(id)),visible=[...initial],newSources=[],newDiagrams=[];
  for(const [regionIndex,region]of order.entries())for(const [index,diagram]of region.steps.entries()){
    const canonical=diagram.sourceStepIds.map(id=>sourceById.get(id));
    if(!sameSet(canonical.flatMap(s=>s.newBrickIds),diagram.newBrickIds))throw Error('Diagram does not match its canonical additions');
    for(const step of canonical){
      if(!cleanAddition(step,byId,ordinary))throw Error('Region contains a protected operation');
      const original=step.visibleBrickIds.filter(id=>!step.newBrickIds.includes(id)).map(id=>byId.get(id));
      for(const id of step.newBrickIds){
        const b=byId.get(id);
        const supports=scene.filter(p=>p.y===b.y-1&&brickOverlap(p,b)).map(p=>p.id);
        const expected=original.filter(p=>p.y===b.y-1&&brickOverlap(p,b)).map(p=>p.id);
        if(!supports.length||!sameSet(supports,expected))throw Error('Region placement changes stud support');
        if(scene.some(p=>p.y>b.y&&brickOverlap(p,b)))throw Error('Completed region blocks insertion');
        if(visible.includes(id))throw Error('Region repeats a placement');
        scene.push(b);visible.push(id);
      }
      newSources.push({...step,visibleBrickIds:[...visible]});
    }
    newDiagrams.push({...diagram,visibleBrickIds:[...visible],...(!ordinary||region.steps.length>1?{buildRegion:{
      id:`${diagram.moduleId}-region-${start}-${regionIndex+1}`,index:index+1,total:region.steps.length,
      firstStepId:region.steps[0].id,lastStepId:region.steps.at(-1).id}}:{})});
  }
  if(!sameSet(visible,old.at(-1).visibleBrickIds))throw Error('Region completion changes the visible model');
  const instructionPlan=updateReferences(result.instructionPlan,[...result.instructionPlan.steps.slice(0,start),...newDiagrams,...result.instructionPlan.steps.slice(end)]);
  const assemblyPlan=updateReferences(result.assemblyPlan,[...result.assemblyPlan.steps.slice(0,sourceStart),...newSources,
    ...result.assemblyPlan.steps.slice(sourceStart+oldSources.length)]);
  if(JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id))){
    throw Error('Region canonical coverage changed');
  }
  // Later operations see exactly the same completed geometry, so their
  // support, insertion, joins and offline handling remain unchanged.
  return {...result,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

export function scheduleBuildRegions(result){
  return scheduleRegions(result,false);
}

/** Revisit ordinary diagrams after local grouping has established whole actions. */
export function scheduleSupportedBuildRegions(result){
  if(result.supportedRegionScheduling?.selected)return result;
  return scheduleRegions(result,true);
}

function scheduleRegions(result,ordinary){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError||result.brickModel.bricks.length>1000)return result;
  const started=performance.now(),byId=new Map(result.assemblyPlan.bricks.map(b=>[b.id,b]));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(result.assemblyPlan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const steps=result.instructionPlan.steps,proposals=[];
  const neighbors=actionNeighbors(steps,byId);
  const eligible=step=>cleanAddition(step,byId,ordinary);
  const reportKey=ordinary?'supportedRegionScheduling':'regionScheduling';
  // Only inspect complete course boundaries in clean runs. The shared lower
  // platform or a later bridge can remain outside the independently built areas.
  for(let start=0;start<steps.length;start++){
    if(protectedModules.has(steps[start].moduleId)||!eligible(steps[start]))continue;
    if(start&&steps[start-1].moduleId===steps[start].moduleId&&eligible(steps[start-1])
      &&course(steps[start-1],byId)===course(steps[start],byId))continue;
    for(let end=start+1;end<=Math.min(steps.length,start+32);end++){
      const last=steps[end-1];
      if(last.moduleId!==steps[start].moduleId||!eligible(last))break;
      if(end-start<4)continue;
      if(end<steps.length&&steps[end].moduleId===last.moduleId&&eligible(steps[end])&&course(last,byId)===course(steps[end],byId))continue;
      const range=steps.slice(start,end);
      // This fallback repairs legacy runs. A wholly planned feature sequence
      // has already made an intentional choice about completing its courses.
      if(ordinary&&!range.some(s=>!s.instructionAction))continue;
      const candidate=regionsFor(range,byId,ordinary,neighbors);
      if(candidate)proposals.push({start,end,...candidate});
    }
  }
  proposals.sort((a,b)=>b.returns-a.returns||(b.end-b.start)-(a.end-a.start)||a.start-b.start);
  if(!proposals.length)return result;
  const baseline=viewQuality(result.instructionPlan),candidates=[],attempts=[];
  for(const proposal of proposals.slice(0,3))for(const order of permutations(proposal.regions)){
    try{
      const candidate=replayRegionOrder(result,proposal.start,proposal.end,order,byId,ordinary);
      const ordered=order.flatMap(r=>r.steps),downwardTravel=ordered.reduce((n,s,i)=>n+(i?Math.max(0,course(ordered[i-1],byId)-course(s,byId)):0),0);
      candidates.push({candidate,proposal,order,downwardTravel,
        firstChanged:Number(order[0]!==proposal.regions[0])});
    }catch(error){attempts.push(error.message);}
  }
  candidates.sort((a,b)=>b.proposal.returns-a.proposal.returns
    ||a.downwardTravel-b.downwardTravel||a.firstChanged-b.firstChanged||a.proposal.start-b.proposal.start);
  let best;
  // Physical permutations are cheap; render-analysis starts with the most
  // coherent order and stops at the first option preserving camera readability.
  for(const candidate of candidates.slice(0,24)){
    const quality=viewQuality(candidate.candidate.instructionPlan);
    if(quality.unreadable>baseline.unreadable||quality.turns>baseline.turns
      ||candidate.order.some(r=>r.steps.some(s=>quality.unreadableStepIds.includes(s.id)))){
      attempts.push('Region order worsens diagram visibility or camera continuity');continue;
    }
    best={...candidate,quality};break;
  }
  if(!best)return {...result,[reportKey]:{selected:false,rejectionReasons:[...new Set(attempts)]}};
  const elapsed=performance.now()-started;
  return {...best.candidate,[reportKey]:{selected:true,returnsBefore:best.proposal.returns,returnsAfter:0,
    sourceDiagramIds:steps.slice(best.proposal.start,best.proposal.end).map(s=>s.id),
    regions:best.order.map(r=>({stepIds:r.steps.map(s=>s.id),bounds:r.bounds})),
    turnsBefore:baseline.turns,turnsAfter:best.quality.turns,downwardTravel:best.downwardTravel,
    rejectionReasons:[...new Set(attempts)]},
    metrics:{...result.metrics,conversionMs:(result.metrics?.conversionMs??0)+elapsed,
      stageTiming:{...result.metrics?.stageTiming,[ordinary?'supportedRegionSchedulingMs':'regionSchedulingMs']:elapsed}}};
}
