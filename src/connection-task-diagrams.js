import {chooseInstructionView} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const down=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&s.insertionDirection!=='up'&&!s.nestedRecipe&&!s.componentTask&&!s.buildRegion&&!s.tableRecipe&&!s.placementTask;

function connected(ids,neighbors){
  if(!ids.size)return false;
  const reached=new Set([ids.values().next().value]);
  for(const id of reached)for(const next of neighbors.get(id)??[])if(ids.has(next))reached.add(next);
  return reached.size===ids.size;
}

function taskDiagram(result,task){
  const plan=result.instructionPlan,canonical=result.assemblyPlan;
  const module=canonical.modules.find(m=>m.id===task.moduleId);
  if(task.kind!=='receiver-connections'||module?.buildContext?.kind!=='work-surface'
    ||!Array.isArray(task.brickIds)||task.brickIds.length<2||task.brickIds.length>24
    ||!Array.isArray(task.underIds)||!task.underIds.length)return null;
  const by=new Map(plan.bricks.map(b=>[b.id,b])),ids=new Set(task.brickIds),under=new Set(task.underIds),owned=new Set(module.brickIds);
  if(ids.size!==task.brickIds.length||under.size!==task.underIds.length
    ||[...ids,...under].some(id=>!owned.has(id))||[...under].some(id=>ids.has(id)))return null;
  const parts=[...ids].map(id=>by.get(id));
  if(new Set(parts.map(b=>b.y)).size!==1||new Set(parts.map(b=>b.color)).size>4)return null;
  const width=Math.max(...parts.map(b=>b.x+b.w))-Math.min(...parts.map(b=>b.x));
  const depth=Math.max(...parts.map(b=>b.z+b.d))-Math.min(...parts.map(b=>b.z));
  if(width>32||depth>32)return null;
  const positions=plan.steps.flatMap((s,i)=>s.newBrickIds.some(id=>ids.has(id))?[i]:[]);
  if(positions.length<2||positions.at(-1)-positions[0]+1!==positions.length)return null;
  const steps=positions.map(i=>plan.steps[i]),first=steps[0],last=steps.at(-1);
  const introduced=steps.flatMap(s=>s.newBrickIds);
  if(introduced.length!==ids.size||introduced.some(id=>!ids.has(id))
    ||steps.some(s=>s.moduleId!==module.id||!down(s)||!same(s.newBrickIds,s.highlightBrickIds)))return null;
  const sourceMap=new Map(canonical.steps.map((s,i)=>[s.id,{s,i}]));
  const sources=steps.flatMap(s=>s.sourceStepIds.map(id=>sourceMap.get(id)));
  if(sources.some(x=>!x||!down(x.s)||x.s.moduleId!==module.id)
    ||sources.at(-1).i-sources[0].i+1!==sources.length
    ||!same(sources.flatMap(x=>x.s.newBrickIds),introduced)
    ||!same(steps.flatMap(s=>s.orderedOperations.map(o=>o.id)),sources.map(x=>x.s.id)))return null;
  const group=sources[0].s.placementGroupId;
  if(!group||sources.some(x=>x.s.placementGroupId!==group))return null;
  const wholeGroup=canonical.steps.filter(s=>s.moduleId===module.id&&s.placementGroupId===group).flatMap(s=>s.newBrickIds);
  if(!same(wholeGroup,introduced))return null;
  // The planner's purpose is evidence to check, not permission to group any
  // sparse course. Each connection must sit on the already connected receiver
  // and provide the real upper bond for a later upward insertion.
  const prior=new Set(first.visibleBrickIds.filter(id=>!ids.has(id))),neighbors=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b}of canonical.graph.edges){neighbors.get(a).push(b);neighbors.get(b).push(a);}
  const receiver=new Set([...prior].filter(id=>owned.has(id)));
  if(!connected(receiver,neighbors))return null;
  const future=new Map(canonical.steps.slice(sources.at(-1).i+1).flatMap(s=>s.newBrickIds.map(id=>[id,s])));
  for(const id of under){const s=future.get(id);
    if(!s||s.moduleId!==module.id||s.kind!=='build'||s.issues.length||s.insertionDirection!=='up'
      ||s.nestedRecipe||by.get(id).y!==parts[0].y-1)return null;
  }
  for(const part of parts){
    if(!neighbors.get(part.id).some(id=>receiver.has(id)&&by.get(id).y===part.y-1)
      ||!neighbors.get(part.id).some(id=>under.has(id))
      ||[...prior].some(id=>by.get(id).y>part.y&&overlap(by.get(id),part)))return null;
  }
  if(!same([...new Set([...prior,...ids])].sort(),[...last.visibleBrickIds].sort()))return null;
  const view=chooseInstructionView({visibleBricks:last.visibleBrickIds.map(id=>by.get(id)),highlightedIds:introduced});
  if(!view.passes||view.truncated)return null;
  return {positions,step:{...last,id:first.id,label:`${first.label.split(' · add ')[0]} · add ${introduced.length} bricks`,
    newBrickIds:introduced,highlightBrickIds:[...introduced],sourceStepIds:steps.flatMap(s=>s.sourceStepIds),
    orderedOperations:steps.flatMap(s=>s.orderedOperations),connectionTask:{kind:task.kind,moduleId:module.id,
      brickIds:[...task.brickIds],underIds:[...task.underIds],sourceDiagramIds:steps.map(s=>s.id)}}};
}

/** Keep a proven connection task together without changing its source operations. */
export function consolidateConnectionTasks(result,tasks){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError)return result;
  let current=result;const changes=[];
  for(const task of tasks){
    const merged=taskDiagram(current,task);if(!merged)continue;
    const before=current.instructionPlan,steps=[...before.steps];
    steps.splice(merged.positions[0],merged.positions.length,merged.step);
    for(const key of ['newBrickIds','sourceStepIds','orderedOperations'])if(!same(steps.flatMap(s=>s[key]),before.steps.flatMap(s=>s[key])))throw Error('Connection task changed source coverage or order');
    const instructionPlan={...before,steps,stats:{...before.stats,stepCount:steps.length,
      maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
      planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
    changes.push({...merged.step.connectionTask,beforeDiagrams:merged.positions.length,afterDiagrams:1});
    current={...current,instructionPlan,guide:createGuideSections(instructionPlan),assemblyEvaluation:{...current.assemblyEvaluation,
      compaction:{...current.assemblyEvaluation?.compaction,instructionDiagramCount:steps.length,
        collapsedStepCount:current.assemblyPlan.steps.length-steps.length,mergedDiagramCount:steps.filter(s=>s.sourceStepIds.length>1).length}}};
  }
  return changes.length?{...current,connectionTaskPlanning:{selected:true,changes}}:result;
}
