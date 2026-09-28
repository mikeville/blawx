import {createAssemblyPlan} from './assembly.js';
import {annotateActions} from './assembly-actions.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {chooseInstructionSequence} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';
import {planTableLayers} from './table-layer-recipes.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const sameSet=(a,b)=>a.length===b.length&&new Set(a).size===a.length&&a.every(id=>b.includes(id));

function components(bricks){
  const owner=new Map();let count=0;
  for(const seed of bricks){
    if(owner.has(seed.id))continue;
    const group=new Set([seed]);
    for(const a of group)for(const b of bricks)if(Math.abs(a.y-b.y)===1&&overlap(a,b))group.add(b);
    for(const b of group)owner.set(b.id,count);
    count++;
  }
  return {owner,count};
}

// The displayed action completes a whole course. Within that action, retain
// an executable order that ties the most existing components together first.
function courseOrder(layer,placed){
  const pending=[...layer],ordered=[];
  while(pending.length){
    const {owner}=components(placed);
    const bonds=b=>new Set(placed.filter(p=>p.y===b.y-1&&overlap(p,b)).map(p=>owner.get(p.id))).size;
    pending.sort((a,b)=>bonds(b)-bonds(a)||a.z-b.z||a.x-b.x);
    const next=pending.shift();placed.push(next);ordered.push(next.id);
  }
  return ordered;
}

