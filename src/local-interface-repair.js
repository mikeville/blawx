import {proposeAttachmentCorridors} from './attachment-corridors.js';
import {mapAssemblyModules} from './assembly-module-replay.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {inspectConstruction} from './construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {measureBrickDifference} from './construction-differences.js';
import {unresolvedCells} from './refine-construction.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cellKey=c=>`${c.x},${c.y},${c.z}`;
const covers=(b,c)=>b.y===c.y&&b.x<=c.x&&c.x<b.x+b.w&&b.z<=c.z&&c.z<b.z+b.d;
const cells=bricks=>new Map(bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const issues=entries=>entries.map(i=>({...i,...(i.brickIds?{brickIds:sorted(i.brickIds)}:{})}));

/** Propose covered interfaces, retaining explicit ownership of both assemblies. */
export function discoverLocalInterfaceRepairs(result){
  const plan=result.assemblyPlan;if(!plan)return [];
  const owner=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m.id]))),modules=new Map(plan.modules.map(m=>[m.id,m]));
  const eligible=plan.modules.filter(m=>m.kind==='floating'&&m.brickIds.length>=2&&m.brickIds.length<=24
    &&plan.steps.filter(s=>s.moduleId===m.id).every(s=>!s.nestedRecipe&&(s.insertionDirection??'down')==='down'));
  const targets=new Set(eligible.map(m=>m.id));
  const proposals=proposeAttachmentCorridors(result,{maxAddedCells:4,maxProposals:64}).filter(p=>{
    const anchor=modules.get(owner.get(p.anchorIds[0]));
    return targets.has(owner.get(p.targetIds[0]))&&anchor?.buildContext?.kind==='work-surface'
      &&plan.modules.indexOf(anchor)<plan.modules.findIndex(m=>m.id===owner.get(p.targetIds[0]));
  });
  const options=[];
  for(const target of eligible){
    const bricks=plan.bricks.filter(b=>target.brickIds.includes(b.id));
    const width=Math.max(...bricks.map(b=>b.x+b.w))-Math.min(...bricks.map(b=>b.x)),depth=Math.max(...bricks.map(b=>b.z+b.d))-Math.min(...bricks.map(b=>b.z));
    if(Math.max(width,depth)>16)continue;
    // Reuse only previously proposed one-course supports that still lie in an
    // empty gap between two pieces owned by this same detached assembly.
    const gaps=[...new Map((result.continuityRefinement?.supportCells??[]).map(c=>[cellKey(c),c])).values()].filter(c=>!plan.bricks.some(b=>covers(b,c))
      &&bricks.some(b=>covers(b,{...c,y:c.y-1}))&&bricks.some(b=>b.color===c.color&&covers(b,{...c,y:c.y+1})));
    const candidates=proposals.filter(p=>owner.get(p.targetIds[0])===target.id);
    const combinations=candidates.flatMap((a,i)=>[[a],...candidates.slice(i+1).filter(b=>owner.get(a.anchorIds[0])===owner.get(b.anchorIds[0])
      &&a.anchorIds.every(id=>!b.anchorIds.includes(id))).map(b=>[a,b])]);
    for(const corridors of combinations){
      const added=corridors.flatMap(p=>p.addedCells),axis=width>=depth?'x':'z';
      const span=Math.max(...added.map(c=>c[axis]))-Math.min(...added.map(c=>c[axis]));
      // Wide handled parts need separated contact locations. A single stud at
      // one end can satisfy graph connectivity while leaving a poor attachment.
      if(added.length+gaps.length>8||Math.max(width,depth)>=8&&span<(Math.max(width,depth)-1)/2
        ||bricks.length>4&&added.length<2)continue;
      options.push({targetId:target.id,anchorId:owner.get(corridors[0].anchorIds[0]),corridors,gaps,span});
    }
  }
  return options.sort((a,b)=>a.corridors.flatMap(p=>p.addedCells).length+a.gaps.length-b.corridors.flatMap(p=>p.addedCells).length-b.gaps.length
    ||b.span-a.span||a.corridors.flatMap(p=>p.after).length-b.corridors.flatMap(p=>p.after).length).slice(0,8);
}

