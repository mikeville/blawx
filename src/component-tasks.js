import {createRectangularLayerGroups} from './rectangular-layer-groups.js';
import {chooseInstructionView,chooseInstructionSequence} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const faceTouch=(a,b)=>(a.x+a.w===b.x||b.x+b.w===a.x)&&a.z<b.z+b.d&&b.z<a.z+a.d
  ||(a.z+a.d===b.z||b.z+b.d===a.z)&&a.x<b.x+b.w&&b.x<a.x+a.w;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));
const order=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x||a.id.localeCompare(b.id);

function layerRegions(bricks){
  const pending=new Set(bricks),groups=[];
  while(pending.size){
    const group=new Set([pending.values().next().value]);
    for(const b of group){pending.delete(b);for(const next of pending)if(next.y===b.y&&next.color===b.color&&faceTouch(b,next))group.add(next);}
    groups.push([...group].sort(order));
  }
  return groups;
}

function taskGraph(groups,dependencies){
  const owners=new Map(groups.flatMap((g,i)=>g.map(b=>[b.id,i]))),edges=groups.map(()=>new Set()),incoming=groups.map(()=>new Set());
  for(const [lower,upper]of dependencies){const a=owners.get(lower),b=owners.get(upper);if(a!==b){edges[a].add(b);incoming[b].add(a);}}
  return {edges,incoming};
}
function topological(groups,dependencies){
  const {incoming}=taskGraph(groups,dependencies),pending=new Set(groups.map((_,i)=>i)),result=[];
  while(pending.size){
    const ready=[...pending].filter(i=>[...incoming[i]].every(j=>!pending.has(j))).sort((a,b)=>order(groups[a][0],groups[b][0]));
    if(!ready.length)return null;
    const i=ready[0];result.push(i);pending.delete(i);
  }
  return result;
}

// Geometric contact establishes prerequisites, not necessarily task ownership.
// Contract only adjacent same-color courses whose combined task keeps the
// dependency graph acyclic. A required intervening feature prevents the merge.
export function discoverComponentTasks(bricks,{completeWorkAreas=false}={}){
  if(bricks.length>400)return null;
  const dependencies=[];
  for(let i=0;i<bricks.length;i++)for(let j=i+1;j<bricks.length;j++){
    const a=bricks[i],b=bricks[j];if(a.y!==b.y&&overlap(a,b))dependencies.push(a.y<b.y?[a.id,b.id]:[b.id,a.id]);
  }
  let groups=layerRegions(bricks),merges=0;
  if(groups.length>(completeWorkAreas?256:100))return null;
  while(true){
    const choices=[];
    for(let a=0;a<groups.length;a++)for(let b=a+1;b<groups.length;b++){
      const first=groups[a],second=groups[b];
      if(first[0].color!==second[0].color||first.length+second.length>(completeWorkAreas?128:64)
        ||!first.some(x=>second.some(y=>Math.abs(x.y-y.y)===1&&overlap(x,y))))continue;
      const combined=[...first,...second].sort(order);
      if(Math.max(...combined.map(p=>p.x+p.w))-Math.min(...combined.map(p=>p.x))>16
        ||Math.max(...combined.map(p=>p.z+p.d))-Math.min(...combined.map(p=>p.z))>16)continue;
      choices.push({a,b,combined});
    }
    choices.sort((a,b)=>a.combined.length-b.combined.length||order(a.combined[0],b.combined[0]));
    let selected;
    for(const choice of choices){
      const candidate=groups.flatMap((g,i)=>i===choice.a?[choice.combined]:i===choice.b?[]:[g]);
      if(topological(candidate,dependencies)){selected=candidate;break;}
    }
    if(!selected)break;groups=selected;merges++;
  }
  // Compact diagram tasks require stud contact and an occupied footprint.
  // Complete work areas can also own a contrasting inset inside their envelope;
  // the enclosing planner validates the full physical sequence before adoption.
  let absorbed=true;
  while(absorbed){
    absorbed=false;
    for(let a=0;a<groups.length&&!absorbed;a++)for(let b=0;b<groups.length&&!absorbed;b++){
      if(a===b)continue;
      const parent=groups[a],child=groups[b],floor=Math.min(...parent.map(p=>p.y)),top=Math.max(...parent.map(p=>p.y));
      if(parent.length<4||top===floor||parent.length+child.length>64
        ||child.some(p=>(completeWorkAreas?p.y<floor:p.y<=floor)||p.y>top+1)
        ||!parent.some(p=>child.some(c=>(Math.abs(p.y-c.y)===1&&overlap(p,c))
          ||(completeWorkAreas&&p.y===c.y&&faceTouch(p,c)))))continue;
      if(completeWorkAreas){
        // A supported work area can contain a contrasting inset in a material
        // gap. Side contact defines the task only; physical replay still has
        // to prove every placement, and this does not create a liftable recipe.
        if(child.some(p=>p.x<Math.min(...parent.map(b=>b.x))||p.x+p.w>Math.max(...parent.map(b=>b.x+b.w))
          ||p.z<Math.min(...parent.map(b=>b.z))||p.z+p.d>Math.max(...parent.map(b=>b.z+b.d))))continue;
      }else{
        const footprint=new Set(parent.flatMap(p=>Array.from({length:p.w*p.d},(_,i)=>`${p.x+i%p.w},${p.z+Math.floor(i/p.w)}`)));
        if(child.some(p=>Array.from({length:p.w*p.d},(_,i)=>`${p.x+i%p.w},${p.z+Math.floor(i/p.w)}`).some(k=>!footprint.has(k))))continue;
      }
      const merged=[...parent,...child].sort(order),candidate=groups.flatMap((g,i)=>i===a?[merged]:i===b?[]:[g]);
      if(topological(candidate,dependencies)){groups=candidate;merges++;absorbed=true;}
    }
  }
  const sequence=topological(groups,dependencies);
  if(!sequence)return null;
  return {tasks:sequence.map(i=>groups[i]),merges};
}

