import {consolidateConnectionTasks} from './connection-task-diagrams.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {unresolvedCells} from './refine-construction.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sorted=ids=>[...ids].sort();
const clean=steps=>steps.length>0&&steps.every(s=>!s.issues.length&&!s.nestedRecipe&&['build','join'].includes(s.kind));
const count=result=>deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections.reduce((n,s)=>n+s.stepIds.length,0);

function context(result) {
  const plan=result.assemblyPlan,by=new Map(plan.bricks.map(b=>[b.id,b]));
  const owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m.id])));
  const neighbors=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b}of plan.graph.edges){neighbors.get(a).push(b);neighbors.get(b).push(a);}
  const steps=new Map(plan.modules.map(m=>[m.id,plan.steps.filter(s=>s.moduleId===m.id)]));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  return {plan,by,owners,neighbors,steps,repeated};
}

/** Small handled repairs can belong to the complete assembly receiving them. */
export function discoverReceiverRecipes(result,{allowChildStrengthAdvisories=false}={}) {
  if(!result.assemblyPlan||!result.instructionPlan||result.assemblyError)return [];
  const {plan,by,owners,steps,repeated}=context(result),proposals=[];
  for(let index=0;index<plan.modules.length;index++){
    const parent=plan.modules[index],parentSteps=steps.get(parent.id);
    if(parent.buildContext?.kind!=='work-surface'||parent.brickIds.length<8
      ||parent.brickIds.some(id=>repeated.has(id))||!clean(parentSteps)
      ||parentSteps.filter(s=>s.kind==='join'&&s.joinContext?.direction==='down').length!==1)continue;
    const children=[];let floor;
    for(const child of plan.modules.slice(index+1)){
      const childSteps=steps.get(child.id);
      // A direct continuation may be an underside detail on the receiver.
      // Stop at new dependent body work rather than swallowing a distant recipe.
      if(!child.buildContext){
        if(child.kind==='grounded'&&childSteps.length&&childSteps.every(s=>s.kind==='build'&&!s.issues.length
          &&s.insertionDirection==='up')&&child.brickIds.every(id=>by.get(id).y<parent.buildContext.floorY))continue;
        break;
      }
      // A weak bond in the separate child can improve when it is built on the
      // receiver. The alternative must still replay without any warning.
      const childIsReadable=allowChildStrengthAdvisories
        ? childSteps.length>0&&childSteps.every(s=>!s.nestedRecipe&&['build','join'].includes(s.kind)
          &&s.issues.every(i=>i.code==='limited-support'&&i.severity==='warning'))
        : clean(childSteps);
      if(child.buildContext.kind!=='work-surface'||child.brickIds.length>24
        ||child.brickIds.some(id=>repeated.has(id))||!childIsReadable)break;
      const joins=childSteps.filter(s=>s.kind==='join'),contacts=joins.flatMap(s=>s.joinContext?.supportGroups??[]).flatMap(g=>g.contacts);
      const childFloor=child.buildContext.floorY;
      if(joins.length!==1||joins[0].joinContext?.direction!=='down'||!contacts.length
        ||contacts.some(c=>owners.get(c.supportBrickId)!==parent.id)
        ||childFloor<=parent.buildContext.floorY||floor!==undefined&&floor!==childFloor
        ||child.brickIds.some(id=>by.get(id).y<childFloor||by.get(id).y>childFloor+1))break;
      floor=childFloor;children.push(child);
    }
    if(children.length<2||parent.brickIds.length+children.reduce((n,m)=>n+m.brickIds.length,0)>256)continue;
    proposals.push({parentId:parent.id,childIds:children.map(m=>m.id),floor});
  }
  return proposals;
}