export function restoreRepeatedOrder(plan){
  let steps=plan.steps;
  for(const familyId of new Set(plan.modules.flatMap(m=>m.sharedHandledRecipe?[m.sharedHandledRecipe.familyId]:[]))){
    const family=new Set(plan.modules.filter(m=>m.sharedHandledRecipe?.familyId===familyId).map(m=>m.id));
    const start=steps.findIndex(s=>family.has(s.moduleId)),end=steps.findLastIndex(s=>family.has(s.moduleId)),run=steps.slice(start,end+1);
    if(run.some(s=>!family.has(s.moduleId)))throw Error('Repeated recipes have intervening work');
    steps=[...steps.slice(0,start),...run.filter(s=>s.kind==='build'),...run.filter(s=>s.kind==='join'),...steps.slice(end+1)];
  }
  return {...plan,steps};
}

function candidateFor(before,proposal){
  const old=before.assemblyPlan,{corridors,gaps,targetId,anchorId}=proposal;
  const patch={before:corridors.flatMap(p=>p.before),after:corridors.flatMap(p=>p.after)};
  const removed=new Set(patch.before.map(b=>b.id));
  const brickModel={...before.brickModel,bricks:[...old.bricks.filter(b=>!removed.has(b.id)).map(({id,...b})=>b),...patch.after,...gaps.map(c=>({...c,w:1,d:1}))]};
  const identified=createAssemblyPlan({brickModel}).bricks,byKey=new Map(identified.map(b=>[key(b),b])),byId=new Map(identified.map(b=>[b.id,b]));
  const gapIds=gaps.map(c=>byKey.get(key({...c,w:1,d:1})).id);
  const replacements=new Map(corridors.flatMap(p=>p.anchorIds.map(id=>[id,p.after.map(b=>byKey.get(key(b)).id)])));
  const remap=ids=>ids.flatMap(id=>replacements.get(id)??[id]);
  const replay=mapAssemblyModules(old,patch).map(m=>{
    let groups=old.steps.filter(s=>s.moduleId===m.id&&s.newBrickIds.length).map(s=>remap(s.newBrickIds));
    let changed={};
    if(m.id===targetId){
      const bricks=[...m.brickIds,...gapIds].map(id=>byId.get(id)),ys=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b);
      groups=ys.map(y=>bricks.filter(b=>b.y===y).map(b=>b.id));
      changed={kind:'detail',label:'Assembly',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:ys[0],orderPolicy:'planned-actions'}};
    }
    return {...m,...changed,brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(m.buildContext&&!changed.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
  });
  let plan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:old.moduleRecipes??null,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  for(const m of plan.modules){
    const previous=old.modules.find(x=>x.id===m.id);
    for(const field of ['recipeFamily','sharedHandledRecipe'])if(previous[field])m[field]=structuredClone(previous[field]);
    if(previous.repeatContinuation){const oldJoin=old.steps.find(s=>s.id===previous.repeatContinuation.joinSourceStepId),join=plan.steps.find(s=>s.kind==='join'&&s.moduleId===oldJoin?.moduleId);if(join)m.repeatContinuation={...previous.repeatContinuation,joinSourceStepId:join.id};}
    if(m.id===targetId)m.localInterfaceRepair={anchorId};
  }
  plan=restoreRepeatedOrder(plan);
  const compact=compactAssemblyPlan(plan);let candidate={...before,brickModel,assemblyPlan:plan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan)};
  const targetIds=old.modules.find(m=>m.id===targetId).brickIds;
  const adapt=p=>({...p,steps:p.steps.map(s=>({...s,newBrickIds:remap(s.newBrickIds),highlightBrickIds:remap(s.highlightBrickIds),
    visibleBrickIds:[...remap(s.visibleBrickIds),...(s.moduleId!==targetId&&targetIds.every(id=>s.visibleBrickIds.includes(id))?gapIds:[])]}))});
  candidate=retainUnchangedDiagrams({...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)},candidate);
  const completions=new Map(candidate.instructionPlan.steps.filter(s=>s.tableRecipe).map(s=>[s.moduleId,s.id]));
  candidate.instructionPlan={...candidate.instructionPlan,steps:candidate.instructionPlan.steps.map(s=>s.tableRecipe?{...s,tableRecipe:{...s.tableRecipe,completionStepId:completions.get(s.moduleId)}}:s)};
  candidate.guide=createGuideSections(candidate.instructionPlan);
  return candidate;
}

