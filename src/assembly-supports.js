import {facesTouch, spatialRegions, placementFootprint} from './placement-groups.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';

// Finish compact support footprints before the elevated assembly is joined.
export function completeBaseRegions(replay, plan, {splitComplete = false} = {}) {
  const bandIndex = replay.findIndex(m => m.buildContext?.kind === 'work-surface');
  if (bandIndex < 1) return {replay, moved:0};
  const base = replay[bandIndex-1];
  if (base.kind !== 'grounded' || base.groupType) return {replay, moved:0};
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const regions = spatialRegions(base.brickIds.map(id => byId.get(id)));
  if (regions.length < 2 || regions.length > 8) return {replay, moved:0};
  const reserved = new Set(replay.slice(0,bandIndex-1).flatMap(m => m.brickIds));
  const taken = new Set();
  const completed = regions.map((region,index) => {
    const bounds = placementFootprint(region), colors = new Set(region.map(b => b.color));
    const possible = plan.bricks.filter(b => !reserved.has(b.id) && colors.has(b.color)
      && b.x >= bounds.minX && b.x+b.w <= bounds.maxX && b.z >= bounds.minZ && b.z+b.d <= bounds.maxZ);
    const whole = new Set(region);
    for (const brick of whole) for (const candidate of possible) {
      if (!whole.has(candidate) && facesTouch(brick,candidate)) whole.add(candidate);
    }
    for (const b of whole) taken.add(b.id);
    const brickIds = [...whole].map(b => b.id);
    return {id:`${base.id}-unit-${index+1}`,label:`Base assembly ${index+1}`,kind:'grounded',brickIds,brickOrder:brickIds};
  });
  const moved = taken.size-base.brickIds.length;
  if (moved <= 0 && !splitComplete) return {replay, moved:0};
  const rest = replay.slice(bandIndex).map(m => ({...m,brickIds:m.brickIds.filter(id => !taken.has(id)),
    brickOrder:m.brickOrder.filter(id => !taken.has(id))}));
  if (rest.some(m => !m.brickIds.length)) return {replay,moved:0};
  return {replay:[...replay.slice(0,bandIndex-1),...completed,...rest],moved};
}