function plannedReplay(result,proposal) {
  const {plan,by,steps,neighbors}=context(result),parent=plan.modules.find(m=>m.id===proposal.parentId);
  const removed=new Set(proposal.childIds),extra=plan.modules.filter(m=>removed.has(m.id)).flatMap(m=>m.brickIds);
  const parentSet=new Set(parent.brickIds),upper=extra.filter(id=>by.get(id).y===proposal.floor+1
    &&neighbors.get(id).some(n=>parentSet.has(n)&&by.get(n).y===by.get(id).y-1));
  const upperSet=new Set(upper),lower=extra.filter(id=>by.get(id).y===proposal.floor
    &&neighbors.get(id).some(n=>upperSet.has(n)&&by.get(n).y===by.get(id).y+1));
  if(!upper.length||!lower.length)return null;
  const taken=new Set([...upper,...lower]),tail=extra.filter(id=>!taken.has(id));
  let priorWasTable=false;
  const replay=plan.modules.filter(m=>!removed.has(m.id)).map(m=>{
    const originalGroups=steps.get(m.id).filter(s=>s.newBrickIds.length).map(s=>s.newBrickIds);
    const groups=m.id===parent.id?[...originalGroups,upper,lower,tail].filter(g=>g.length):originalGroups;
    const descriptor={id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,
      brickIds:groups.flat(),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups,
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
    // Removing a handled child can leave a continuation behind another
    // continuation. The replay validator proves every lower support for this
    // classification; it cannot silently become a new grounded assembly.
    if(descriptor.groupType==='continuation'&&!priorWasTable)descriptor.groupType='supported-additions';
    priorWasTable=descriptor.groupType==='work-surface';
    return descriptor;
  });
  return {replay,upper,lower,tail};
}

function placementEvidence(plan,moduleIds) {
  return plan.steps.filter(s=>moduleIds.has(s.moduleId)).flatMap(s=>s.newBrickIds.map(id=>({id,
    kind:s.kind,direction:s.insertionDirection??'down',issues:s.issues}))).sort((a,b)=>a.id.localeCompare(b.id));
}

function validate(before,after,proposal) {
  const old=before.assemblyPlan,plan=after.assemblyPlan,changed=new Set([proposal.parentId,...proposal.childIds]);
  const outside=new Set(old.modules.filter(m=>!changed.has(m.id)).map(m=>m.id));
  const reasons=[];
  if(!same(sorted(unresolvedCells(old)),sorted(unresolvedCells(plan))))reasons.push('Unresolved cells changed');
  if(!same(placementEvidence(old,outside),placementEvidence(plan,outside)))reasons.push('Outside placement evidence changed');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id))
    ||!same(sorted(plan.steps.flatMap(s=>s.newBrickIds)),sorted(old.bricks.map(b=>b.id))))reasons.push('Incomplete coverage');
  const parent=plan.steps.filter(s=>s.moduleId===proposal.parentId),joins=parent.filter(s=>s.kind==='join');
  if(!clean(parent)||joins.length!==1||joins[0].joinContext?.direction!=='down')reasons.push('Incomplete receiver recipe or attachment');
  // Downward additions use this sequence camera. Upward placements and joins
  // have separate underside/exploded renderers and are absent from this map.
  const views=chooseInstructionSequence(after.instructionPlan);
  if(after.instructionPlan.steps.filter(s=>s.moduleId===proposal.parentId&&s.kind==='build'&&s.insertionDirection!=='up').some(s=>{const v=views.get(s.id);return !v?.passes||v.truncated;}))reasons.push('Receiver diagram obscures additions');
  const originalJoin=old.steps.find(s=>s.moduleId===proposal.parentId&&s.kind==='join');
  const contacts=s=>s.joinContext?.supportGroups.flatMap(g=>g.contacts).map(c=>JSON.stringify(c)).sort();
  if(joins.length===1&&!same(contacts(originalJoin),contacts(joins[0])))reasons.push('Receiver attachment contacts changed');
  const originalOutside=old.steps.filter(s=>s.kind==='join'&&outside.has(s.moduleId));
  for(const join of originalOutside){const next=plan.steps.find(s=>s.moduleId===join.moduleId&&s.kind==='join'
    &&s.nestedRecipe?.id===join.nestedRecipe?.id
    &&same(sorted(s.highlightBrickIds),sorted(join.highlightBrickIds)));
    if(!next||!same(contacts(join),contacts(next))||!same(join.issues,next.issues)
      ||(join.insertionDirection??'down')!==(next.insertionDirection??'down'))reasons.push('Outside attachment changed');}
  const oldHandling=assessWorkSurfaceQuality(old).modules.find(m=>m.moduleId===proposal.parentId);
  const handling=assessWorkSurfaceQuality(plan).modules.find(m=>m.moduleId===proposal.parentId);
  if(['peakLooseBrickCount','peakComponentCount','finalComponentCount'].some(k=>handling[k]>oldHandling[k])
    ||oldHandling.firstBondAtAddition!==null&&(handling.firstBondAtAddition===null||handling.firstBondAtAddition>oldHandling.firstBondAtAddition))reasons.push('Receiver handling worsened');
  const repeats=r=>deriveGuidePresentation({plan:r.instructionPlan,guide:r.guide}).sections
    .filter(s=>s.repeatCount>1).map(s=>JSON.stringify(s.instances.map(i=>sorted(i.brickIds)).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))))).sort();
  if(!same(repeats(before),repeats(after)))reasons.push('Repeated recipes changed');
  // Fewer separately handled assemblies can improve continuity even when the
  // number of drawings stays level. The candidate must not lengthen the guide.
  if(count(after)>count(before))reasons.push('Receiver recipe lengthened the guide');
  return {reasons,handlingBefore:oldHandling,handlingAfter:handling};
}

