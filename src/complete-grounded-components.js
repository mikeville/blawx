import {discoverGroundedComponentRecipes} from './grounded-component-recipes.js';
import {discoverLayeredComponentRecipe} from './component-recipe-discovery.js';
import {proposeConnectedPacking} from './connected-packing.js';
import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {replanRecipeTasks,replanRecipeFloors,replanSupportedRecipeCourses} from './recipe-tasks.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {contactCells} from './local-interface-repair.js';
import {unresolvedCells} from './refine-construction.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {inspectConstruction} from './construction.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';

const sorted=items=>[...items].sort(),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const key=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cells=bs=>sorted(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)));
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';

function improveCore(brickModel,core,discover) {
  const initial=discover(core),floors=[...new Set(core.map(b=>b.y))].sort((a,b)=>a-b).filter(y=>y>0).slice(0,6);
  let best={brickModel,core,recipe:initial.recipe,patches:[]};
  for(const floor of floors){
    let model=brickModel,parts=core;const patches=[];
    for(let round=0;round<2;round++){
      const proposal=proposeConnectedPacking(model,{region:parts.filter(b=>b.y>=floor),workSurfaceFloorY:floor,maxChecks:96,maxCandidates:1}).proposals[0];
      if(!proposal)break;
      const removed=new Set(proposal.before.map(key));
      parts=[...parts.filter(b=>!removed.has(key(b))),...proposal.after];
      model={...model,bricks:proposal.bricks};patches.push({before:proposal.before,after:proposal.after});
    }
    if(!patches.length)continue;
    try{
      const found=discover(parts),changedCells=new Set(cells(patches.flatMap(p=>p.after)));
      // The table-floor support allowance must become a real complete handled
      // recipe at that floor, containing all retiled cells, not a fictitious bed.
      const by=new Map(parts.map(b=>[key(b),b]));
      const handled=found.recipe.moduleReplay.find(m=>m.buildContext?.floorY===floor
        &&[...changedCells].every(c=>cells(m.brickIds.map(id=>by.get(id.replace(/^b@/,'')))).includes(c)));
      if(!handled||found.recipe.diagramGroups.length>=best.recipe.diagramGroups.length)continue;
      best={brickModel:model,core:parts,recipe:found.recipe,patches};
    }catch{/* A connected tiling still needs a complete local recipe. */}
  }
  return best;
}

