import {createAssemblyPlan} from './assembly.js';
import {recipeBrickId} from './assembly-recipes.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {restoreUnchangedRecipeMetadata} from './complete-assembly-recipes.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';
import {unresolvedCells} from './refine-construction.js';
import {contactCells} from './local-interface-repair.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {assessAssemblyQuality} from './assembly-quality.js';
import {discoverLayeredComponentRecipe} from './component-recipe-discovery.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),sort=items=>[...items].sort();
const direction=s=>s.joinContext?.direction??s.insertionDirection??'down';
const inRecipe=(step,id)=>step.nestedRecipe?.id===id||step.nestedRecipe?.id.startsWith(id+'/');
const count=r=>createBookletPresentation(r).numbering.diagramCount;
const protectedModule=m=>['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly'].some(k=>m[k]);

/** Failed connected pieces whose only external contacts lead into one raised core. */
export function discoverRecipeDependents(plan,{maxCandidates=4}={}) {
  if(!plan?.stats.unresolvedBrickCount||plan.bricks.length>1000)return [];
  const by=new Map(plan.bricks.map(b=>[b.id,b])),owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const failed=new Set(plan.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds)
    .filter(id=>owners.get(id).kind==='grounded'&&!owners.get(id).buildContext&&!protectedModule(owners.get(id))));
  const adjacency=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b}of plan.graph.edges){adjacency.get(a).push(b);adjacency.get(b).push(a);}
  const pending=new Set(failed),targets=new Map();
  while(pending.size){
    const ids=new Set([pending.values().next().value]);
    for(const id of ids){pending.delete(id);for(const other of adjacency.get(id))if(pending.has(other))ids.add(other);}
    if(ids.size>64)continue;
    const contacts=[...ids].flatMap(id=>adjacency.get(id).filter(other=>!ids.has(other)).map(other=>({id,other})));
    if(!contacts.length||contacts.some(({id,other})=>failed.has(other)||by.get(other).y<=by.get(id).y))continue;
    const receiving=[...new Set(contacts.map(({other})=>owners.get(other)))];
    if(receiving.length!==1)continue;
    const parent=receiving[0],recipe=plan.moduleRecipes?.[parent.id];
    if(parent.buildContext?.kind!=='work-surface'||protectedModule(parent)
      ||recipe?.moduleReplay[0]?.groupType==='table-root'
      ||plan.steps.some(s=>s.moduleId===parent.id&&(s.issues.some(i=>i.severity==='error')||s.kind==='build'&&direction(s)==='up'))
      ||Math.min(...[...ids].map(id=>by.get(id).y))>=parent.buildContext.floorY)continue;
    if(!targets.has(parent.id))targets.set(parent.id,[]);targets.get(parent.id).push([...ids]);
  }
  return [...targets].flatMap(([parentId,groups])=>{
    const parent=plan.modules.find(m=>m.id===parentId),ids=groups.flat();
    return ids.length+parent.brickIds.length<=256?[{parentId,groups,brickIds:ids}]:[];
  }).slice(0,maxCandidates);
}

function receivingRecipe(plan,parent,recipes,instructions) {
  if(recipes[parent.id])return recipes[parent.id];
  const by=new Map(plan.bricks.map(b=>[b.id,b])),floor=parent.buildContext.floorY;
  const local=id=>recipeBrickId({...by.get(id),y:by.get(id).y-floor});
  const groups=plan.steps.filter(s=>s.moduleId===parent.id&&s.newBrickIds.length).map(s=>s.newBrickIds.map(local));
  return {allowUnderAttachments:false,moduleReplay:[{id:'core',label:'Core',kind:'grounded',brickIds:groups.flat(),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups}],
    diagramGroups:instructions.steps.filter(s=>s.moduleId===parent.id&&s.kind==='build').map(s=>s.newBrickIds.map(local))};
}

