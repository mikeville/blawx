import {createAssemblyPlan} from './assembly.js';
import {createGuideSections} from './guide-sections.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {assemblyRejectionReasons} from './refine-construction.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const operation=s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,
  insertionDirection:s.insertionDirection??'down',issues:s.issues});

function preserveOperations(original,validated,removedId,insertedId) {
  const replacements=new Map(),byId=new Map(original.bricks.map(b=>[b.id,b]));
  const joinContacts=s=>s.joinContext?{direction:s.joinContext.direction,contacts:s.joinContext.supportGroups.flatMap(g=>g.contacts)}:null;
  for(const module of original.modules.filter(m=>m.id!==removedId)) {
    const old=original.steps.filter(s=>s.moduleId===module.id),next=validated.steps.filter(s=>s.moduleId===module.id);
    let cursor=0;
    for(const step of old) {
      const sequence=[];let count=0;
      do {const nextStep=next[cursor++];if(!nextStep)return null;sequence.push(nextStep);count+=nextStep.newBrickIds.length;}
      while(count<step.newBrickIds.length);
      const newIds=sequence.flatMap(s=>s.newBrickIds);
      // Disjoint same-course additions commute; retain their original order.
      const sameCourse=new Set(step.newBrickIds.map(id=>byId.get(id).y)).size===1;
      const sameAdditions=same(newIds,step.newBrickIds)||(sameCourse&&same([...newIds].sort(),[...step.newBrickIds].sort()));
      if(!sameAdditions
        ||sequence.some(s=>s.kind!==step.kind||(s.insertionDirection??'down')!==(step.insertionDirection??'down'))
        ||!same(sequence.flatMap(s=>s.issues),step.issues)
        ||step.kind==='join'&&!same(joinContacts(sequence.at(-1)),joinContacts(step)))return null;
      replacements.set(step.id,{...step,visibleBrickIds:sequence.at(-1).visibleBrickIds,
        ...(step.joinContext?{joinContext:sequence.at(-1).joinContext}:{})});
    }
    if(cursor!==next.length)return null;
  }
  const added=validated.steps.filter(s=>s.moduleId===insertedId).map((s,i)=>({...s,id:`${insertedId}-step-${i+1}`}));
  if(!added.length||added.some(s=>s.kind!=='build'||s.issues.length||s.insertionDirection!=='up'))return null;
  return {replacements,added};
}

function tryAfterJoin(result,module,join) {
  const original=result.assemblyPlan,insertedId=`${module.id}-under`;
  const descriptors=original.modules.filter(m=>m.id!==module.id).flatMap(m=>{
    const steps=original.steps.filter(s=>s.moduleId===m.id&&s.newBrickIds.length);
    const descriptor={id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,brickIds:m.brickIds,
      actionOrder:true,brickOrder:steps.flatMap(s=>s.newBrickIds),placementGroups:steps.map(s=>s.newBrickIds),
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:'planned-actions'}}:{})};
    return m.id===join.moduleId?[descriptor,{id:insertedId,label:'Underside details',kind:'grounded',
      groupType:'continuation',brickIds:module.brickIds,brickOrder:module.brickIds}]:[descriptor];
  });
  const validated=createAssemblyPlan({brickModel:result.brickModel,moduleReplay:descriptors,
    integratedBuild:original.integratedBuild??false,allowUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  if(assemblyRejectionReasons(original,validated).length
    ||validated.stats.unresolvedBrickCount>=original.stats.unresolvedBrickCount)return null;
  const preserved=preserveOperations(original,validated,module.id,insertedId);
  if(!preserved)return null;
  const {replacements,added}=preserved;
  const oldModules=new Map(original.modules.map(m=>[m.id,m]));
  const modules=validated.modules.map(m=>oldModules.get(m.id)??m);
  const sources=original.steps.filter(s=>s.moduleId!==module.id).flatMap(s=>s.id===join.id
    ?[replacements.get(s.id),...added]:[replacements.get(s.id)]);
  const diagrams=result.instructionPlan.steps.filter(s=>s.moduleId!==module.id).flatMap(s=>{
    const last=replacements.get(s.sourceStepIds.at(-1));if(!last)throw Error('Missing canonical operation');
    const updated={...s,visibleBrickIds:last.visibleBrickIds,...(s.joinContext?{joinContext:last.joinContext}:{})};
    if(!s.sourceStepIds.includes(join.id))return [updated];
    return [updated,...added.map(step=>({...step,id:`diagram-${step.id}`,sourceStepIds:[step.id],orderedOperations:[operation(step)]}))];
  });
  if(!same(diagrams.flatMap(s=>s.sourceStepIds),sources.map(s=>s.id)))return null;
  const all=sources.flatMap(s=>s.newBrickIds);
  if(all.length!==original.bricks.length||new Set(all).size!==all.length)return null;
  const revise=(plan,steps)=>({...plan,modules,steps,limitations:validated.limitations,
    stats:{...plan.stats,...validated.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
      planReferenceCount:steps.reduce((n,s)=>n+s.visibleBrickIds.length+s.newBrickIds.length+s.highlightBrickIds.length,0)}});
  const assemblyPlan=revise(original,sources),instructionPlan=revise(result.instructionPlan,diagrams);
  return {...result,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),
    assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(assemblyPlan),compaction:{...result.assemblyEvaluation.compaction,
      sourceStepCount:sources.length,instructionDiagramCount:diagrams.length,
      collapsedStepCount:sources.length-diagrams.length,mergedDiagramCount:diagrams.filter(s=>s.sourceStepIds.length>1).length}},
    underAttachmentOrdering:{selected:true,brickIds:module.brickIds,afterJoinId:join.id,
      beforeUnresolved:original.stats.unresolvedBrickCount,afterUnresolved:validated.stats.unresolvedBrickCount}};
}

// Some isolated failures already have a real upper connection, but it belongs
// to a later handled assembly. Reassign those additions to after its join and
// validate the whole replay. Keep every other recipe's literal operations.
export function scheduleUnderAttachments(result) {
  const plan=result.assemblyPlan;
  if(!plan||!result.instructionPlan||result.assemblyError||!plan.stats.rootFailureCount||plan.bricks.length>800)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),upper=new Map(plan.bricks.map(b=>[b.id,new Set()]));
  for(const {a,b} of plan.graph.edges) {
    const lower=byId.get(a).y<byId.get(b).y?a:b;upper.get(lower).add(lower===a?b:a);
  }
  for(const module of plan.modules.filter(m=>m.status==='unresolved'&&m.brickIds.length<=8).slice(0,8)) {
    const steps=plan.steps.filter(s=>s.moduleId===module.id);
    if(!steps.length||steps.some(s=>s.kind!=='unresolved'||!s.newBrickIds.length
      ||s.issues.some(i=>i.code!=='unsupported-addition'))
      ||new Set(module.brickIds.map(id=>byId.get(id).y)).size!==1)continue;
    const joins=plan.steps.filter(s=>s.kind==='join'&&!s.issues.length&&s.joinContext?.direction==='down'
      &&plan.steps.indexOf(s)>plan.steps.indexOf(steps.at(-1))
      &&module.brickIds.every(id=>[...upper.get(id)].some(upperId=>s.highlightBrickIds.includes(upperId))));
    for(const join of joins.slice(0,4))try{const candidate=tryAfterJoin(result,module,join);if(candidate)return candidate;}catch{ /* Keep the original failure when replay cannot validate it. */ }
  }
  return result;
}
