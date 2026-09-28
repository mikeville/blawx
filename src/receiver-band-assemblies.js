import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {unresolvedCells} from './refine-construction.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {retainUnchangedDiagrams} from './preserve-instruction-diagrams.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';

function components(ids,adjacency){
  const pending=new Set(ids),groups=[];
  while(pending.size){
    const group=new Set([pending.values().next().value]);
    for(const id of group){pending.delete(id);for(const next of adjacency.get(id))if(pending.has(next))group.add(next);}
    groups.push([...group]);
  }
  return groups;
}

/** Cut a complete receiving band from the work above it, not an entire suffix. */
export function discoverReceiverBands(plan){
  const by=new Map(plan.bricks.map(b=>[b.id,b])),adj=new Map(plan.bricks.map(b=>[b.id,new Set()]));
  for(const {a,b}of plan.graph.edges){adj.get(a).add(b);adj.get(b).add(a);}
  const roots=new Set(plan.steps.flatMap(s=>s.issues.filter(i=>i.code==='unsupported-addition').map(i=>i.brickIds[0]))),proposals=[];
  for(const module of plan.modules.filter(m=>m.kind==='grounded'&&!m.buildContext)){
    const floors=[...new Set(module.brickIds.filter(id=>roots.has(id)).map(id=>by.get(id).y))].filter(y=>y>0).sort((a,b)=>a-b);
    for(const floor of floors)for(const courses of [2,3,4]){
      const band=module.brickIds.filter(id=>by.get(id).y>=floor&&by.get(id).y<floor+courses);
      for(const ids of components(band,adj)){
        const rootCount=ids.filter(id=>roots.has(id)&&by.get(id).y===floor).length;
        if(!rootCount||ids.length<8||ids.length>160)continue;
        const selected=new Set(ids),bricks=ids.map(id=>by.get(id));
        // Every independent first placement is on the table. A region with
        // another unsupported course needs its own recipe, not a floor waiver.
        if(bricks.some(b=>b.y>floor&&![...adj.get(b.id)].some(n=>selected.has(n)&&by.get(n).y===b.y-1)))continue;
        if(['x','z'].some(axis=>Math.max(...bricks.map(b=>b[axis]+b[axis==='x'?'w':'d']))-Math.min(...bricks.map(b=>b[axis]))>32))continue;
        const prefix=module.brickIds.filter(id=>by.get(id).y<floor),prior=new Set(prefix);
        if(!prefix.length||!ids.some(id=>[...adj.get(id)].some(n=>prior.has(n))))continue;
        const rest=module.brickIds.filter(id=>!selected.has(id)&&!prior.has(id));
        if(!rest.length)continue;
        proposals.push({moduleId:module.id,floor,courses,ids,prefix,rest,rootCount});
      }
    }
  }
  return proposals.sort((a,b)=>b.rootCount-a.rootCount||a.floor-b.floor||a.ids.length-b.ids.length||a.moduleId.localeCompare(b.moduleId));
}

/** Replay a bounded local assembly and its continuation in the existing scene. */
export function planReceiverBands(before,{prepareCandidate=null,preservePlacements=true,allowUnderAttachments=true}={}){
  const original=before.assemblyPlan;
  if(!original?.stats.rootFailureCount||before.assemblyError||original.bricks.length>1000)return before;
  const replay=recipeReplay(original,{preservePlacements}),oldBad=unresolvedCells(original),attempts=[],candidates=[];
  for(const [ordinal,proposal]of discoverReceiverBands(original).slice(0,8).entries()){
    const {moduleId,floor,courses,ids,prefix,rest}=proposal,prior=replay.find(m=>m.id===moduleId),id=`${moduleId}-receiver-${floor}-${ordinal+1}`;
    const next=replay.flatMap(m=>m.id!==moduleId?[m]:[
      restrictRecipe(prior,prefix),
      {id,label:'Separate section',kind:'detail',groupType:'work-surface',brickIds:ids,brickOrder:ids,
        buildContext:{kind:'work-surface',floorY:floor,orderPolicy:'course-first'}},
      {...restrictRecipe(prior,rest),id:`${id}-continue`,kind:'grounded',groupType:'continuation',actionOrder:false,placementGroups:undefined},
    ]);
    try{
      const plan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:next,moduleRecipes:original.moduleRecipes,
        integratedBuild:original.integratedBuild??false,allowUnderAttachments,allowWorkSurfaceUnderAttachments:allowUnderAttachments,
        preferLocalProgress:true,preferLocalFoundations:true});
      const bad=unresolvedCells(plan),steps=plan.steps.filter(s=>s.moduleId===id),reasons=[];
      if(bad.size>=oldBad.size||[...bad].some(c=>!oldBad.has(c)))reasons.push('Must remove failures without newly unresolved cells');
      if(!steps.some(s=>s.kind==='join')||steps.some(s=>s.issues.length))reasons.push('Receiving band or attachment is incomplete');
      const attempt={moduleId,floor,courses,parts:ids.length,unresolved:plan.stats.unresolvedBrickCount,rejectionReasons:reasons};attempts.push(attempt);
      if(!reasons.length)candidates.push({plan,replay:next,id,attempt});
    }catch(error){attempts.push({moduleId,floor,courses,parts:ids.length,rejectionReasons:[error.message]});}
  }
  // Resolve physical feasibility before the more expensive whole-guide task
  // evaluation. Preparation still decides which complete alternative is usable.
  candidates.sort((a,b)=>unresolvedCells(a.plan).size-unresolvedCells(b.plan).size||a.attempt.parts-b.attempt.parts);
  const accepted=[];
  for(const candidate of candidates.slice(0,4))try{
    let result=retainUnchangedDiagrams(before,prepareAssemblyGuide({...before,assemblyPlan:candidate.plan},{moduleReplay:candidate.replay}));
    if(prepareCandidate)result=prepareCandidate(before,result);
    accepted.push({result,id:candidate.id,diagrams:createBookletPresentation(result).numbering.diagramCount});
  }catch(error){candidate.attempt.rejectionReasons.push(error.message);}
  accepted.sort((a,b)=>unresolvedCells(a.result.assemblyPlan).size-unresolvedCells(b.result.assemblyPlan).size||a.diagrams-b.diagrams);
  const winner=accepted[0];
  return {...(winner?.result??before),receiverBandPlanning:{selected:!!winner,moduleId:winner?.id,attempts}};
}