function expand(before,proposal) {
  const old=before.assemblyPlan,parent=old.modules.find(m=>m.id===proposal.parentId),by=new Map(old.bricks.map(b=>[b.id,b]));
  const moved=new Set(proposal.brickIds),ids=[...parent.brickIds,...moved],floor=Math.min(...ids.map(id=>by.get(id).y));
  if(floor<=0)throw Error('The enclosing handled assembly must stay above the model foundation');
  const recipes=replayNestedRecipes(old)??{},original=receivingRecipe(old,parent,recipes,before.instructionPlan),delta=parent.buildContext.floorY-floor;
  if(original.moduleReplay[0]?.kind!=='grounded'||original.moduleReplay[0].buildContext)throw Error('The receiver has no reusable initial table layout');
  const mapping=new Map(parent.brickIds.map(id=>{const b=by.get(id);return[recipeBrickId({...b,y:b.y-parent.buildContext.floorY}),recipeBrickId({...b,y:b.y-floor})];}));
  const shift=value=>Array.isArray(value)?value.map(shift):typeof value==='string'?(mapping.get(value)??value):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,shift(v)])):value;
  // Only the outer coordinates move. Existing nested recipes keep their own
  // local coordinates and depth; their real construction is replayed unchanged.
  const childReplay=original.moduleReplay.map(m=>({...shift(m),...(m.buildContext?{buildContext:{...m.buildContext,floorY:m.buildContext.floorY+delta}}:{})}));
  childReplay[0]={...childReplay[0],groupType:'table-root',buildContext:{kind:'work-surface',floorY:delta,orderPolicy:'planned-actions'}};
  const childIds=[],childRecipes={...original.moduleRecipes};
  for(const [index,group]of proposal.groups.entries()){
    let id=`hanging-component-${index+1}`;while(childReplay.some(m=>m.id===id))id+='-next';childIds.push(id);
    const parts=group.map(id=>by.get(id)),local=parts.map(b=>recipeBrickId({...b,y:b.y-floor}));
    const childFloor=Math.min(...parts.map(b=>b.y));
    const simple=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:parts.map(({id,...b})=>({...b,y:b.y-childFloor}))},
      integratedBuild:true,allowUnderAttachments:false});
    if(simple.stats.unresolvedBrickCount)childRecipes[id]=discoverLayeredComponentRecipe(parts).recipe;
    childReplay.push({id,label:'Underside assembly',kind:'detail',groupType:'work-surface',brickIds:local,brickOrder:local,
      buildContext:{kind:'work-surface',floorY:childFloor-floor,joinDirection:'up'}});
  }
  recipes[parent.id]={...original,moduleReplay:childReplay,...(Object.keys(childRecipes).length?{moduleRecipes:childRecipes}:{}),
    ...(original.diagramGroups?{diagramGroups:shift(original.diagramGroups)}:{})};
  const moduleReplay=recipeReplay(old,{preservePlacements:true}).map(m=>{
    if(m.id===parent.id)return {...m,brickIds:ids,brickOrder:ids,actionOrder:false,placementGroups:undefined,buildContext:{...m.buildContext,floorY:floor}};
    const retained=restrictRecipe(m,m.brickIds.filter(id=>!moved.has(id))),steps=old.steps.filter(s=>s.moduleId===m.id);
    // Removing failed pieces does not license replanning their valid neighbors.
    // Warning-bearing placements are also replayed, with warnings recalculated.
    if(!steps.some(s=>s.nestedRecipe)){
      const groups=steps.map(s=>s.newBrickIds.filter(id=>!moved.has(id))).filter(g=>g.length);
      return {...retained,brickOrder:groups.flat(),placementGroups:groups,actionOrder:true};
    }
    return retained;
  }).filter(m=>m.brickIds.length);
  const assemblyPlan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay,moduleRecipes:recipes,integratedBuild:old.integratedBuild??false,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  const promotedScope=assemblyPlan.steps.find(s=>s.moduleId===parent.id&&s.newBrickIds.some(id=>parent.brickIds.includes(id)))?.nestedRecipe;
  const adapt=plan=>({...plan,steps:plan.steps.map(s=>{
    if(!old.moduleRecipes?.[parent.id]&&s.moduleId===parent.id&&s.kind==='build'&&promotedScope)return {...s,nestedRecipe:promotedScope};
    return s.moduleId!==parent.id&&parent.brickIds.every(id=>s.visibleBrickIds.includes(id))
      ?{...s,visibleBrickIds:[...new Set([...s.visibleBrickIds,...moved])]}:s;
  })});
  const expected={...before,assemblyPlan:adapt(old),instructionPlan:adapt(before.instructionPlan)};
  const candidate=retainUnchangedDiagrams(expected,restoreUnchangedRecipeMetadata(expected,prepareAssemblyGuide({...before,assemblyPlan},{moduleReplay})),{omittedContextIds:moved});
  validate(before,candidate,proposal,childIds);
  return {...candidate,assemblyEvaluation:{...candidate.assemblyEvaluation,after:assessAssemblyQuality(candidate.assemblyPlan)},
    dependentRecipeCompletion:{selected:true,parentId:parent.id,joinedParts:moved.size,groups:proposal.groups.map(g=>g.length),
      beforeDiagrams:count(before),afterDiagrams:count(candidate),beforeUnresolved:old.stats.unresolvedBrickCount,afterUnresolved:assemblyPlan.stats.unresolvedBrickCount}};
}