function reconstruct(before,proposal,discover,{repack=true}={}) {
  const old=before.assemblyPlan,by=new Map(old.bricks.map(b=>[b.id,b])),owners=new Set(proposal.affectedModuleIds);
  const indexes=old.modules.flatMap((m,i)=>owners.has(m.id)?[i]:[]);
  if(indexes.some((index,i)=>index!==i))throw Error('Grounded ownership is not a complete lower prefix');
  const selectedOld=new Set([...proposal.cores.flat(),...proposal.receiver]);
  let brickModel=before.brickModel;const local=[],patches=[];
  for(const ids of proposal.cores){
    const core=ids.map(id=>by.get(id)),improved=repack?improveCore(brickModel,core,discover):{brickModel,core,recipe:discover(core).recipe,patches:[]};
    brickModel=improved.brickModel;local.push(improved);patches.push(...improved.patches);
  }
  const identified=createAssemblyPlan({brickModel}).bricks,byKey=new Map(identified.map(b=>[key(b),b.id]));
  const cores=local.map(c=>c.core.map(b=>byKey.get(key(b)))),selectedNew=[...cores.flat(),...proposal.receiver];
  const replay=[],recipes=replayNestedRecipes(old)??{};
  for(const id of owners)delete recipes[id];
  for(const [i,core]of local.entries()){
    const prefix=`grounded-component-${i+1}-`,recipe=core.recipe;
    // Local grounded recipes share the world floor. Their child IDs therefore
    // use the same geometry coordinates, while module names need a namespace.
    for(const child of recipe.moduleReplay)replay.push({...child,id:prefix+child.id,actionOrder:true,
      placementGroups:recipe.diagramGroups.filter(g=>g.every(id=>child.brickIds.includes(id)))});
    for(const [id,nested]of Object.entries(recipe.moduleRecipes??{}))recipes[prefix+id]=nested;
  }
  const receiverId='grounded-components-receiver',receiverParts=proposal.receiver.map(id=>by.get(id)),found=discover(receiverParts);
  replay.push({id:receiverId,label:'Connecting assembly',kind:'detail',groupType:'work-surface',brickIds:proposal.receiver,
    brickOrder:proposal.receiver,buildContext:{kind:'work-surface',floorY:found.floor}});
  recipes[receiverId]=found.recipe;
  for(const m of recipeReplay(old,{preservePlacements:true}).filter(m=>owners.has(m.id))){
    const retained=restrictRecipe(m,m.brickIds.filter(id=>proposal.remaining.includes(id)));
    if(retained.brickIds.length)replay.push({...retained,groupType:'continuation'});
  }
  replay.push(...recipeReplay(old,{preservePlacements:true}).filter(m=>!owners.has(m.id)));
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:recipes,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  const changed=new Set(replay.filter(m=>!old.modules.some(p=>p.id===m.id)).map(m=>m.id));
  const adapt=p=>({...p,steps:p.steps.map(s=>!s.newBrickIds.some(id=>selectedOld.has(id))&&s.visibleBrickIds.some(id=>selectedOld.has(id))
    ?{...s,visibleBrickIds:[...new Set([...s.visibleBrickIds.filter(id=>!selectedOld.has(id)),...selectedNew])]}:s)});
  const expected={...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)};
  let candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...before,brickModel,assemblyPlan},{moduleReplay:replay})));
  candidate=replanSupportedRecipeCourses(replanRecipeFloors(replanRecipeTasks(candidate,{moduleIds:changed}),{moduleIds:changed}),{moduleIds:changed});
  candidate=retainUnchangedDiagrams(expected,candidate);
  const next=candidate.assemblyPlan,priorBad=unresolvedCells(old),bad=unresolvedCells(next);
  if(!same(cells(old.bricks),cells(next.bricks)))throw Error('Grounded completion changed occupied geometry');
  if([...bad].some(c=>!priorBad.has(c)))throw Error('Grounded completion introduced failed geometry');
  if(!same(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id))
    ||!same(sorted(next.steps.flatMap(s=>s.newBrickIds)),sorted(next.bricks.map(b=>b.id))))throw Error('Incomplete construction coverage');
  for(const s of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    // Joins entirely internal to the replaced lower ownership are replanned.
    // Every attachment to the unchanged remainder must keep its real contacts.
    if(s.highlightBrickIds.every(id=>selectedOld.has(id)))continue;
    const current=next.steps.find(t=>t.kind==='join'&&t.moduleId===s.moduleId&&t.nestedRecipe?.id===s.nestedRecipe?.id);
    if(!current||current.issues.length||direction(s)!==direction(current)||!same(contactCells(old,s),contactCells(next,current)))throw Error('An outside attachment changed');
  }
  const outside=p=>p.steps.filter(s=>!s.newBrickIds.some(id=>selectedOld.has(id))&&!s.highlightBrickIds.some(id=>selectedOld.has(id))&&!changed.has(s.moduleId))
    .map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds,visible:sorted(s.visibleBrickIds),issues:s.issues,direction:direction(s)}));
  if(!same(outside(expected.instructionPlan),outside(candidate.instructionPlan)))throw Error('Unrelated instruction tasks changed');
  if(next.steps.some(s=>changed.has(s.moduleId)&&s.issues.some(i=>i.severity==='error')))throw Error('New grounded recipe is incomplete');
  const handling=assessWorkSurfaceQuality(next).modules.filter(m=>changed.has(m.moduleId));
  if(handling.some(m=>m.finalComponentCount!==1))throw Error('A new recipe cannot be lifted together');
  const views=chooseInstructionSequence(candidate.instructionPlan);
  if(candidate.instructionPlan.steps.some(s=>changed.has(s.moduleId)&&s.kind==='build'&&direction(s)!=='up'&&(!views.get(s.id)?.passes||views.get(s.id)?.truncated)))throw Error('New component additions are obscured');
  const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,ids:sorted(s.instances.flatMap(i=>i.brickIds))}));
  const nextRepeats=repeats(candidate);
  if(repeats(before).some(prior=>!nextRepeats.some(next=>same(prior,next))))throw Error('An existing repeated recipe changed');
  if(count(candidate)>count(before))throw Error('Component completion fragments the guide');
  const histogram={};for(const b of next.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[k]=(histogram[k]??0)+1;}
  return {...candidate,diagnostics:inspectConstruction(brickModel),metrics:{...candidate.metrics,brickCount:next.bricks.length,partHistogram:histogram},
    assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(next)},groundedComponentPlanning:{selected:true,
      cores:cores.map(ids=>ids.length),receiverParts:proposal.receiver.length,capturedParts:proposal.captured.length,patches,
      beforeDiagrams:count(before),afterDiagrams:count(candidate),handling:handling.map(({stepStates,...record})=>record)}};
}

export function completeGroundedComponents(before) {
  if(!before.assemblyPlan||!before.instructionPlan||before.assemblyError||before.groundedComponentPlanning?.selected)return before;
  const proposals=discoverGroundedComponentRecipes(before.assemblyPlan),attempts=[],cache=new Map();
  const discover=parts=>{
    const signature=JSON.stringify(parts.map(({id,...b})=>b));
    if(!cache.has(signature))try{cache.set(signature,{value:discoverLayeredComponentRecipe(parts)});}catch(error){cache.set(signature,{error});}
    const stored=cache.get(signature);if(stored.error)throw stored.error;return stored.value;
  };
  let best=before;
  for(const proposal of proposals)try{
    const candidate=reconstruct(before,proposal,discover);
    attempts.push({cores:proposal.cores.map(c=>c.length),afterDiagrams:count(candidate),reasons:[]});
    if(best===before||count(candidate)<count(best))best=candidate;
  }catch(error){attempts.push({cores:proposal.cores.map(c=>c.length),reasons:[error.message]});}
  return attempts.length?{...best,groundedComponentPlanning:{...(best===before?{selected:false}:best.groundedComponentPlanning),attempts}}:before;
}
