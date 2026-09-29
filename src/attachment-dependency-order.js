import {createAssemblyPlan} from './assembly.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {unresolvedCells} from './refine-construction.js';
import {contactCells} from './local-interface-repair.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=xs=>[...xs].sort();
const options={allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>[s.repeatCount,s.stepIds.length,sorted(s.instances.flatMap(i=>i.brickIds))]);
const scope=s=>s.nestedRecipe?[s.nestedRecipe.id,s.nestedRecipe.parentModuleId,s.nestedRecipe.separate,s.nestedRecipe.floorY]:null;
const key=s=>JSON.stringify([s.moduleId,s.kind,sorted(s.newBrickIds),sorted(s.highlightBrickIds),scope(s)]);
// A newly attached piece joins the receiver's background membership. The
// existing join must retain its contacts and direction, not that old background.
const operation=s=>[s.moduleId,s.kind,s.newBrickIds,s.highlightBrickIds,s.insertionDirection??'down',s.workingOrientation??null,scope(s),s.issues];
const placements=(plan,moduleId,omitTemporaryHold=false)=>plan.steps.filter(s=>s.moduleId===moduleId).flatMap(s=>s.newBrickIds.map(id=>[
  id,s.kind,s.insertionDirection??'down',s.workingOrientation??null,scope(s),
  s.issues.filter(i=>(!i.brickIds?.length||i.brickIds.includes(id))&&(!omitTemporaryHold||i.code!=='temporary-hold')),
])).map(JSON.stringify).sort();

/** An existing receiver may be usable before another workpiece closes its insertion path. */
export function discoverAttachmentDependencies(result){
  const p=result.assemblyPlan,by=new Map(p.bricks.map(b=>[b.id,b])),owner=new Map(p.modules.flatMap((m,i)=>m.brickIds.map(id=>[id,i])));
  const repeated=new Set(repeats(result).flatMap(r=>r[2]));
  const protectedModule=m=>m.brickIds.some(id=>repeated.has(id))||['recipeFamily','mirroredAssembly','sharedHandledRecipe','repeatContinuation'].some(k=>m[k]);
  const found=[];
  for(const[from,m]of p.modules.entries()){
    if(m.kind!=='detail'||protectedModule(m))continue;
    const steps=p.steps.filter(s=>s.moduleId===m.id),failed=steps.filter(s=>!s.nestedRecipe&&s.kind==='unresolved'&&!s.newBrickIds.length);
    if(failed.length!==1||!failed[0].issues.some(i=>i.code==='blocked-module-insertion')
      ||steps.some(s=>s.issues.some(i=>i.severity==='error'&&i.code!=='blocked-module-insertion')))continue;
    const selected=new Set(m.brickIds),blockers=new Set(failed[0].issues.filter(i=>i.code==='blocked-module-insertion')
      .flatMap(i=>i.brickIds).filter(id=>!selected.has(id)).map(id=>owner.get(id)));
    if(!blockers.size||[...blockers].some(i=>i===undefined||i>=from))continue;
    const to=Math.min(...blockers),direction=m.buildContext?.joinDirection??'down',receivers=new Set();
    for(const{a,b}of p.graph.edges){
      const lo=by.get(a).y<by.get(b).y?a:b,hi=lo===a?b:a;
      const child=direction==='up'?lo:hi,receiver=direction==='up'?hi:lo;
      if(selected.has(child)&&!selected.has(receiver))receivers.add(owner.get(receiver));
    }
    // Do not move a workpiece ahead of any part of its actual receiving surface.
    if(!receivers.size||[...receivers].some(i=>i===undefined||i>=to))continue;
    const crossed=p.modules.slice(to,from);
    if(crossed.some(protectedModule))continue;
    found.push({moduleId:m.id,from,to,blockers:[...blockers].map(i=>p.modules[i].id),receivers:[...receivers].map(i=>p.modules[i].id),
      contextIds:[...m.brickIds,...crossed.flatMap(m=>m.brickIds)]});
  }
  return found.slice(0,8);
}

