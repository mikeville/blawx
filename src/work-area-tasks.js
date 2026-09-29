import {spatialRegions} from './placement-groups.js';
import {regroupSupportedRun} from './component-tasks.js';
import {deriveGuidePresentation} from './guide-presentation.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const position=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x||a.id.localeCompare(b.id);

// Color is a material choice, not a task boundary. A course includes its inset
// details. Continue a local section across heights until it forks or meets
// another section; shared courses remain explicit prerequisites.
function discoverPartition(bricks,separateContacts){
  const layers=[];
  for(const y of [...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b)){
    const previous=layers.filter(g=>g[0].y===y-1);
    for(const region of spatialRegions(bricks.filter(b=>b.y===y))){
      if(!separateContacts){layers.push(region);continue;}
      const buckets=new Map();
      for(const brick of region){
        const supports=previous.flatMap((g,i)=>g.some(b=>overlap(b,brick))?[i]:[]);
        const key=supports.join(',');
        if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(brick);
      }
      for(const bucket of buckets.values())layers.push(...spatialRegions(bucket));
    }
  }
  const owner=new Map(layers.flatMap((g,i)=>g.map(b=>[b.id,i])));
  const outgoing=layers.map(()=>new Set()),incoming=layers.map(()=>new Set());
  const dependencies=[];
  for(let a=0;a<bricks.length;a++)for(let b=a+1;b<bricks.length;b++){
    const first=bricks[a],second=bricks[b];
    if(first.y===second.y||!overlap(first,second))continue;
    const [lower,upper]=first.y<second.y?[first,second]:[second,first];
    dependencies.push([lower.id,upper.id]);
    if(upper.y===lower.y+1){outgoing[owner.get(lower.id)].add(owner.get(upper.id));incoming[owner.get(upper.id)].add(owner.get(lower.id));}
  }
  const parent=layers.map((_,i)=>i);
  const root=i=>parent[i]===i?i:root(parent[i]);
  for(let i=0;i<layers.length;i++)if(incoming[i].size===1){
    const lower=[...incoming[i]][0];
    if(outgoing[lower].size===1)parent[root(i)]=root(lower);
  }
  const grouped=new Map();
  for(let i=0;i<layers.length;i++){
    const key=root(i);if(!grouped.has(key))grouped.set(key,[]);grouped.get(key).push(...layers[i]);
  }
  const tasks=[...grouped.values()].map(g=>g.sort(position));
  const taskOwner=new Map(tasks.flatMap((g,i)=>g.map(b=>[b.id,i]))),requires=tasks.map(()=>new Set());
  for(const [lower,upper]of dependencies){const a=taskOwner.get(lower),b=taskOwner.get(upper);if(a!==b)requires[b].add(a);}
  const remaining=new Set(tasks.map((_,i)=>i)),ordered=[];
  while(remaining.size){
    const ready=[...remaining].filter(i=>[...requires[i]].every(j=>!remaining.has(j)))
      .sort((a,b)=>position(tasks[a][0],tasks[b][0]));
    if(!ready.length)return null;
    const i=ready[0];remaining.delete(i);ordered.push(tasks[i]);
  }
  return {tasks:ordered,merges:layers.length-tasks.length};
}

export function discoverWorkAreaTasks(bricks){
  // Side contact can join otherwise independent towers into a false task.
  // Compare that interpretation with support-continuous sections. Retain the
  // coarser partition when separating contacts merely fractures an inset or
  // branching crown into more dependent tasks.
  return [discoverPartition(bricks,false),discoverPartition(bricks,true)]
    .filter(Boolean).sort((a,b)=>a.tasks.length-b.tasks.length)[0]??null;
}