/** Reconsider repair boundaries using validated receiver and child contacts. */
export function replanReceiverRecipes(result,{allowChildStrengthAdvisories=false}={}) {
  if(!result.assemblyPlan||!result.instructionPlan||result.assemblyError
    ||result.receiverRecipePlanning?.selected||result.brickModel.bricks.length>1000)return result;
  const proposals=discoverReceiverRecipes(result,{allowChildStrengthAdvisories}),attempts=[];
  for(const proposal of proposals.slice(0,8)){
    try{
      const scheduled=plannedReplay(result,proposal);if(!scheduled)continue;
      const plan=createAssemblyPlan({brickModel:result.brickModel,moduleReplay:scheduled.replay,
        moduleRecipes:result.assemblyPlan.moduleRecipes??null,integratedBuild:result.assemblyPlan.integratedBuild??false,
        allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,
        preferLocalProgress:true,preferLocalFoundations:true});
      // This canonical replay already validates the planned upward operations.
      // Compact it directly; an alternative downward-only rebuild changes the
      // capabilities of the recipe and can reject its valid planned actions.
      for(const module of plan.modules){
        const old=result.assemblyPlan.modules.find(m=>m.id===module.id);
        if(old?.recipeFamily)module.recipeFamily=old.recipeFamily;
        if(old?.repeatContinuation){
          const oldJoin=result.assemblyPlan.steps.find(s=>s.id===old.repeatContinuation.joinSourceStepId);
          const join=oldJoin&&plan.steps.find(s=>s.moduleId===oldJoin.moduleId&&s.kind==='join');
          if(join)module.repeatContinuation={...old.repeatContinuation,joinSourceStepId:join.id};
        }
      }
      const compacted=compactAssemblyPlan(plan);
      let candidate={...result,assemblyPlan:plan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan),
        assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(plan),compaction:compacted.report}};
      candidate=retainUnchangedDiagrams(result,candidate);
      candidate=consolidateConnectionTasks(candidate,[{kind:'receiver-connections',moduleId:proposal.parentId,brickIds:scheduled.upper,underIds:scheduled.lower}]);
      const evidence=validate(result,candidate,proposal);
      const report={...proposal,upper:scheduled.upper,lower:scheduled.lower,tail:scheduled.tail,
        beforeDiagrams:count(result),afterDiagrams:count(candidate),...evidence};
      attempts.push(report);
      if(!evidence.reasons.length)return {...candidate,receiverRecipePlanning:{selected:true,attempts}};
    }catch(error){attempts.push({...proposal,reasons:[error.message]});}
  }
  return attempts.length?{...result,receiverRecipePlanning:{selected:false,attempts}}:result;
}
