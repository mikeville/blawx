import {proposeAttachmentCorridors} from './attachment-corridors.js';
import {mapAssemblyModules} from './assembly-module-replay.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {unresolvedCells} from './refine-construction.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {restoreRepeatedOrder,contactCells} from './local-interface-repair.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {inspectConstruction} from './construction.js';
import {measureBrickDifference} from './construction-differences.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=ids=>[...ids].sort();
const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cellKey=c=>`${c.x},${c.y},${c.z}`;
const cells=bs=>new Map(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));
const overlap=(a,b)=>Math.min(a.x+a.w,b.x+b.w)>Math.max(a.x,b.x)&&Math.min(a.z+a.d,b.z+b.d)>Math.max(a.z,b.z);
const adjacent=(a,b)=>{const x=Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x),z=Math.min(a.z+a.d,b.z+b.d)-Math.max(a.z,b.z);return x>=0&&z>=0&&(x>0||z>0);};
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const issues=entries=>entries.map(i=>({...i,...(i.brickIds?{brickIds:sorted(i.brickIds)}:{})}));

function discover(result,maxAddedCells){
  const plan=result.assemblyPlan,owner=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m]))),components=new Map(plan.graph.components.flatMap(c=>c.brickIds.map(id=>[id,c])));
  return proposeAttachmentCorridors(result,{maxAddedCells,maxProposals:64}).flatMap(patch=>{
    const parent=owner.get(patch.anchorIds[0]),joined=new Set(components.get(patch.targetIds[0]).brickIds);
    if(parent.kind!=='grounded'||parent.buildContext||parent.sharedHandledRecipe||joined.size>8
      ||[...joined].some(id=>owner.get(id).kind!=='floating')
      ||plan.steps.some(s=>s.moduleId===parent.id&&(s.kind!=='build'||s.issues.length||(s.insertionDirection??'down')!=='down')))return [];
    return [{patch,parent,joined}];
  });
}