const clean=s=>s.kind==='build'&&s.newBrickIds.length&&!s.issues.length
  &&(s.insertionDirection??'down')==='down'&&sameSet(s.newBrickIds,s.highlightBrickIds)
  &&!s.instructionAction&&!s.tableRecipe&&!s.placementTask&&!s.groundLayout&&!s.componentTask;
function references(plan,steps){return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,
  maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
  planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};}
function taskReturns(ids,tasks){
  const owner=new Map(tasks.flatMap((t,i)=>t.map(b=>[b.id,i])));let previous,visits=0;
  for(const id of ids){const next=owner.get(id);if(next!==previous)visits++;previous=next;}
  return visits-tasks.length;
}

export function regroupSupportedRun(result,start,end,discover=discoverComponentTasks,eligible=clean,{balancePanels=false,minimumTaskReturns=2,minimumSavedDiagrams=0,tableFloor=null,preserveNestedContext=false,flatTableCourse=false,supportedCourse=false}={}){
  const plan=result.instructionPlan,old=plan.steps.slice(start,end),byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const ids=old.flatMap(s=>s.newBrickIds),bricks=ids.map(id=>byId.get(id));
  // A flat table course can be a complete task even when it is small. The
  // larger minimum belongs to multi-course work-area discovery, not to three
  // or more diagrams that merely divide one supported base layer.
  if(bricks.length<(flatTableCourse||supportedCourse?3:24)||bricks.length>800)return null;
  const discovered=discover(bricks);
  if(!discovered||taskReturns(ids,discovered.tasks)<minimumTaskReturns)return null;
  if(flatTableCourse){
    if(tableFloor===null||bricks.some(b=>b.y!==tableFloor))return null;
    // Separate floor regions remain separate tasks below. Consolidate within
    // each region instead of rejecting the entire course because it has gaps.
  }else if(supportedCourse){
    if(tableFloor===null||new Set(bricks.map(b=>b.y)).size!==1||bricks[0].y<=tableFloor)return null;
  }else if(!discovered.merges)return null;
  const sourceIds=old.flatMap(s=>s.sourceStepIds),sourceStart=result.assemblyPlan.steps.findIndex(s=>s.id===sourceIds[0]);
  const sources=result.assemblyPlan.steps.slice(sourceStart,sourceStart+sourceIds.length);
  if(sourceStart<0||sources.some((s,i)=>s.id!==sourceIds[i]||!eligible(s))||!sameSet(sources.flatMap(s=>s.newBrickIds),ids))return null;
  if(tableFloor!==null){
    const expected=old[0].nestedRecipe?.floorY??plan.modules.find(m=>m.id===old[0].moduleId)?.buildContext?.floorY;
    if(expected!==tableFloor||bricks.some(b=>b.y<tableFloor)
      ||[...old,...sources].some(s=>s.moduleId!==old[0].moduleId
        ||JSON.stringify(s.nestedRecipe??null)!==JSON.stringify(old[0].nestedRecipe??null)
        ||JSON.stringify(s.nestedRecipePath??null)!==JSON.stringify(old[0].nestedRecipePath??null)))return null;
  }
  const range=new Set(ids),initial=old[0].visibleBrickIds.filter(id=>!range.has(id)),scene=initial.map(id=>byId.get(id));
  const previousSupports=new Map();
  for(const s of sources){const before=s.visibleBrickIds.filter(id=>!s.newBrickIds.includes(id)).map(id=>byId.get(id));
    for(const id of s.newBrickIds){const b=byId.get(id);previousSupports.set(id,before.filter(p=>p.y===b.y-1&&overlap(p,b)).map(p=>p.id));}}
  const canonical=[],diagrams=[];let operation=0;
  for(const [taskIndex,task]of discovered.tasks.entries()){
    const taskId=`${old[0].id}-component-${taskIndex+1}`,groups=createRectangularLayerGroups(task,{maxBricks:24,maxSpan:24,maxPartTypes:8,balancePanels});
    for(const group of groups){
      const newIds=group.brickIds,additions=newIds.map(id=>byId.get(id));
      for(const b of additions){const supports=scene.filter(p=>p.y===b.y-1&&overlap(p,b)).map(p=>p.id);
        if((!supports.length&&b.y!==tableFloor)||!sameSet(supports,previousSupports.get(b.id))||scene.some(p=>p.y>b.y&&overlap(p,b)))return null;}
      const visible=[...scene,...additions];
      const view=chooseInstructionView({visibleBricks:visible,highlightedIds:newIds});
      if(!view.passes||view.truncated)return null;
      const local=[];
      for(let offset=0;offset<newIds.length;offset+=12){
        const part=newIds.slice(offset,offset+12);scene.push(...part.map(id=>byId.get(id)));
        const step={id:`${old[0].id}-component-operation-${++operation}`,moduleId:old[0].moduleId,label:'Build this section',kind:'build',
          newBrickIds:part,highlightBrickIds:[...part],visibleBrickIds:scene.map(b=>b.id),issues:[],insertionDirection:'down',componentTask:{id:taskId},
          ...(preserveNestedContext&&old[0].nestedRecipe?{nestedRecipe:{...old[0].nestedRecipe}}:{}),
          ...(preserveNestedContext&&old[0].nestedRecipePath?{nestedRecipePath:structuredClone(old[0].nestedRecipePath)}:{})};
        canonical.push(step);local.push(step);
      }
      diagrams.push({...local.at(-1),id:`${taskId}-course-${group.course}-${diagrams.length}`,newBrickIds:newIds,highlightBrickIds:[...newIds],
        sourceStepIds:local.map(s=>s.id),orderedOperations:local.map(s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
    }
  }
  for(let i=0;i<diagrams.length-1;){
    const first=diagrams[i],second=diagrams[i+1],ids=[...first.newBrickIds,...second.newBrickIds],bs=ids.map(id=>byId.get(id));
    if(first.componentTask.id!==second.componentTask.id||ids.length>12
      ||Math.max(...bs.map(b=>b.y))-Math.min(...bs.map(b=>b.y))>2){i++;continue;}
    const view=chooseInstructionView({visibleBricks:second.visibleBrickIds.map(id=>byId.get(id)),highlightedIds:ids});
    if(!view.passes||view.truncated){i++;continue;}
    diagrams.splice(i,2,{...second,id:first.id,newBrickIds:ids,highlightBrickIds:[...ids],
      sourceStepIds:[...first.sourceStepIds,...second.sourceStepIds],orderedOperations:[...first.orderedOperations,...second.orderedOperations]});
  }
  if(!sameSet(scene.map(b=>b.id),old.at(-1).visibleBrickIds)||diagrams.length>old.length-minimumSavedDiagrams)return null;
  for(const diagram of diagrams){const task=diagrams.filter(s=>s.componentTask.id===diagram.componentTask.id);
    diagram.componentTask={...diagram.componentTask,index:task.indexOf(diagram)+1,total:task.length,lastStepId:task.at(-1).id};}
  const assemblyPlan=references(result.assemblyPlan,[...result.assemblyPlan.steps.slice(0,sourceStart),...canonical,...result.assemblyPlan.steps.slice(sourceStart+sourceIds.length)]);
  const instructionPlan=references(plan,[...plan.steps.slice(0,start),...diagrams,...plan.steps.slice(end)]);
  if(!sameSet(instructionPlan.steps.flatMap(s=>s.newBrickIds),plan.bricks.map(b=>b.id))
    ||JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id)))return null;
  const oldViews=chooseInstructionSequence(plan),newViews=chooseInstructionSequence(instructionPlan);
  const unreadable=views=>new Set([...views].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id));
  const oldBad=unreadable(oldViews),newBad=unreadable(newViews);
  if([...newBad].some(id=>!oldBad.has(id)))return null;
  const report={moduleId:old[0].moduleId,beforeDiagrams:old.length,afterDiagrams:diagrams.length,
    beforeTaskReturns:taskReturns(ids,discovered.tasks),afterTaskReturns:0,tasks:discovered.tasks.map(t=>t.map(b=>b.id)),oldSourceStepIds:sourceIds};
  return {...result,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),
    componentTaskPlanning:{selected:true,...report},assemblyEvaluation:{...result.assemblyEvaluation,after:assessAssemblyQuality(assemblyPlan),
      compaction:{...result.assemblyEvaluation?.compaction,sourceStepCount:assemblyPlan.steps.length,instructionDiagramCount:instructionPlan.steps.length,
        mergedDiagramCount:instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length,collapsedStepCount:assemblyPlan.steps.length-instructionPlan.steps.length,
        sourceStepCoverageComplete:true,brickCoverageComplete:true}}};
}

