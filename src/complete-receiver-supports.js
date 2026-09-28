import {discoverLayeredComponentRecipe} from './component-recipe-discovery.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {shareGroundedRecipes} from './share-grounded-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {replanRecipeTasks,replanRecipeFloors} from './recipe-tasks.js';
import {replanWorkAreaTasks} from './work-area-tasks.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {createGuideSections} from './guide-sections.js';
import {markMirroredAssemblies} from './mirrored-assemblies.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sorted=ids=>[...ids].sort();
const cells=bricks=>sorted(bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)));
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';

/** Removing a receiver exposes complete grounded components, not height slices. */
export function discoverReceiverSupports(plan) {
  const by=new Map(plan.bricks.map(b=>[b.id,b])),owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const adjacency=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b}of plan.graph.edges){adjacency.get(a).push(b);adjacency.get(b).push(a);}
  const proposals=[];
  for(const parent of plan.modules.filter(m=>m.buildContext?.kind==='work-surface'&&!m.recipeFamily&&!m.sharedHandledRecipe)){
    const joinIndex=plan.steps.findIndex(s=>s.moduleId===parent.id&&s.kind==='join'&&!s.nestedRecipe&&!s.issues.length&&direction(s)==='down');
    if(joinIndex<0)continue;
    const excluded=new Set(parent.brickIds),pending=new Set(plan.bricks.filter(b=>!excluded.has(b.id)).map(b=>b.id)),components=[];
    while(pending.size){
      const ids=new Set([pending.values().next().value]);
      for(const id of ids){pending.delete(id);for(const next of adjacency.get(id))if(pending.has(next))ids.add(next);}
      if(ids.size<4||ids.size>80||![...ids].some(id=>by.get(id).y===0)||![...ids].some(id=>adjacency.get(id).some(n=>excluded.has(n))))continue;
      if([...ids].some(id=>{const m=owners.get(id);return m.kind!=='grounded'||m.buildContext||m.recipeFamily||m.sharedHandledRecipe;}))continue;
      if(plan.steps.some(s=>s.newBrickIds.some(id=>ids.has(id))&&(s.kind!=='build'||s.issues.length||direction(s)!=='down')))continue;
      components.push([...ids]);
    }
    if(components.length<2||components.length>8)continue;
    const selected=new Set(components.flat());
    if(!plan.steps.slice(joinIndex+1).some(s=>s.newBrickIds.some(id=>selected.has(id))))continue;
    proposals.push({parent,components});
  }
  return [...proposals,...discoverPrefixSupports(plan)];
}