export function discoverIndependentWorkAreaTasks(bricks){
  const pending=new Set(bricks),components=[];
  while(pending.size){
    const component=new Set([pending.values().next().value]);
    for(const brick of component){
      pending.delete(brick);
      for(const next of pending)if(Math.abs(brick.y-next.y)===1&&overlap(brick,next))component.add(next);
    }
    components.push([...component]);
  }
  const bounds=group=>({x:Math.min(...group.map(b=>b.x)),X:Math.max(...group.map(b=>b.x+b.w)),
    z:Math.min(...group.map(b=>b.z)),Z:Math.max(...group.map(b=>b.z+b.d))});
  const boxes=components.map(bounds);
  // Side contact does not require interleaving two independently supported
  // sections. Only split substantial multi-course volumes with disjoint
  // footprints: tiny stacked columns and interlocking regions keep the existing
  // task interpretation. Shared foundations outside this run remain in place.
  if(components.length<2||components.some(g=>g.length<24||new Set(g.map(b=>b.y)).size<3)
    ||boxes.some((a,i)=>boxes.slice(i+1).some(b=>a.x<b.X&&b.x<a.X&&a.z<b.Z&&b.z<a.Z)))return discoverWorkAreaTasks(bricks);
  components.sort((a,b)=>Math.min(...a.map(b=>b.y))-Math.min(...b.map(b=>b.y))
    ||bounds(a).z-bounds(b).z||bounds(a).x-bounds(b).x);
  const partitions=components.map(discoverWorkAreaTasks);
  if(partitions.some(p=>!p))return discoverWorkAreaTasks(bricks);
  return {tasks:partitions.flatMap(p=>p.tasks),merges:partitions.reduce((n,p)=>n+p.merges,0)};
}

const eligible=step=>step.kind==='build'&&step.newBrickIds.length>0&&!step.issues.length
  &&(step.insertionDirection??'down')==='down'
  &&step.newBrickIds.length===step.highlightBrickIds.length
  &&step.newBrickIds.every(id=>step.highlightBrickIds.includes(id))
  &&!step.nestedRecipe&&!step.tableRecipe&&!step.groundLayout&&!step.componentTask;

// Optional re-planning of already valid work. Earlier action and region labels
// are proposals, not immutable physical constraints. Actual recipes, repeats,
// joins, unresolved operations and table layouts remain protected.
export function replanWorkAreaTasks(result,{consolidateCourses=false,moduleIds=null}={}){
  if(!result.instructionPlan||!result.assemblyPlan||result.assemblyError
    ||!consolidateCourses&&!moduleIds&&result.workAreaTaskPlanning?.selected||result.brickModel.bricks.length>1000)return result;
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const protectedModules=new Set(result.assemblyPlan.modules
    .filter(m=>m.buildContext||m.brickIds.some(id=>repeated.has(id))).map(m=>m.id));
  const byId=new Map(result.assemblyPlan.bricks.map(b=>[b.id,b]));
  const clean=s=>eligible(s)&&(!moduleIds||moduleIds.has(s.moduleId))&&s.newBrickIds.every(id=>byId.get(id).y>0);
  let current=result;const changes=[];
  for(let start=0;start<current.instructionPlan.steps.length;){
    const steps=current.instructionPlan.steps,first=steps[start];
    if(!clean(first)||protectedModules.has(first.moduleId)){start++;continue;}
    let end=start+1;while(end<steps.length&&steps[end].moduleId===first.moduleId&&clean(steps[end]))end++;
    if(end-start>=6){
      // A sequence can already follow its tasks and still split each course into
      // arbitrary color fragments. Revisit untouched runs after recipes settle,
      // retaining the same support, scope and visibility proofs. Require a real
      // reduction to avoid replacing an equally clear existing interpretation.
      const discover=consolidateCourses?discoverIndependentWorkAreaTasks:discoverWorkAreaTasks;
      const next=regroupSupportedRun(current,start,end,discover,clean,{
        balancePanels:true,...(consolidateCourses?{minimumTaskReturns:0,minimumSavedDiagrams:2}:{})});
      if(next){changes.push(next.componentTaskPlanning);current=next;start+=next.componentTaskPlanning.afterDiagrams;continue;}
    }
    start=end;
  }
  return changes.length?{...current,workAreaTaskPlanning:{selected:true,
    changes:[...(result.workAreaTaskPlanning?.changes??[]),...changes]}}:result;
}