function replay(before,{patch,parent,joined}){
  const old=before.assemblyPlan;
  const reassigned={...old,modules:old.modules.map(m=>({...m,brickIds:m.id===parent.id?[...m.brickIds,...joined]:m.brickIds.filter(id=>!joined.has(id))})).filter(m=>m.brickIds.length),
    steps:[...old.steps.map(s=>({...s,newBrickIds:s.newBrickIds.filter(id=>!joined.has(id))})),{moduleId:parent.id,newBrickIds:[...joined]}]};
  const mapped=mapAssemblyModules(reassigned,{before:patch.before,after:patch.after}),brickModel={...before.brickModel,bricks:patch.bricks};
  const identified=createAssemblyPlan({brickModel}).bricks,byId=new Map(identified.map(b=>[b.id,b])),byKey=new Map(identified.map(b=>[key(b),b]));
  const removed=new Set(patch.anchorIds),replacement=patch.after.map(b=>byKey.get(key(b)).id),remap=ids=>ids.flatMap(id=>removed.has(id)?replacement:[id]);
  const assignments=new Map();
  const moduleReplay=mapped.map(m=>{
    const sources=old.steps.filter(s=>s.moduleId===m.id&&s.newBrickIds.some(id=>!joined.has(id)));
    const groups=sources.map(s=>remap(s.newBrickIds.filter(id=>!joined.has(id))));
    if(m.id===parent.id)for(const id of [...joined].sort((a,b)=>byId.get(a).y-byId.get(b).y)){
      const brick=byId.get(id),supports=identified.filter(b=>b.y===brick.y-1&&overlap(b,brick)).map(b=>b.id);
      const last=groups.findLastIndex(g=>g.some(x=>supports.includes(x)));
      if(last<0)throw Error('No receiving support in this module');
      // Keep a detail with an adjacent same-course task, after its supports.
      // Replaying the full plan must still prove a clear downward insertion.
      const destination=groups.findIndex((g,i)=>i>last&&g.every(x=>byId.get(x).y===brick.y)&&g.some(x=>adjacent(byId.get(x),brick)));
      if(destination<0)throw Error('No coherent receiving course');
      groups[destination].push(id);assignments.set(id,sources[destination].id);
    }
    return {...m,brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
  });
  let plan=createAssemblyPlan({brickModel,moduleReplay,moduleRecipes:old.moduleRecipes??null,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  for(const m of plan.modules){
    const previous=old.modules.find(x=>x.id===m.id);
    for(const field of ['recipeFamily','sharedHandledRecipe','localInterfaceRepair'])if(previous[field])m[field]=structuredClone(previous[field]);
    if(previous.repeatContinuation){const source=old.steps.find(s=>s.id===previous.repeatContinuation.joinSourceStepId),join=plan.steps.find(s=>s.moduleId===source?.moduleId&&s.kind==='join');if(join)m.repeatContinuation={...previous.repeatContinuation,joinSourceStepId:join.id};}
  }
  plan=restoreRepeatedOrder(plan);const compact=compactAssemblyPlan(plan);
  let candidate={...before,brickModel,assemblyPlan:plan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan)};
  const sourceIndex=new Map(old.steps.map((s,i)=>[s.id,i])),parentIds=new Set(parent.brickIds);
  // Adapt the previous diagrams to the local repair before retaining them.
  // Their task boundaries survive; scenes acquire the detail only after its
  // newly validated placement and only when the receiving structure is shown.
  const adapt=p=>({...p,steps:p.steps.map(s=>{
    const sources=s.sourceStepIds??[s.id],end=Math.max(...sources.map(id=>sourceIndex.get(id)));
    const introduced=[...assignments].filter(([,id])=>sources.includes(id)).map(([id])=>id);
    const context=s.visibleBrickIds.some(id=>parentIds.has(id));
    const visible=[...assignments].filter(([,id])=>context&&end>=sourceIndex.get(id)).map(([id])=>id);
    return {...s,newBrickIds:[...remap(s.newBrickIds.filter(id=>!joined.has(id))),...introduced],highlightBrickIds:[...remap(s.highlightBrickIds.filter(id=>!joined.has(id))),...introduced],
      visibleBrickIds:[...new Set([...remap(s.visibleBrickIds.filter(id=>!joined.has(id))),...visible])]};
  })});
  candidate=retainUnchangedDiagrams({...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)},candidate,{omittedContextIds:joined});
  return {candidate,expected:adapt(before.instructionPlan)};
}

function validate(before,after,expected,{patch,parent,joined}){
  const old=before.assemblyPlan,plan=after.assemblyPlan,reasons=[],oldCells=cells(old.bricks),newCells=cells(plan.bricks),added=new Set(patch.addedCells.map(cellKey));
  if([...oldCells].some(([k,c])=>newCells.get(k)!==c)||[...newCells.keys()].some(k=>!oldCells.has(k)&&!added.has(k))||[...added].some(k=>oldCells.has(k)||!newCells.has(k)))reasons.push('Geometry differs from the exact covered repair');
  const previous=unresolvedCells(old),next=unresolvedCells(plan);
  if(next.size>=previous.size||[...next].some(c=>!previous.has(c)))reasons.push('Unresolved geometry did not improve');
  const placements=plan.steps.filter(s=>s.moduleId===parent.id);
  if(placements.some(s=>s.kind!=='build'||s.issues.length))reasons.push('Invalid receiving sequence');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const repaired=plan.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId);
    if(!repaired||repaired.issues.length||!same(contactCells(old,join),contactCells(plan,repaired)))reasons.push('Prior attachment changed');
  }
  const floating=new Set(old.modules.filter(m=>m.brickIds.some(id=>joined.has(id))).map(m=>m.id));
  const payload=p=>p.steps.filter(s=>!floating.has(s.moduleId)).map(s=>({moduleId:s.moduleId,kind:s.kind,new:sorted(s.newBrickIds),highlight:sorted(s.highlightBrickIds),
    visible:sorted(s.visibleBrickIds),direction:s.insertionDirection??'down',issues:issues(s.issues)}));
  if(!same(payload(expected),payload(after.instructionPlan)))reasons.push('Existing task boundaries changed');
  const repeat=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeat(before),repeat(after)))reasons.push('Existing repetition changed');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id))||!same(sorted(plan.steps.flatMap(s=>s.newBrickIds)),sorted(plan.bricks.map(b=>b.id))))reasons.push('Incomplete coverage');
  const priorViews=chooseInstructionSequence(before.instructionPlan),views=chooseInstructionSequence(after.instructionPlan);
  const oldByAdditions=new Map(before.instructionPlan.steps.map(s=>[sorted(s.newBrickIds).join('|'),s]));
  if(after.instructionPlan.steps.filter(s=>s.moduleId===parent.id).some(s=>{
    const previous=oldByAdditions.get(sorted(s.newBrickIds).join('|')),view=views.get(s.id);
    return (!previous||priorViews.get(previous.id)?.passes)&&(!view?.passes||view.truncated);
  }))reasons.push('Changed additions are obscured');
  const diagnostics=inspectConstruction(after.brickModel);
  if(diagnostics.stats.collisionPairCount||diagnostics.stats.illegalFootprintCount)reasons.push('Invalid bricks');
  if(count(after)>count(before))reasons.push('Repair adds task fragmentation');
  return {reasons,diagnostics};
}