export function completeComponentTasks(result){
  const plan=result.instructionPlan;
  if(!plan||!result.assemblyPlan||result.assemblyError||plan.bricks.length>1000||result.componentTaskPlanning?.selected)return result;
  const repeated=new Set(deriveGuidePresentation({plan,guide:result.guide}).sections.filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(plan.modules.filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const eligible=s=>clean(s)&&s.newBrickIds.every(id=>byId.get(id).y>0);
  let current=result;const changes=[];
  for(let start=0;start<current.instructionPlan.steps.length;){
    const steps=current.instructionPlan.steps,first=steps[start];
    if(!eligible(first)||protectedModules.has(first.moduleId)){start++;continue;}
    let end=start+1;while(end<steps.length&&steps[end].moduleId===first.moduleId&&eligible(steps[end]))end++;
    if(end-start>=6){
      const runBricks=steps.slice(start,end).flatMap(s=>s.newBrickIds.map(id=>byId.get(id)));
      const next=new Set(runBricks.map(b=>b.color)).size<2?null:regroupSupportedRun(current,start,end);
      if(next){changes.push(next.componentTaskPlanning);current=next;start+=next.componentTaskPlanning.afterDiagrams;continue;}
    }
    start=end;
  }
  return changes.length?{...current,componentTaskPlanning:{...changes[0],changes}}:result;
}