// A successful platform attachment already identifies its receiving support
// groups. Give equivalent groups complete recipes without replaying unrelated
// construction or changing an unresolved leftover's diagnosis.
export function refineRepeatedSupports(result){
  const plan=result.assemblyPlan,diagrams=result.instructionPlan;
  if(!plan||!diagrams||result.assemblyError||result.repeatedSupportRefinement?.selected)return result;
  const join=plan.steps.find(s=>s.kind==='join'&&!s.issues.length&&s.joinContext?.direction==='down');
  const groups=join?.joinContext.supportGroups;
  if(!groups||groups.length<2||groups.length>8)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const owner=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const target=owner.get(groups[0].brickIds[0]);
  if(!target||target.kind!=='grounded'||target.groupType||target.buildContext)return result;
  const selected=new Set(groups.flatMap(g=>g.brickIds));
  if(selected.size!==groups.reduce((n,g)=>n+g.brickIds.length,0)
    ||[...selected].some(id=>owner.get(id)!==target))return result;
  const shape=ids=>{
    const bs=ids.map(id=>byId.get(id)),x=Math.min(...bs.map(b=>b.x)),z=Math.min(...bs.map(b=>b.z));
    return bs.map(b=>`${b.x-x},${b.y},${b.z-z}:${b.w},${b.d}:${b.color}`).sort().join('|');
  };
  if(groups.some(g=>g.brickIds.length>80||!g.brickIds.some(id=>byId.get(id).y===0)
    ||shape(g.brickIds)!==shape(groups[0].brickIds)))return result;
  const oldSources=plan.steps.filter(s=>s.moduleId===target.id),oldDiagrams=diagrams.steps.filter(s=>s.moduleId===target.id);
  const selectedStep=s=>s.newBrickIds.length&&s.newBrickIds.every(id=>selected.has(id));
  const residualStep=s=>s.newBrickIds.length&&s.newBrickIds.every(id=>!selected.has(id));
  if([...oldSources,...oldDiagrams].some(s=>selectedStep(s)?s.issues.length>0||s.kind!=='build':!residualStep(s)||!s.issues.length))return result;
  const sourceStart=plan.steps.indexOf(oldSources[0]),diagramStart=diagrams.steps.indexOf(oldDiagrams[0]);
  if(sourceStart!==0||diagramStart!==0||plan.steps.slice(0,oldSources.length).some((s,i)=>s!==oldSources[i])
    ||diagrams.steps.slice(0,oldDiagrams.length).some((s,i)=>s!==oldDiagrams[i]))return result;
  try{
    const brickModel={version:1,kind:'bricks',bricks:[...selected].map(id=>{const {id:_,...b}=byId.get(id);return b;})};
    const replay=groups.map((g,i)=>({id:`${target.id}-support-${i+1}`,label:`Base assembly ${i+1}`,kind:'grounded',
      brickIds:g.brickIds,brickOrder:[...g.brickIds].sort((a,b)=>byId.get(a).y-byId.get(b).y||byId.get(a).z-byId.get(b).z||byId.get(a).x-byId.get(b).x)}));
    const local=createAssemblyPlan({brickModel,moduleReplay:replay});
    if(local.steps.some(s=>s.kind!=='build'||s.issues.length))return result;
    const sources=local.steps.map(s=>({...s,id:`support-recipe-${s.id}`}));
    const localModules=local.modules.map(m=>({...m,recipeFamily:`${target.id}-supports`}));
    const localPlan={...local,modules:localModules,steps:sources};
    const compacted=compactAssemblyPlan(localPlan);
    const localGuide=createGuideSections(compacted.plan);
    const presentation=deriveGuidePresentation({plan:compacted.plan,guide:localGuide});
    if(!presentation.sections.some(s=>s.repeatCount===groups.length))return result;
    const residue=target.brickIds.filter(id=>!selected.has(id)),residueId=`${target.id}-unresolved`;
    const modules=[...localModules.map(m=>({...m,componentIds:target.componentIds})),
      ...(residue.length?[{id:residueId,label:'Unresolved support details',kind:'floating',groupType:'detached-parts',
        status:'unresolved',brickIds:residue,componentIds:target.componentIds}]:[])];
    const remap=s=>({...s,moduleId:residueId});
    const replace=(original,prefix,old)=>{
      const steps=[...prefix,...old.filter(residualStep).map(remap),...original.steps.slice(old.length)];
      return {...original,modules:[...modules,...original.modules.filter(m=>m.id!==target.id)],steps,
        stats:{...original.stats,moduleCount:original.modules.length-1+modules.length,stepCount:steps.length,
          maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
          planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
    };
    const assemblyPlan=replace(plan,sources,oldSources),instructionPlan=replace(diagrams,compacted.plan.steps.map(s=>({...s,id:`support-${s.id}`})),oldDiagrams);
    if(JSON.stringify(instructionPlan.steps.flatMap(s=>s.sourceStepIds))!==JSON.stringify(assemblyPlan.steps.map(s=>s.id)))return result;
    const coverage=assemblyPlan.steps.flatMap(s=>s.newBrickIds);
    if(coverage.length!==plan.bricks.length||new Set(coverage).size!==plan.bricks.length)return result;
    const guide=createGuideSections(instructionPlan),full=deriveGuidePresentation({plan:instructionPlan,guide});
    const displayed=p=>p.sections.reduce((n,s)=>n+s.stepIds.length,0);
    if(displayed(full)>displayed(deriveGuidePresentation({plan:diagrams,guide:result.guide})))return result;
    return {...result,assemblyPlan,instructionPlan,guide,
      assemblyEvaluation:{...result.assemblyEvaluation,compaction:{...result.assemblyEvaluation?.compaction,
        sourceStepCount:assemblyPlan.steps.length,instructionDiagramCount:instructionPlan.steps.length,
        collapsedStepCount:assemblyPlan.steps.length-instructionPlan.steps.length,
        mergedDiagramCount:instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length}},
      repeatedSupportRefinement:{selected:true,repeatCount:groups.length,piecesPerSupport:groups[0].brickIds.length,
        preservedJoinId:join.id,preservedUnresolvedIds:residue}};
  }catch{return result;}
}