function validate(before,after,proposal,childIds) {
  const old=before.assemblyPlan,next=after.assemblyPlan,moved=new Set(proposal.brickIds),parentId=proposal.parentId;
  if(!same(before.brickModel,after.brickModel))throw Error('Enclosing recipe changed geometry');
  const priorBad=unresolvedCells(old),bad=unresolvedCells(next);
  if(bad.size>=priorBad.size||[...bad].some(c=>!priorBad.has(c)))throw Error('Failed geometry did not strictly improve');
  if(!same(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id))
    ||!same(sort(next.steps.flatMap(s=>s.newBrickIds)),sort(next.bricks.map(b=>b.id))))throw Error('Incomplete coverage');
  for(const join of old.steps.filter(s=>s.kind==='join'&&!s.issues.length)){
    const current=next.steps.find(s=>s.kind==='join'&&s.moduleId===join.moduleId&&s.nestedRecipe?.id===join.nestedRecipe?.id);
    if(!current||current.issues.length||direction(current)!==direction(join)||!same(contactCells(old,join),contactCells(next,current)))throw Error('A prior successful attachment changed');
  }
  const unchanged=plan=>plan.steps.filter(s=>s.moduleId!==parentId&&!s.newBrickIds.some(id=>moved.has(id))).map(s=>({module:s.moduleId,kind:s.kind,new:s.newBrickIds,
    highlight:s.highlightBrickIds,visible:sort(s.visibleBrickIds.filter(id=>!moved.has(id))),issues:s.issues,direction:direction(s)}));
  if(!same(unchanged(before.instructionPlan),unchanged(after.instructionPlan)))throw Error('Unrelated instruction tasks changed');
  // Every established diagram in the receiver remains the same task. The outer
  // final join now also carries the completed hanging components.
  const core=plan=>plan.steps.filter(s=>s.moduleId===parentId&&!childIds.some(id=>inRecipe(s,`${parentId}/${id}`)))
    .map(s=>({kind:s.kind,new:s.newBrickIds,highlight:s.highlightBrickIds.filter(id=>!moved.has(id)),visible:sort(s.visibleBrickIds.filter(id=>!moved.has(id))),issues:s.issues,direction:direction(s)}));
  if(!same(core(before.instructionPlan),core(after.instructionPlan)))throw Error('The established receiver recipe fragmented');
  const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,ids:sort(s.instances.flatMap(i=>i.brickIds))}));
  if(!same(repeats(before),repeats(after)))throw Error('An existing repeated recipe changed');
  const handling=assessWorkSurfaceQuality(next).modules.find(m=>m.moduleId===parentId);
  if(handling?.finalComponentCount!==1)throw Error('The enclosing assembly cannot be lifted together');
  const views=chooseInstructionSequence(after.instructionPlan),by=new Map(next.bricks.map(b=>[b.id,b]));
  for(const [index,id]of childIds.entries()){
    const scope=`${parentId}/${id}`,steps=after.instructionPlan.steps.filter(s=>inRecipe(s,scope)),courses=new Set(proposal.groups[index].map(id=>by.get(id).y));
    if(steps.filter(s=>s.kind==='join'&&s.nestedRecipe?.id===scope).length!==1||steps.some(s=>s.issues.some(i=>i.severity==='error')))throw Error('Incomplete hanging component');
    if(steps.length>courses.size+steps.filter(s=>s.kind==='join').length)throw Error('A hanging recipe fragments its courses');
    if(steps.filter(s=>s.kind==='build').some(s=>direction(s)!=='down'||!views.get(s.id)?.passes||views.get(s.id)?.truncated))throw Error('A hanging component has obscured or loose upward additions');
  }
}

/** Expand a proven receiver before its final attachment, preserving its recipe. */
export function completeRecipeDependents(before) {
  if(!before.instructionPlan||before.assemblyError||before.dependentRecipeCompletion?.selected)return before;
  const attempts=[];let best=before;
  for(const proposal of discoverRecipeDependents(before.assemblyPlan))try{
    const candidate=expand(before,proposal);
    attempts.push({...candidate.dependentRecipeCompletion,reasons:[]});
    if(best===before||candidate.assemblyPlan.stats.unresolvedBrickCount<best.assemblyPlan.stats.unresolvedBrickCount)best=candidate;
  }catch(error){attempts.push({parentId:proposal.parentId,parts:proposal.brickIds.length,reasons:[error.message]});}
  return attempts.length?{...best,dependentRecipeCompletion:{...(best===before?{selected:false}:best.dependentRecipeCompletion),attempts}}:before;
}