/** Place repaired details within already coherent receiving courses. */
export function repairReceiverDetails(before,{allowExtensions=false,rawModel=null}={}){
  if(!allowExtensions||!before.assemblyPlan?.stats.unresolvedBrickCount||!before.instructionPlan||before.assemblyError
    ||before.brickModel.bricks.length>1000||before.receiverDetailRepair?.selected||before.assemblyPlan.steps.some(s=>s.nestedRecipe)
    ||!rawModel&&before.metrics?.geometryDifferenceRatio!==undefined)return before;
  const priorAdded=before.metrics?.structuralAddedMappedCellCount??0,originalCells=Math.max(0,cells(before.brickModel.bricks).size-priorAdded);
  const budget=Math.max(0,Math.min(24,Math.max(4,Math.floor(originalCells*.01)))-priorAdded);
  let current=before,checks=0;const attempts=[],addedCells=[],accepted=[];
  for(let round=0;round<8&&checks<32&&addedCells.length<budget;round++){
    let selected;
    for(const proposal of discover(current,Math.min(4,budget-addedCells.length))){
      if(++checks>32)break;
      try{
        const {candidate,expected}=replay(current,proposal),{reasons,diagnostics}=validate(current,candidate,expected,proposal);
        const receipt={round,parentId:proposal.parent.id,joinedBrickIds:[...proposal.joined],addedCells:proposal.patch.addedCells,
          beforeUnresolved:current.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:candidate.assemblyPlan.stats.unresolvedBrickCount,
          beforeDiagrams:count(current),afterDiagrams:count(candidate),reasons};
        attempts.push(receipt);if(reasons.length)continue;
        selected={...candidate,diagnostics};accepted.push(receipt);addedCells.push(...proposal.patch.addedCells);break;
      }catch(error){attempts.push({round,parentId:proposal.parent.id,reasons:[error.message]});}
    }
    if(!selected)break;current=selected;
  }
  if(!accepted.length)return attempts.length?{...before,receiverDetailRepair:{selected:false,attempts}}:before;
  const partHistogram={};for(const b of current.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;partHistogram[k]=(partHistogram[k]??0)+1;}
  return {...current,metrics:{...current.metrics,...(rawModel?measureBrickDifference(rawModel,current.brickModel):{}),brickCount:current.brickModel.bricks.length,partHistogram,
    structuralAddedMappedCellCount:priorAdded+addedCells.length},assemblyEvaluation:{...current.assemblyEvaluation,after:assessAssemblyQuality(current.assemblyPlan),
      compaction:{...current.assemblyEvaluation?.compaction,brickCoverageComplete:true}},receiverDetailRepair:{selected:true,budget,attempts,accepted,addedCells}};
}