function layerActions(bricks){
  const courses=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b);
  if(courses.length<2||courses.length>6||bricks.length>120)return null;
  const placed=[],actions=[];
  for(const y of courses){
    const layer=bricks.filter(b=>b.y===y);
    const width=Math.max(...layer.map(b=>b.x+b.w))-Math.min(...layer.map(b=>b.x));
    const depth=Math.max(...layer.map(b=>b.z+b.d))-Math.min(...layer.map(b=>b.z));
    const types=new Set(layer.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`));
    if(layer.length>24||width>12||depth>12||types.size>10||new Set(layer.map(b=>b.color)).size>3)return null;
    actions.push({kind:'table-course',brickIds:courseOrder(layer,placed)});
  }
  return components(placed).count===1?actions:null;
}

function references(plan,steps){
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}
function views(plan){
  const sequence=chooseInstructionSequence(plan);
  return {turns:[...sequence.values()].filter(v=>v.turned).length,
    unreadable:new Set([...sequence].filter(([,v])=>!v.passes||v.truncated||v.groups.some(g=>!g.visibleBrickCount)).map(([id])=>id))};
}

function replaceRecipe(result,module,actions,tableLayout=null){
  const original=result.assemblyPlan,plan=result.instructionPlan;
  const builds=original.steps.filter(s=>s.moduleId===module.id&&s.newBrickIds.length);
  const diagrams=plan.steps.filter(s=>s.moduleId===module.id&&s.newBrickIds.length);
  if(!builds.length||actions.length>=diagrams.length)return null;
  const join=original.steps.filter(s=>s.moduleId===module.id&&!s.newBrickIds.length);
  const clean=s=>s.kind==='build'&&!s.issues.length&&!s.instructionAction&&!s.buildRegion&&!s.tableRecipe
    &&(s.insertionDirection??'down')==='down'&&sameSet(s.newBrickIds,s.highlightBrickIds);
  if(builds.some(s=>!clean(s))||diagrams.some(s=>!clean(s))||join.length!==1
    ||join[0].kind!=='join'||join[0].issues.length||join[0].joinContext?.direction!=='down')return null;
  if(!sameSet(builds.flatMap(s=>s.newBrickIds),module.brickIds)
    ||!sameSet(diagrams.flatMap(s=>s.newBrickIds),module.brickIds))return null;
  const sourceStart=original.steps.indexOf(builds[0]),diagramStart=plan.steps.indexOf(diagrams[0]);
  if(original.steps.slice(sourceStart,sourceStart+builds.length).some((s,i)=>s!==builds[i])
    ||plan.steps.slice(diagramStart,diagramStart+diagrams.length).some((s,i)=>s!==diagrams[i]))return null;
  const bricks=original.bricks.filter(b=>module.brickIds.includes(b.id));
  const replay={...module,actions,actionOrder:true,brickOrder:actions.flatMap(a=>a.brickIds),placementGroups:actions.map(a=>a.brickIds),
    buildContext:{...module.buildContext,orderPolicy:'planned-actions'}};
  // Validate the recipe on its own table. Its standalone join has no external
  // support by construction; retain the already verified real join verbatim.
  const isolated=annotateActions(createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>b)},moduleReplay:[replay]}),[replay]);
  const localBuilds=isolated.steps.filter(s=>s.newBrickIds.length);
  if(localBuilds.some(s=>s.kind!=='build'||s.issues.length))return null;
  const canonical=localBuilds.map((s,i)=>({...s,id:`${module.id}-local-recipe-${i+1}`}));
  const replacement=actions.map((action,i)=>{
    const steps=canonical.filter(s=>s.instructionAction?.id===`${module.id}-action-${i+1}`);
    const last=steps.at(-1);
    if(!last||!sameSet(steps.flatMap(s=>s.newBrickIds),action.brickIds))throw Error('Incomplete local recipe action');
    return {...last,id:`${module.id}-table-course-${i+1}`,newBrickIds:[...action.brickIds],highlightBrickIds:[...action.brickIds],
      label:`${module.label} · add ${action.brickIds.length} bricks`,sourceStepIds:steps.map(s=>s.id),
      orderedOperations:steps.map(s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,
        issues:s.issues,insertionDirection:s.insertionDirection??'down'})),
      tableRecipe:{ordinal:i+1,total:actions.length,completionStepId:`${module.id}-table-course-${actions.length}`,
        ...(tableLayout?{layerTask:true}:{})}};
  });
  if(!sameSet(canonical.at(-1).visibleBrickIds,builds.at(-1).visibleBrickIds))return null;
  const assemblyPlan=references(original,[...original.steps.slice(0,sourceStart),...canonical,...original.steps.slice(sourceStart+builds.length)]);
  const instructionPlan=references(plan,[...plan.steps.slice(0,diagramStart),...replacement,...plan.steps.slice(diagramStart+diagrams.length)]);
  if(!sameSet(instructionPlan.steps.flatMap(s=>s.newBrickIds),original.bricks.map(b=>b.id))
    ||JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id)))return null;
  const before=assessWorkSurfaceQuality(original).aggregate,after=assessWorkSurfaceQuality(assemblyPlan).aggregate;
  if(tableLayout){
    // Loose base pieces are intentional in a verified table layout. They must
    // become a single assembly before lifting; retain the measured tradeoff.
    const completed=assessWorkSurfaceQuality(assemblyPlan).modules.find(m=>m.moduleId===module.id);
    if(completed.finalComponentCount!==1)return null;
    if(tableLayout.mixedMaterials){
      // Material-rich courses already require more visual matching. Broader
      // material variety cannot also demand a larger or later-bonding loose
      // layout. Measure this recipe, not an aggregate dominated by another one.
      const previous=assessWorkSurfaceQuality(original).modules.find(m=>m.moduleId===module.id);
      if(['peakLooseBrickCount','peakComponentCount'].some(key=>completed[key]>previous[key])
        ||previous.firstBondAtAddition!==null&&(completed.firstBondAtAddition===null||completed.firstBondAtAddition>previous.firstBondAtAddition))return null;
    }
  }else{
    for(const key of ['peakLooseBrickCount','peakComponentCount','peakDetachedBrickCount','detachedBrickExposure','finalComponentCount'])if(after[key]>before[key])return null;
    if(before.firstBondAtAddition!==null&&(after.firstBondAtAddition===null||after.firstBondAtAddition>before.firstBondAtAddition))return null;
  }
  const oldViews=views(plan),newViews=views(instructionPlan);
  if(newViews.turns>oldViews.turns||replacement.some(s=>newViews.unreadable.has(s.id))
    ||[...newViews.unreadable].some(id=>!oldViews.unreadable.has(id)))return null;
  const compaction={...result.assemblyEvaluation?.compaction,sourceStepCount:assemblyPlan.steps.length,
    instructionDiagramCount:instructionPlan.steps.length,collapsedStepCount:assemblyPlan.steps.length-instructionPlan.steps.length,
    mergedDiagramCount:instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length,brickCoverageComplete:true,sourceStepCoverageComplete:true};
  return {...result,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),
    assemblyEvaluation:{...result.assemblyEvaluation,compaction},
    offlineRecipeRefinement:{selected:true,moduleId:module.id,beforeDiagrams:diagrams.length,afterDiagrams:replacement.length,
      oldSourceStepIds:builds.map(s=>s.id),newSourceStepIds:canonical.map(s=>s.id),handlingBefore:before,handlingAfter:after,
      ...(tableLayout?{tableLayout:{axis:tableLayout.axis,floorPieceCount:tableLayout.floorPieceCount,
        ...(tableLayout.mixedMaterials?{mixedMaterials:true}:{})}}:{})}};
}

/** Improve one unannotated offline recipe without replaying unrelated work. */
export function refineOfflineRecipes(result){
  if(!result.assemblyPlan||!result.instructionPlan||result.assemblyError||result.brickModel.bricks.length>1000)return result;
  for(const module of result.assemblyPlan.modules.filter(m=>m.buildContext?.kind==='work-surface').slice(0,4)){
    if(result.instructionPlan.steps.some(s=>s.moduleId===module.id&&(s.instructionAction||s.tableRecipe)))continue;
    const bricks=result.assemblyPlan.bricks.filter(b=>module.brickIds.includes(b.id));
    const simple=layerActions(bricks);
    const direct=simple&&replaceRecipe(result,module,simple);
    if(direct)return direct;
    // A connected-patch recipe may bond sooner than complete courses. If the
    // latter fails that handling comparison, still consider a validated flat
    // table layout. A rejected first strategy must not suppress its alternative.
    const tableLayout=planTableLayers(bricks)??planTableLayers(bricks,{allowMixedMaterials:true});
    if(!tableLayout)continue;
    const whole=simple&&replaceRecipe(result,module,simple,tableLayout);
    if(whole)return whole;
    const candidate=replaceRecipe(result,module,tableLayout.actions,tableLayout);
    if(candidate)return candidate;
  }
  return result;
}
