import {mapRecipe} from './assembly-recipes.js';
import {mapAssemblyModules} from './assembly-module-replay.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const usable=s=>s.kind==='build'&&(s.insertionDirection??'down')==='down'&&!s.nestedRecipe
  &&s.issues.every(i=>i.code==='temporary-hold'&&i.severity==='warning');

function attachmentCells(plan,step){
  const moving=new Set(step.highlightBrickIds),visible=new Set(step.visibleBrickIds),by=new Map(plan.bricks.map(b=>[b.id,b])),contacts=new Set();
  for(const {a,b} of plan.graph.edges)if(moving.has(a)!==moving.has(b)&&visible.has(a)&&visible.has(b)){
    const first=by.get(a),second=by.get(b),upper=first.y>second.y?first:second;
    for(let x=Math.max(first.x,second.x);x<Math.min(first.x+first.w,second.x+second.w);x++)
      for(let z=Math.max(first.z,second.z);z<Math.min(first.z+first.d,second.z+second.d);z++)contacts.add(`${x},${upper.y},${z}:${moving.has(upper.id)?'down':'up'}`);
  }
  return sorted(contacts);
}

function outsideEvidence(plan,family){
  return plan.steps.filter(s=>!family.has(s.moduleId)).flatMap(s=>s.newBrickIds.map(id=>({id,kind:s.kind,direction:s.insertionDirection??'down',issues:s.issues})))
    .sort((a,b)=>a.id.localeCompare(b.id));
}

export function discoverSharedHandledRecipes(result){
  const plan=result.assemblyPlan,by=new Map(plan.bricks.map(b=>[b.id,b]));
  const eligible=m=>{
    const steps=plan.steps.filter(s=>s.moduleId===m.id),builds=steps.filter(s=>s.newBrickIds.length),joins=steps.filter(s=>s.kind==='join');
    return m.kind==='detail'&&!m.buildContext&&(!m.groupType||m.groupType==='branch')&&!m.sharedHandledRecipe&&m.brickIds.length>=4&&m.brickIds.length<=80
      &&joins.length===1&&!joins[0].issues.length&&builds.length===steps.length-1&&builds.every(usable)
      &&builds.every(s=>s.visibleBrickIds.every(id=>m.brickIds.includes(id)));
  };
  const proposals=[];
  for(let i=0;i<plan.modules.length-1;i++){
    const pair=plan.modules.slice(i,i+2);if(!pair.every(eligible))continue;
    const ids=new Set(pair.map(m=>m.id)),indexes=plan.steps.flatMap((s,i)=>ids.has(s.moduleId)?[i]:[]);
    if(indexes.at(-1)-indexes[0]+1!==indexes.length)continue;
    // Compare both real recipes; fewer drawings is useful only after replay,
    // handling, attachment and visibility checks succeed.
    for(const [source,target] of [pair,[...pair].reverse()])for(let turn=0;turn<4;turn++){
      const bs=source.brickIds.map(id=>by.get(id)),targetParts=target.brickIds.map(id=>by.get(id));
      const replacement=mapRecipe(bs,targetParts,turn);
      if(same(cells(replacement),cells(targetParts))){proposals.push({sourceId:source.id,targetId:target.id,turn});break;}
    }
  }
  return proposals;
}

function templateDiagrams(before,candidate,sourceId,targetId,mapping){
  const oldSources=before.assemblyPlan.steps.filter(s=>s.moduleId===sourceId&&s.kind==='build');
  const sources=candidate.assemblyPlan.steps.filter(s=>s.moduleId===targetId&&s.kind==='build');
  if(oldSources.length!==sources.length)throw Error('Shared recipe changed operation boundaries');
  const ids=new Map(oldSources.map((s,i)=>[s.id,sources[i]]));
  oldSources.forEach((s,i)=>{if(!same(s.newBrickIds.map(id=>mapping.get(id)),sources[i].newBrickIds))throw Error('Shared operation differs');});
  const diagrams=before.instructionPlan.steps.filter(s=>s.moduleId===sourceId&&s.kind==='build').map((s,i)=>{
    const operations=s.sourceStepIds.map(id=>ids.get(id));
    return {...operations.at(-1),id:`${targetId}-shared-diagram-${i+1}`,
      newBrickIds:s.newBrickIds.map(id=>mapping.get(id)),highlightBrickIds:s.highlightBrickIds.map(id=>mapping.get(id)),
      sourceStepIds:operations.map(s=>s.id),issues:operations.flatMap(s=>s.issues),
      orderedOperations:operations.map(s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}))};
  });
  const original=candidate.instructionPlan.steps,start=original.findIndex(s=>s.moduleId===targetId&&s.kind==='build');
  const removed=original.filter(s=>s.moduleId===targetId&&s.kind==='build');
  return {...candidate.instructionPlan,steps:[...original.slice(0,start),...diagrams,...original.slice(start+removed.length)]};
}

