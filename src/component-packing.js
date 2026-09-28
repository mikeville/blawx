import {proposeConnectedPacking} from './connected-packing.js';
import {packingProfile,packingRejectionReasons,assemblyRejectionReasons,unresolvedCells} from './refine-construction.js';
import {createAssemblyPlan} from './assembly.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {assessAssemblyQuality,orderQualityRejections} from './assembly-quality.js';
import {inspectConstruction} from './construction.js';

const key=(x,y,z)=>`${x},${y},${z}`;
const signature=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cells=b=>Array.from({length:b.w*b.d},(_,i)=>key(b.x+i%b.w,b.y,b.z+Math.floor(i/b.w)));

function largestComponent(bricks){
  const profile=packingProfile(bricks),groups=new Map();
  for(const b of bricks){const id=profile.cells.get(key(b.x,b.y,b.z)).component;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(b);}
  return [...groups.values()].sort((a,b)=>b.length-a.length)[0]??[];
}

/** Plan an intended two-course platform before choosing its brick seams. */
export function planComponentPacking(before){
  const plan=before.assemblyPlan;
  if(!plan||before.assemblyError||plan.bricks.length>800||!plan.stats.rootFailureCount)return before;
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),roots=new Set(plan.steps.flatMap(s=>s.issues.filter(i=>i.code==='unsupported-addition').flatMap(i=>i.brickIds)));
  const floors=new Map();for(const id of roots){const y=byId.get(id)?.y;if(y>0)floors.set(y,(floors.get(y)??0)+1);}
  const candidates=[...floors].sort((a,b)=>b[1]-a[1]||a[0]-b[0]).slice(0,6);
  const started=performance.now(),attempts=[],oldUnresolved=unresolvedCells(plan),originalProfile=packingProfile(before.brickModel.bricks);
  let best=null;
  for(const [floor]of candidates){
    let model=before.brickModel,region=model.bricks.filter(b=>b.y>=floor&&b.y<floor+2);
    if(region.length<8||region.length>160)continue;
    const patches=[];
    for(let round=0;round<6;round++){
      const proposal=proposeConnectedPacking(model,{region,maxChecks:128,maxCandidates:1}).proposals[0];
      if(!proposal)break;
      patches.push({before:proposal.before,after:proposal.after,connectedCellCount:proposal.connectedCellCount});
      model={...model,bricks:proposal.bricks};region=model.bricks.filter(b=>b.y>=floor&&b.y<floor+2);
    }
    if(!patches.length)continue;
    const component=largestComponent(region);
    const width=Math.max(...component.map(b=>b.x+b.w))-Math.min(...component.map(b=>b.x));
    const depth=Math.max(...component.map(b=>b.z+b.d))-Math.min(...component.map(b=>b.z));
    if(component.length<8||component.length>120||width>32||depth>32)continue;
    const keys=new Set(component.map(signature));let candidate,reasons=[];
    try{
      const identified=createAssemblyPlan({brickModel:model,integratedBuild:true});
      const selected=identified.bricks.filter(b=>keys.has(signature(b))).map(b=>b.id);
      const assemblyPlan=createAssemblyPlan({brickModel:model,integratedBuild:true,workSurfaceBrickIds:selected,workSurfaceOrder:'connected-patches'});
      candidate=prepareAssemblyGuide({...before,brickModel:model,assemblyPlan});
      reasons.push(...packingRejectionReasons(originalProfile,packingProfile(model.bricks)),
        ...assemblyRejectionReasons(plan,candidate.assemblyPlan),
        ...orderQualityRejections(assessAssemblyQuality(plan),assessAssemblyQuality(candidate.assemblyPlan)));
      const selectedModule=candidate.assemblyPlan.modules.find(m=>m.buildContext),recipe=candidate.assemblyPlan.steps.filter(s=>s.moduleId===selectedModule?.id);
      if(!selectedModule||selectedModule.brickIds.length!==selected.length||selected.some(id=>!selectedModule.brickIds.includes(id))
        ||recipe.some(s=>s.issues.some(i=>i.severity==='error'))||!recipe.some(s=>s.kind==='join'))reasons.push('Component does not have a complete valid recipe and attachment');
      // A previously failing region can acquire a more specific blocked-join
      // diagnosis. Keep it unresolved; never reject a valid new platform merely
      // because that same old failure is now classified differently.
      const blocked=candidate.assemblyPlan.steps.filter(s=>s.issues.some(i=>i.code==='blocked-module-insertion'));
      if(blocked.length&&blocked.every(s=>s.highlightBrickIds.flatMap(id=>cells(candidate.assemblyPlan.bricks.find(b=>b.id===id))).every(c=>oldUnresolved.has(c))))
        reasons=reasons.filter(reason=>reason!=='blockedJoinCount increased');
      if(unresolvedCells(candidate.assemblyPlan).size>=oldUnresolved.size)reasons.push('Unresolved volume did not decrease');
      if(candidate.assemblyPlan.stats.upwardInsertionBrickCount>plan.stats.upwardInsertionBrickCount)reasons.push('Upward insertions increased');
      if(!candidate.instructionPlan.stats.coverageComplete||!candidate.guide.stats.coverageComplete||!candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete)reasons.push('Incomplete coverage');
    }catch(error){reasons.push(error.message);}
    attempts.push({floor,patchCount:patches.length,componentParts:component.length,rejectionReasons:reasons,unresolved:candidate?.assemblyPlan.stats.unresolvedBrickCount});
    if(!reasons.length&&(!best||unresolvedCells(candidate.assemblyPlan).size<unresolvedCells(best.candidate.assemblyPlan).size))best={candidate,floor,patches};
  }
  const report={selected:Boolean(best),attempts,floor:best?.floor,patches:best?.patches??[],planningMs:performance.now()-started,
    beforeUnresolved:plan.stats.unresolvedBrickCount,afterUnresolved:best?.candidate.assemblyPlan.stats.unresolvedBrickCount??plan.stats.unresolvedBrickCount};
  if(!best)return {...before,componentPacking:report};
  const current=best.candidate,histogram={};for(const b of current.brickModel.bricks){const type=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[type]=(histogram[type]??0)+1;}
  return {...current,componentPacking:report,diagnostics:inspectConstruction(current.brickModel),metrics:{...current.metrics,
    brickCount:current.brickModel.bricks.length,partHistogram:histogram,conversionMs:before.metrics.conversionMs+report.planningMs}};
}