export function contactCells(plan,step){
  const moving=new Set(step.highlightBrickIds),visible=new Set(step.visibleBrickIds),by=new Map(plan.bricks.map(b=>[b.id,b])),contacts=new Set();
  // Context may also display earlier failed pieces. Count the actual validated
  // receiving contacts when supplied, rather than treating those ghosts as
  // supports merely because they touch the completed geometry.
  const edges=step.joinContext?.supportGroups
    ? step.joinContext.supportGroups.flatMap(g=>g.contacts.map(c=>({a:c.supportBrickId,b:c.bandBrickId})))
    : plan.graph.edges;
  for(const {a,b}of edges)if(moving.has(a)!==moving.has(b)&&visible.has(a)&&visible.has(b)){
    const first=by.get(a),second=by.get(b),upper=first.y>second.y?first:second;
    for(let x=Math.max(first.x,second.x);x<Math.min(first.x+first.w,second.x+second.w);x++)for(let z=Math.max(first.z,second.z);z<Math.min(first.z+first.d,second.z+second.d);z++)contacts.add(`${x},${upper.y},${z}:${moving.has(upper.id)?'down':'up'}`);
  }
  return sorted(contacts);
}

function validate(before,after,proposal){
  const old=before.assemblyPlan,plan=after.assemblyPlan,reasons=[],priorCells=cells(old.bricks),nextCells=cells(plan.bricks);
  if([...priorCells].some(([k,color])=>nextCells.get(k)!==color))reasons.push('Old geometry changed');
  const allowed=new Set([...proposal.gaps,...proposal.corridors.flatMap(p=>p.addedCells)].map(cellKey));
  if([...nextCells.keys()].some(k=>!priorCells.has(k)&&!allowed.has(k))||[...allowed].some(k=>priorCells.has(k)||!nextCells.has(k)))reasons.push('Unproposed geometry added');
  const diagnostics=inspectConstruction(after.brickModel);
  if(diagnostics.stats.collisionPairCount||diagnostics.stats.illegalFootprintCount)reasons.push('Invalid brick geometry');
  const previousUnresolved=unresolvedCells(old),nextUnresolved=unresolvedCells(plan);
  if([...nextUnresolved].some(c=>!previousUnresolved.has(c))||nextUnresolved.size>=previousUnresolved.size)reasons.push('Unresolved geometry did not improve');
  const target=plan.steps.filter(s=>s.moduleId===proposal.targetId);
  if(target.some(s=>s.issues.length||!['build','join'].includes(s.kind))||target.filter(s=>s.kind==='join').length!==1)reasons.push('Incomplete handled repair');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const next=plan.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId);
    if(!next||next.issues.length||!same(contactCells(old,join),contactCells(plan,next)))reasons.push('Prior attachment changed');
  }
  const outside=plan=>plan.steps.filter(s=>![proposal.targetId,proposal.anchorId].includes(s.moduleId)).flatMap(s=>s.newBrickIds.map(id=>({id,kind:s.kind,direction:s.insertionDirection??'down',issues:issues(s.issues)}))).sort((a,b)=>a.id.localeCompare(b.id));
  if(!same(outside(old),outside(plan)))reasons.push('Outside placement evidence changed');
  const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeats(before),repeats(after)))reasons.push('Existing repetition changed');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id))||!same(sorted(plan.steps.flatMap(s=>s.newBrickIds)),sorted(plan.bricks.map(b=>b.id))))reasons.push('Incomplete coverage');
  const affectedIds=new Set([proposal.targetId,proposal.anchorId]);
  const affectedBricks=new Set([...old.modules,...plan.modules].filter(m=>affectedIds.has(m.id)).flatMap(m=>m.brickIds));
  const outsideDiagrams=r=>r.instructionPlan.steps.filter(s=>!affectedIds.has(s.moduleId)).map(s=>({moduleId:s.moduleId,kind:s.kind,
    newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,visibleBrickIds:sorted(s.visibleBrickIds.filter(id=>!affectedBricks.has(id))),
    direction:s.insertionDirection??'down',issues:issues(s.issues)}));
  if(!same(outsideDiagrams(before),outsideDiagrams(after)))reasons.push('Outside diagrams changed');
  const quality=p=>assessWorkSurfaceQuality(p,{moduleIds:affectedIds}).modules.map(({stepStates,...m})=>m);
  const handlingBefore=quality(old),handlingAfter=quality(plan),prior=handlingBefore.find(m=>m.moduleId===proposal.anchorId),next=handlingAfter.find(m=>m.moduleId===proposal.anchorId);
  // A pair of covered tabs can split two floor bricks. Bound that explicit
  // handling cost; completing the new assembly must never require lifting
  // disconnected pieces. These counts are not a physical stability proof.
  const allowance=Math.min(2,Math.max(0,next.introducedBrickCount-prior.introducedBrickCount));
  if(next.peakLooseBrickCount>prior.peakLooseBrickCount+allowance||next.peakComponentCount>prior.peakComponentCount+allowance
    ||next.firstBondAtAddition>prior.firstBondAtAddition+allowance||handlingAfter.some(m=>m.finalComponentCount!==1))reasons.push('Repair worsens handling beyond the bounded retile');
  const views=chooseInstructionSequence(after.instructionPlan);
  if(after.instructionPlan.steps.filter(s=>[proposal.targetId,proposal.anchorId].includes(s.moduleId)&&(s.kind==='build'||s.moduleId===proposal.targetId&&s.kind==='join')).some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))reasons.push('Repair additions are obscured');
  if(count(after)>count(before)+4)reasons.push('Repair fragments the guide');
  return {reasons,diagnostics,handlingBefore,handlingAfter};
}

