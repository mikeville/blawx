import {planUndersideAssemblies} from './underside-assemblies.js';
import {discoverCompleteComponentRecipe} from './component-recipe-discovery.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=a=>[...a].sort();
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';

function discoverRecipe(bricks) {
  return discoverCompleteComponentRecipe(bricks).recipe;
}

function validateCompletion(before,after) {
  after=restoreUnchangedRecipeMetadata(before,after);
  const a=before.assemblyPlan,b=after.assemblyPlan;
  const newModules=b.modules.filter(m=>!a.modules.some(n=>n.id===m.id));
  const changed=new Set(newModules.map(m=>m.id)),moved=new Set(newModules.flatMap(m=>m.brickIds));
  if(!same(before.brickModel,after.brickModel)||!same(a.bricks,b.bricks))throw Error('Geometry changed');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),b.steps.map(s=>s.id))
    ||!same(sorted(b.steps.flatMap(s=>s.newBrickIds)),sorted(b.bricks.map(v=>v.id))))throw Error('Incomplete operation coverage');
  const oldBad=unresolvedCells(a),bad=unresolvedCells(b);
  if(bad.size>=oldBad.size||[...bad].some(id=>!oldBad.has(id)))throw Error('No complete construction improvement');
  const adjacency=new Map(b.bricks.map(v=>[v.id,new Set()]));
  for(const edge of b.graph.edges){adjacency.get(edge.a).add(edge.b);adjacency.get(edge.b).add(edge.a);}
  const connected=ids=>{const all=new Set(ids);if(!all.size)return false;const seen=new Set([all.values().next().value]);for(const id of seen)for(const next of adjacency.get(id))if(all.has(next))seen.add(next);return seen.size===all.size;};
  for(const step of b.steps.filter(s=>changed.has(s.moduleId))){
    if(step.issues.some(i=>i.severity==='error'))throw Error('Incomplete component');
    if(step.kind==='join'&&(!connected(step.highlightBrickIds)||!connected(step.joinContext.supportGroups.flatMap(g=>g.brickIds))))throw Error('Cannot lift disconnected component or receiver');
  }
  for(const step of a.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const next=b.steps.find(s=>s.kind==='join'&&s.moduleId===step.moduleId&&s.nestedRecipe?.id===step.nestedRecipe?.id);
    if(!next||next.issues.length||direction(next)!==direction(step)||!same(contactCells(a,step),contactCells(b,next)))throw Error('Established attachment changed');
  }
  const tasks=p=>p.steps.filter(s=>s.kind!=='unresolved'&&!changed.has(s.moduleId)&&!s.newBrickIds.some(id=>moved.has(id)))
    .map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,issues:s.issues,direction:direction(s)}));
  if(!same(tasks(before.instructionPlan),tasks(after.instructionPlan)))throw Error('Unrelated tasks changed');
  const repeat=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1)
    .map(s=>({copies:s.repeatCount,steps:s.stepIds.length,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeat(before),repeat(after)))throw Error('Established repetition changed');
  const handling=assessWorkSurfaceQuality(b).modules;
  for(const prior of assessWorkSurfaceQuality(a).modules){
    if(a.modules.find(m=>m.id===prior.moduleId).brickIds.some(id=>moved.has(id)))continue;
    const next=handling.find(m=>m.moduleId===prior.moduleId);
    if(!next||['peakLooseBrickCount','peakComponentCount','firstBondAtAddition','detachedBrickExposure','finalComponentCount'].some(key=>next[key]!==prior[key]))throw Error('Established handling changed');
  }
  const views=chooseInstructionSequence(after.instructionPlan);
  if(after.instructionPlan.steps.filter(s=>changed.has(s.moduleId)&&s.kind==='build'&&direction(s)!=='up')
    .some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))throw Error('Obscured component construction');
  if(after.instructionPlan.steps.some(s=>s.tableRecipe&&!after.instructionPlan.steps.some(t=>t.id===s.tableRecipe.completionStepId)))throw Error('Stale table reference');
  return after;
}

/** Complete bounded hanging components after their receivers, with real inner recipes. */
export function completeUndersideAssemblies(before) {
  if(!before.assemblyPlan||!before.instructionPlan||before.assemblyError||!before.assemblyPlan.stats.unresolvedBrickCount
    ||before.brickModel.bricks.length>1000)return before;
  let current=before;const attempts=[];
  for(let round=0;round<6;round++){
    const next=planUndersideAssemblies(current,{preservePlacements:true,discoverRecipe,prepareCandidate:validateCompletion});
    attempts.push({round,...next.undersideAssemblyPlanning});
    if(!next.undersideAssemblyPlanning?.selected)break;
    current=next;
  }
  return {...current,completeUndersidePlanning:{selected:current!==before,attempts}};
}