/** Keep whole building tasks while replaying every changed attachment scene. */
export function planAttachmentDependency(before,proposal){
  const old=before.assemblyPlan,replay=recipeReplay(old,{preservePlacements:true});
  if(replay[proposal.from]?.id!==proposal.moduleId||proposal.to<0||proposal.to>=proposal.from)throw Error('Invalid attachment dependency');
  for(const m of replay)if(!old.steps.some(s=>s.moduleId===m.id&&s.nestedRecipe)){
    m.placementGroups=old.steps.filter(s=>s.moduleId===m.id).map(s=>s.newBrickIds).filter(g=>g.length);
    m.brickOrder=m.placementGroups.flat();m.actionOrder=true;
  }
  const[moving]=replay.splice(proposal.from,1);replay.splice(proposal.to,0,moving);
  const introducedTable=!moving.buildContext;
  if(introducedTable){
    const ids=new Set(moving.brickIds);
    moving.groupType='work-surface';
    moving.buildContext={kind:'work-surface',floorY:Math.min(...old.bricks.filter(b=>ids.has(b.id)).map(b=>b.y)),joinDirection:'down'};
  }
  const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:replayNestedRecipes(old),...options});
  const bad=unresolvedCells(assemblyPlan),oldBad=unresolvedCells(old);
  if(bad.size>=oldBad.size||[...bad].some(c=>!oldBad.has(c)))throw Error('Attachment dependency did not safely resolve placements');
  const outside=p=>p.steps.filter(s=>s.moduleId!==proposal.moduleId&&!s.newBrickIds.length).map(operation).map(JSON.stringify).sort();
  if(!same(old.bricks,assemblyPlan.bricks)||!same(outside(old),outside(assemblyPlan)))throw Error('Attachment dependency changed other operations');
  for(const m of old.modules){
    // Replayed source batches can split or reorder placements within a task.
    // Preserve every piece's validated outcome here and exact reader task order below.
    const omitTemporaryHold=introducedTable&&m.id===proposal.moduleId;
    if(!same(placements(old,m.id,omitTemporaryHold),placements(assemblyPlan,m.id,omitTemporaryHold)))throw Error('Attachment dependency changed an internal placement');
  }
  const target=assemblyPlan.steps.filter(s=>s.moduleId===proposal.moduleId);
  if(target.some(s=>s.issues.some(i=>i.severity==='error'))||!target.some(s=>s.kind==='join'&&!s.nestedRecipe))throw Error('Workpiece is not attachable');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.some(i=>i.severity==='error'))){
    const next=assemblyPlan.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&same(scope(s),scope(join)));
    if(!next||next.issues.some(i=>i.severity==='error'))throw Error('Existing attachment changed');
    const prior=new Set(contactCells(old,join)),current=new Set(contactCells(assemblyPlan,next)),moved=new Set(moving.brickIds);
    const contacts=assemblyPlan.graph.edges.filter(e=>moved.has(e.a)||moved.has(e.b)).map(e=>({supportBrickId:e.a,bandBrickId:e.b}));
    const added=new Set(contactCells(assemblyPlan,{...next,joinContext:{supportGroups:[{contacts}]}}));
    if([...prior].some(c=>!current.has(c))||[...current].some(c=>!prior.has(c)&&!added.has(c)))throw Error('Existing attachment lost contacts or gained unrelated contacts');
  }
  const compact=compactAssemblyPlan(assemblyPlan);
  const after=retainUnchangedDiagrams(before,restoreUnchangedRecipeMetadata(before,{...before,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan)}),{changedContextIds:new Set(proposal.contextIds)});
  const q=after.instructionPlan,diagram=s=>[s.moduleId,s.kind,sorted(s.newBrickIds),sorted(s.highlightBrickIds),s.insertionDirection??'down',s.workingOrientation??null,scope(s),
    introducedTable&&s.moduleId===proposal.moduleId?s.issues.filter(i=>i.code!=='temporary-hold'):s.issues];
  const retained=r=>old.modules.filter(m=>m.id!==proposal.moduleId).map(m=>r.instructionPlan.steps.filter(s=>s.moduleId===m.id).map(diagram));
  // Explicit table support can consolidate the moved workpiece's small
  // steps. Its literal build order and every other diagram stay unchanged.
  if(!same(retained(before),retained(after))||count(after)>count(before))throw Error('Attachment dependency changed diagram tasks');
  if(!same(repeats(before),repeats(after)))throw Error('Attachment dependency changed repetition');
  if(!same(q.steps.flatMap(s=>s.sourceStepIds),assemblyPlan.steps.map(s=>s.id))||!same(after.guide.sections.flatMap(s=>s.stepIds),q.steps.map(s=>s.id)))throw Error('Attachment dependency lost coverage');
  const expected=sorted(assemblyPlan.bricks.map(b=>b.id)),source=new Map(assemblyPlan.steps.map(s=>[s.id,s]));
  if(!same(sorted(q.steps.flatMap(s=>s.newBrickIds)),expected)||!same(sorted(assemblyPlan.steps.flatMap(s=>s.newBrickIds)),expected))throw Error('Attachment dependency lost pieces');
  const literal=s=>[s.kind,s.newBrickIds,s.highlightBrickIds,s.insertionDirection??'down',s.workingOrientation??null,s.issues];
  if(q.steps.some(s=>!same(s.orderedOperations.map(literal),s.sourceStepIds.map(id=>literal(source.get(id))))))throw Error('Attachment dependency changed literal operations');
  const diagramIds=new Set(q.steps.map(s=>s.id));
  if(q.steps.some(s=>s.tableRecipe&&!diagramIds.has(s.tableRecipe.completionStepId)||s.componentTask&&!diagramIds.has(s.componentTask.lastStepId)))throw Error('Attachment dependency left a stale guide reference');
  const priorViews=chooseInstructionSequence(before.instructionPlan),views=chooseInstructionSequence(q);
  const priorHidden=new Set(before.instructionPlan.steps.filter(s=>{const v=priorViews.get(s.id);return v&&(!v.passes||v.truncated);}).map(key));
  if(q.steps.some(s=>{const v=views.get(s.id);return v&&(!v.passes||v.truncated)&&!priorHidden.has(key(s));}))throw Error('Earlier attachment hides new additions');
  return{...after,assemblyEvaluation:{...after.assemblyEvaluation,after:assessAssemblyQuality(assemblyPlan)}};
}

export function scheduleAttachmentDependencies(before){
  if(!before.assemblyPlan||!before.instructionPlan||before.assemblyError||before.semanticGuide||before.attachmentDependencyScheduling?.selected||before.assemblyPlan.bricks.length>1000)return before;
  const attempts=[];let current=before,accepted=0;
  while(attempts.length<8&&accepted<4){
    let selected=false;
    for(const proposal of discoverAttachmentDependencies(current).slice(0,8-attempts.length)){
      const{contextIds,...summary}=proposal;
      try{
        current=planAttachmentDependency(current,proposal);attempts.push({...summary,selected:true});
        accepted++;selected=true;break;
      }catch(error){attempts.push({...summary,error:error.message});}
    }
    if(!selected)break;
  }
  if(current!==before)return{...current,attachmentDependencyScheduling:{selected:true,attempts,beforeUnresolved:before.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:current.assemblyPlan.stats.unresolvedBrickCount}};
  return attempts.length?{...before,attachmentDependencyScheduling:{selected:false,attempts}}:before;
}