/** Repair one small detached assembly without discarding validated recipes. */
export function repairLocalInterfaces(result,{allowExtensions=false,rawModel=null}={}){
  if(!allowExtensions||!result.assemblyPlan||!result.instructionPlan||result.assemblyError||result.localInterfaceRepair?.selected
    ||!result.assemblyPlan.stats.unresolvedBrickCount||result.brickModel.bricks.length>1000||result.assemblyPlan.steps.some(s=>s.nestedRecipe))return result;
  // Keep all structural additions within a small shared allowance. Four cells
  // allow two spaced contacts and two short gaps even on a small assembly.
  const priorAdded=result.metrics?.structuralAddedMappedCellCount??0;
  const originalCells=Math.max(0,cells(result.brickModel.bricks).size-priorAdded);
  const budget=Math.max(0,Math.min(24,Math.max(4,Math.floor(originalCells*.01)))-priorAdded);
  if(!rawModel&&result.metrics?.geometryDifferenceRatio!==undefined)return result;
  const attempts=[];
  for(const proposal of discoverLocalInterfaceRepairs(result))try{
    if(proposal.gaps.length+proposal.corridors.flatMap(p=>p.addedCells).length>budget)continue;
    const candidate=candidateFor(result,proposal),{reasons,diagnostics,handlingBefore,handlingAfter}=validate(result,candidate,proposal);
    const evidence={targetId:proposal.targetId,anchorId:proposal.anchorId,addedCells:[...proposal.gaps,...proposal.corridors.flatMap(p=>p.addedCells)],contactSpan:proposal.span,handlingBefore,handlingAfter,
      beforeDiagrams:count(result),afterDiagrams:count(candidate),beforeUnresolved:result.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:candidate.assemblyPlan.stats.unresolvedBrickCount,reasons};
    attempts.push(evidence);if(reasons.length)continue;
    const partHistogram={};for(const b of candidate.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;partHistogram[k]=(partHistogram[k]??0)+1;}
    return {...candidate,diagnostics,assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(candidate.assemblyPlan),
      compaction:{...candidate.assemblyEvaluation?.compaction,brickCoverageComplete:true}},
      metrics:{...candidate.metrics,...(rawModel?measureBrickDifference(rawModel,candidate.brickModel):{}),brickCount:candidate.brickModel.bricks.length,partHistogram,
      structuralAddedMappedCellCount:(candidate.metrics?.structuralAddedMappedCellCount??0)+evidence.addedCells.length},localInterfaceRepair:{selected:true,attempts}};
  }catch(error){attempts.push({targetId:proposal.targetId,anchorId:proposal.anchorId,reasons:[error.message]});}
  return attempts.length?{...result,localInterfaceRepair:{selected:false,attempts}}:result;
}