function together(plan,ids){
  const first=plan.steps.findIndex(s=>ids.has(s.moduleId)),last=plan.steps.findLastIndex(s=>ids.has(s.moduleId));
  const run=plan.steps.slice(first,last+1);
  if(run.some(s=>!ids.has(s.moduleId)))throw Error('Shared recipes have intervening work');
  const steps=[...plan.steps.slice(0,first),...run.filter(s=>s.kind==='build'),...run.filter(s=>s.kind==='join'),...plan.steps.slice(last+1)];
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}

function buildCandidate(before,proposal){
  const old=before.assemblyPlan,by=new Map(old.bricks.map(b=>[b.id,b]));
  const source=old.modules.find(m=>m.id===proposal.sourceId),target=old.modules.find(m=>m.id===proposal.targetId);
  const sourceParts=source.brickIds.map(id=>by.get(id)),targetParts=target.brickIds.map(id=>by.get(id));
  const replacement=mapRecipe(sourceParts,targetParts,proposal.turn),mapping=new Map(sourceParts.map((b,i)=>[b.id,replacement[i].id]));
  const removed=new Set(target.brickIds),newIds=replacement.map(b=>b.id),family=new Set([source.id,target.id]);
  const brickModel={...before.brickModel,bricks:[...old.bricks.filter(b=>!removed.has(b.id)),...replacement].map(({id,...b})=>b)};
  const replay=mapAssemblyModules(old,{before:targetParts,after:replacement}).map(m=>{
    const template=m.id===target.id?source.id:m.id,groups=old.steps.filter(s=>s.moduleId===template&&s.newBrickIds.length).map(s=>s.newBrickIds.map(id=>m.id===target.id?mapping.get(id):id));
    return {...m,brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
  });
  const plan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:old.moduleRecipes??null,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  for(const m of plan.modules){
    const prior=old.modules.find(x=>x.id===m.id);
    if(prior.recipeFamily)m.recipeFamily=prior.recipeFamily;
    if(prior.repeatContinuation){const oldJoin=old.steps.find(s=>s.id===prior.repeatContinuation.joinSourceStepId),join=plan.steps.find(s=>s.moduleId===oldJoin?.moduleId&&s.kind==='join');if(join)m.repeatContinuation={...prior.repeatContinuation,joinSourceStepId:join.id};}
    if(family.has(m.id))m.sharedHandledRecipe={familyId:`shared-${[...family].sort().join('-')}`};
  }
  const compact=compactAssemblyPlan(plan);
  let candidate={...before,brickModel,assemblyPlan:plan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan)};
  // Later scenes contain the completed replacement, never a mix of both tilings.
  const contextIds=ids=>target.brickIds.every(id=>ids.includes(id))?[...ids.filter(id=>!removed.has(id)),...newIds]:ids;
  const contextPlan=p=>({...p,steps:p.steps.map(s=>s.moduleId===target.id?s:{...s,visibleBrickIds:contextIds(s.visibleBrickIds)})});
  candidate=retainUnchangedDiagrams({...before,assemblyPlan:contextPlan(old),instructionPlan:contextPlan(before.instructionPlan)},candidate);
  candidate.instructionPlan=templateDiagrams(before,candidate,source.id,target.id,mapping);
  candidate.assemblyPlan=together(candidate.assemblyPlan,family);
  candidate.instructionPlan=together(candidate.instructionPlan,family);
  // Retained table diagrams receive new IDs during replay. Keep their
  // completion references attached to the actual last recipe diagram.
  const completions=new Map(candidate.instructionPlan.steps.filter(s=>s.tableRecipe)
    .map(s=>[s.moduleId,s.id]));
  candidate.instructionPlan={...candidate.instructionPlan,steps:candidate.instructionPlan.steps.map(s=>s.tableRecipe
    ?{...s,tableRecipe:{...s.tableRecipe,completionStepId:completions.get(s.moduleId)}}:s)};
  candidate.guide=createGuideSections(candidate.instructionPlan);
  return candidate;
}