// Components already built before a shared receiver can still be interleaved.
export function discoverPrefixSupports(plan) {
  const by=new Map(plan.bricks.map(b=>[b.id,b])),adj=new Map(plan.bricks.map(b=>[b.id,[]])),out=[];
  for(const {a,b}of plan.graph.edges){adj.get(a).push(b);adj.get(b).push(a);}
  const protectedModule=m=>['recipeFamily','sharedHandledRecipe','repeatContinuation','componentRecipe','mirroredAssembly'].some(k=>m[k]);
  for(const [index,parent]of plan.modules.entries()) {
    if(parent.buildContext?.kind!=='work-surface'||protectedModule(parent))continue;
    const join=plan.steps.find(s=>s.moduleId===parent.id&&s.kind==='join'&&!s.nestedRecipe&&!s.issues.length&&direction(s)==='down');
    if(!join)continue;
    const prefix=plan.modules.slice(0,index),ids=prefix.flatMap(m=>m.brickIds),selected=new Set(ids);
    if(ids.length<8||ids.length>320||prefix.some(protectedModule))continue;
    if(plan.steps.filter(s=>prefix.some(m=>m.id===s.moduleId)).some(s=>s.kind==='unresolved'||s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning')))continue;
    // Include unfinished low pieces of these supports, without crossing into
    // the receiver or a later handled assembly. Full replay validates insertion.
    const eligible=new Set(plan.modules.slice(index+1).filter(m=>m.kind==='grounded'&&!m.buildContext&&!protectedModule(m)).flatMap(m=>m.brickIds).filter(id=>by.get(id).y<=parent.buildContext.floorY));
    for(const id of selected)for(const other of adj.get(id))if(eligible.has(other))selected.add(other);
    if(selected.size>320)continue;
    const pending=new Set(selected),components=[];
    while(pending.size){const group=new Set([pending.values().next().value]);for(const id of group){pending.delete(id);for(const next of adj.get(id))if(pending.has(next))group.add(next);}components.push([...group]);}
    const receiver=new Set(parent.brickIds);
    if(components.length<2||components.length>8||components.some(group=>group.length<4||group.length>80||!group.some(id=>by.get(id).y===0)||!group.some(id=>adj.get(id).some(n=>receiver.has(n)))))continue;
    if(prefix.some(m=>m.buildContext&&!components.some(group=>m.brickIds.every(id=>group.includes(id)))))continue;
    const owner=new Map(components.flatMap((group,i)=>group.map(id=>[id,i])));
    const sequence=plan.steps.filter(s=>s.newBrickIds.some(id=>selected.has(id))).flatMap(s=>[...new Set(s.newBrickIds.filter(id=>selected.has(id)).map(id=>owner.get(id)))]);
    const runs=sequence.filter((id,i)=>!i||sequence[i-1]!==id);
    if(new Set(runs).size===runs.length)continue;
    out.push({parent,components,kind:'prefix-components'});
  }
  return out;
}

function complete(before,{parent,components,kind}) {
  const old=before.assemblyPlan,moved=new Set(components.flat()),owners=new Set(old.modules.filter(m=>m.brickIds.some(id=>moved.has(id))).map(m=>m.id));
  const recipes=replayNestedRecipes(old)??{},originalReplay=recipeReplay(old,{preservePlacements:true});
  const byId=new Map(old.bricks.map(b=>[b.id,b]));
  const newModules=kind==='prefix-components'?components.flatMap((ids,i)=>{
    const prefix=`${parent.id}-support-${i+1}-`,selected=new Set(ids);
    // Keep a proven small assembly and its real attachment inside this component.
    if(old.modules.some(m=>m.buildContext&&m.brickIds.every(id=>selected.has(id)))){
      return originalReplay.filter(m=>m.brickIds.some(id=>selected.has(id))).map(m=>{
        const part=restrictRecipe(m,m.brickIds.filter(id=>selected.has(id)));
        return {...part,id:m.buildContext?m.id:prefix+m.id,label:`Base assembly ${i+1}`,...(!m.buildContext?{actionOrder:false,placementGroups:undefined}: {})};
      });
    }
    const {recipe}=discoverLayeredComponentRecipe(ids.map(id=>byId.get(id)));
    for(const [id,nested]of Object.entries(recipe.moduleRecipes??{}))recipes[prefix+id]=nested;
    return recipe.moduleReplay.map(child=>({...child,id:prefix+child.id,label:`Base assembly ${i+1}`,actionOrder:true,
      placementGroups:recipe.diagramGroups.filter(group=>group.every(id=>child.brickIds.includes(id)))}));
  }):components.map((ids,i)=>({id:`${parent.id}-support-${i+1}`,label:`Base assembly ${i+1}`,kind:'grounded',brickIds:ids,brickOrder:ids}));
  const changed=new Set([...owners,...newModules.map(m=>m.id)]),replay=[];let inserted=false;
  for(const module of originalReplay){
    if(!inserted&&owners.has(module.id)){replay.push(...newModules);inserted=true;}
    const retained=restrictRecipe(module,module.brickIds.filter(id=>!moved.has(id)));
    if(retained.brickIds.length)replay.push(retained);
  }
  const plan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:recipes,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  const completedIds=new Set(newModules.map(m=>m.id));
  plan.modules=plan.modules.map(m=>completedIds.has(m.id)?{...m,componentRecipe:{receiverModuleId:parent.id}}:m);
  const context=(p,ids)=>({...p,steps:p.steps.map(s=>!changed.has(s.moduleId)&&s.visibleBrickIds.some(id=>moved.has(id))
    ?{...s,visibleBrickIds:[...new Set([...s.visibleBrickIds.filter(id=>!moved.has(id)),...ids])]}:s)});
  const expected={...before,assemblyPlan:context(old,[...moved]),instructionPlan:context(before.instructionPlan,[...moved])};
  let candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...before,assemblyPlan:plan},{moduleReplay:replay})));
  candidate=replanWorkAreaTasks(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds:changed}),{moduleIds:changed}),{consolidateCourses:true,moduleIds:changed});
  candidate=retainUnchangedDiagrams(expected,candidate);
  const moduleIds=new Set(newModules.map(m=>m.id));candidate=shareGroundedRecipes(candidate,moduleIds);
  const next=candidate.assemblyPlan,supports=next.modules.filter(m=>moduleIds.has(m.id)),ids=supports.flatMap(m=>m.brickIds);
  if(!same(cells(old.bricks),cells(next.bricks)))throw Error('Component completion changed colored geometry');
  if(!same(sorted(unresolvedCells(old)),sorted(unresolvedCells(next))))throw Error('Component completion changed failed geometry');
  if(!same(sorted(next.steps.flatMap(s=>s.newBrickIds)),sorted(next.bricks.map(b=>b.id)))
    ||!same(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id)))throw Error('Incomplete source coverage');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const current=next.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
    if(!current||current.issues.length||direction(current)!==direction(join)||!same(contactCells(old,join),contactCells(next,current)))throw Error('Existing attachment changed');
  }
  const outside=p=>p.steps.filter(s=>!changed.has(s.moduleId)).map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,
    visible:sorted(s.visibleBrickIds),direction:direction(s),issues:s.issues}));
  if(!same(outside(context(before.instructionPlan,ids)),outside(candidate.instructionPlan)))throw Error('Unrelated diagram tasks changed');
  const joinIndex=next.steps.findIndex(s=>s.moduleId===parent.id&&s.kind==='join'&&!s.nestedRecipe);
  if(next.steps.some((s,i)=>moduleIds.has(s.moduleId)&&(i>=joinIndex||s.kind==='unresolved'||s.issues.some(i=>i.severity==='error'))))throw Error('Components do not complete before receiver');
  const warningKey=i=>JSON.stringify([i.code,i.severity,sorted(i.brickIds??[])]);
  const oldWarnings=new Set(old.steps.flatMap(s=>s.issues).map(warningKey));
  if(next.steps.filter(s=>moduleIds.has(s.moduleId)).flatMap(s=>s.issues).some(i=>!oldWarnings.has(warningKey(i))))throw Error('Component recipe introduced a new connection warning');
  const views=chooseInstructionSequence(candidate.instructionPlan);
  if(candidate.instructionPlan.steps.filter(s=>changed.has(s.moduleId)&&s.kind==='build'&&direction(s)!=='up').some(s=>!views.get(s.id)?.passes||views.get(s.id)?.truncated))throw Error('Component additions are obscured');
  const oldView=createBookletPresentation(before),view=createBookletPresentation(candidate);
  const repeats=v=>v.presentation.sections.filter(s=>s.repeatCount>1).map(s=>JSON.stringify(s.instances.map(i=>sorted(i.brickIds)).sort()));
  if(repeats(oldView).some(r=>!repeats(view).includes(r)))throw Error('Existing repetition changed');
  if(view.numbering.diagramCount>oldView.numbering.diagramCount)throw Error('Complete components fragment the whole guide');
  if(candidate.instructionPlan.steps.filter(s=>s.tableRecipe).some(s=>!candidate.instructionPlan.steps.some(t=>t.id===s.tableRecipe.completionStepId)))throw Error('Stale table reference');
  const histogram={};for(const b of next.bricks){const key=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[key]=(histogram[key]??0)+1;}
  candidate=markMirroredAssemblies(candidate,moduleIds);
  if(kind==='prefix-components') {
    const definitions=components.map((ids,index)=>{
      const moduleIds=newModules.filter(m=>m.brickIds.some(id=>ids.includes(id))).map(m=>m.id);
      return {id:`${parent.id}-component-${index+1}`,receiverModuleId:parent.id,moduleIds,
        brickIds:candidate.assemblyPlan.modules.filter(m=>moduleIds.includes(m.id)).flatMap(m=>m.brickIds)};
    });
    const annotate=plan=>({...plan,modules:plan.modules.map(m=>{
      const componentRecipe=definitions.find(c=>c.moduleIds.includes(m.id));
      return componentRecipe?{...m,componentRecipe}:m;
    })});
    candidate={...candidate,assemblyPlan:annotate(candidate.assemblyPlan),instructionPlan:annotate(candidate.instructionPlan)};
    candidate.guide=createGuideSections(candidate.instructionPlan);
    const groupedView=createBookletPresentation(candidate);
    if(repeats(view).some(r=>!repeats(groupedView).includes(r)))throw Error('Logical sections changed existing repetition');
    if(groupedView.numbering.diagramCount!==view.numbering.diagramCount)throw Error('Logical sections changed diagram coverage');
  }
  return {...candidate,metrics:{...candidate.metrics,brickCount:next.bricks.length,partHistogram:histogram},assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(next)}};
}

export function completeReceiverSupports(before) {
  if(!before.instructionPlan||before.assemblyError||!before.assemblyPlan||before.brickModel.bricks.length>1000||before.receiverSupportCompletion?.selected)return before;
  const attempts=[];
  for(const proposal of discoverReceiverSupports(before.assemblyPlan).slice(0,4))try{
    const result=complete(before,proposal);
    return {...result,receiverSupportCompletion:{selected:true,...(proposal.kind?{kind:proposal.kind}:{}),parentId:proposal.parent.id,componentSizes:proposal.components.map(c=>c.length),attempts}};
  }catch(error){attempts.push({parentId:proposal.parent.id,reasons:[error.message]});}
  return attempts.length?{...before,receiverSupportCompletion:{selected:false,attempts}}:before;
}