export function shareHandledRecipes(result){
  if(!result.assemblyPlan||!result.instructionPlan||result.assemblyError||result.sharedHandledRecipes?.selected
    ||result.assemblyPlan.bricks.length>1000||result.assemblyPlan.steps.some(s=>s.nestedRecipe))return result;
  const attempts=[],accepted=[];
  for(const proposal of discoverSharedHandledRecipes(result).slice(0,8))try{
    const candidate=buildCandidate(result,proposal),plan=candidate.assemblyPlan,family=new Set([proposal.sourceId,proposal.targetId]);
    const reasons=[];
    if(!same(cells(plan.bricks),cells(result.assemblyPlan.bricks)))reasons.push('Colored geometry changed');
    const unresolved=p=>cells(p.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds.map(id=>p.bricks.find(b=>b.id===id))));
    if(!same(unresolved(plan),unresolved(result.assemblyPlan)))reasons.push('Unresolved geometry changed');
    if(!same(outsideEvidence(plan,family),outsideEvidence(result.assemblyPlan,family)))reasons.push('Outside placement evidence changed');
    if(plan.steps.filter(s=>family.has(s.moduleId)).some(s=>s.kind!=='join'&&!usable(s)||s.kind==='join'&&s.issues.length))reasons.push('Shared recipe or attachment failed');
    const joins=plan.steps.filter(s=>family.has(s.moduleId)&&s.kind==='join');
    if(joins.length!==2)reasons.push('Missing per-instance attachment');
    for(const original of result.assemblyPlan.steps.filter(s=>s.kind==='join')){
      const next=plan.steps.find(s=>s.moduleId===original.moduleId&&s.kind==='join');
      if(!next||!same(attachmentCells(result.assemblyPlan,original),attachmentCells(plan,next)))reasons.push('Attachment contacts changed');
    }
    const previousHandling=assessWorkSurfaceQuality(result.assemblyPlan,{moduleIds:family}).modules;
    const handling=assessWorkSurfaceQuality(plan,{moduleIds:family}).modules;
    for(const next of handling){const previous=previousHandling.find(m=>m.moduleId===next.moduleId);
      if(['peakLooseBrickCount','peakComponentCount','finalComponentCount'].some(k=>next[k]>previous[k])
        ||previous.firstBondAtAddition!==null&&(next.firstBondAtAddition===null||next.firstBondAtAddition>previous.firstBondAtAddition))reasons.push('Recipe handling worsened');
    }
    if(!same(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id))
      ||!same(sorted(plan.steps.flatMap(s=>s.newBrickIds)),sorted(plan.bricks.map(b=>b.id))))reasons.push('Incomplete coverage');
    const views=chooseInstructionSequence(candidate.instructionPlan);
    if(candidate.instructionPlan.steps.filter(s=>family.has(s.moduleId)&&s.kind==='build').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))reasons.push('Shared recipe obscures additions');
    if(candidate.instructionPlan.steps.filter(s=>family.has(s.moduleId)&&s.kind==='join').some(s=>!views.get(s.id)?.visibleHighlightBrickCount||views.get(s.id)?.truncated))reasons.push('Attachment assembly is hidden');
    const repeats=createBookletPresentation(candidate).presentation.sections.filter(s=>s.repeatCount>1&&s.moduleIds.some(id=>family.has(id)));
    if(repeats.length!==1||repeats[0].repeatCount!==2)reasons.push('Shared build recipe did not repeat');
    if(count(candidate)>=count(result))reasons.push('No guide simplification');
    const repeatInventory=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1)
      .map(s=>JSON.stringify(s.instances.map(i=>sorted(i.brickIds)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
    if(repeatInventory(result).some(signature=>!repeatInventory(candidate).includes(signature)))reasons.push('Existing repetition changed');
    attempts.push({...proposal,reasons,before:count(result),after:count(candidate),handlingBefore:previousHandling,handlingAfter:handling});
    if(!reasons.length)accepted.push(candidate);
  }catch(error){attempts.push({...proposal,reasons:[error.message]});}
  if(!accepted.length)return attempts.length?{...result,sharedHandledRecipes:{selected:false,attempts}}:result;
  accepted.sort((a,b)=>count(a)-count(b));const selected=accepted[0],histogram={};
  for(const b of selected.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[k]=(histogram[k]??0)+1;}
  return {...selected,metrics:{...result.metrics,brickCount:selected.brickModel.bricks.length,partHistogram:histogram},
    assemblyEvaluation:{...selected.assemblyEvaluation,after:assessAssemblyQuality(selected.assemblyPlan),
      compaction:{...selected.assemblyEvaluation?.compaction,sourceStepCount:selected.assemblyPlan.steps.length,instructionDiagramCount:selected.instructionPlan.steps.length,
        mergedDiagramCount:selected.instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length,
        collapsedStepCount:selected.assemblyPlan.steps.length-selected.instructionPlan.steps.length,sourceStepCoverageComplete:true,brickCoverageComplete:true}},
    sharedHandledRecipes:{selected:true,attempts}};
}
