import {planHangingAssemblies} from './hanging-assemblies.js';
import {proposeConnectedPacking} from './connected-packing.js';
import {createAssemblyPlan} from './assembly.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {assemblyRejectionReasons,unresolvedCells} from './refine-construction.js';
import {assessAssemblyQuality,orderQualityRejections} from './assembly-quality.js';
import {inspectConstruction} from './construction.js';

const signature=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cells=b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`);

// Move the component served by a new seam into the assembly that receives it.
// Reassigning only the replacement brick leaves its dependents in a detached
// review group and cannot produce a complete component recipe.
function ownershipReplay(plan,brickModel,proposal){
  const owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const byGeometry=new Map(plan.bricks.map(b=>[signature(b),b]));
  const components=new Map(plan.graph.components.flatMap(c=>c.brickIds.map(id=>[id,c])));
  const touched=proposal.before.map(b=>byGeometry.get(signature(b)));
  const anchors=[...new Set(touched.filter(b=>components.get(b.id).grounded).map(b=>owners.get(b.id)))];
  if(anchors.length!==1)throw Error('A connecting seam must have one assembly owner');
  const anchor=anchors[0];
  const joined=new Set(touched.map(b=>components.get(b.id)).filter(c=>!c.grounded).flatMap(c=>c.brickIds));
  const cellOwners=new Map(plan.bricks.flatMap(b=>cells(b).map(k=>[k,joined.has(b.id)?anchor.id:owners.get(b.id).id])));
  const identified=createAssemblyPlan({brickModel}),assigned=new Map(),nextOwner=new Map();
  for(const b of identified.bricks){
    const target=new Set(cells(b).map(k=>cellOwners.get(k)));
    if(target.size!==1||target.has(undefined))throw Error('Replacement crosses assembly ownership');
    nextOwner.set(b.id,[...target][0]);
  }
  // Once a table-built component is connected, include unresolved pieces that
  // already bond into that same band. Leaving them in a detached review bucket
  // would manufacture a second, impossible attachment for part of the recipe.
  if(anchor.buildContext){
    const byId=new Map(identified.bricks.map(b=>[b.id,b]));
    const members=new Set(identified.bricks.filter(b=>nextOwner.get(b.id)===anchor.id).map(b=>b.id));
    const top=Math.max(...[...members].map(id=>byId.get(id).y));
    const floating=new Set(plan.modules.filter(m=>m.kind==='floating').map(m=>m.id));
    let grew=true;
    while(grew){grew=false;for(const {a,b}of identified.graph.edges){
      const outside=members.has(a)&&!members.has(b)?b:members.has(b)&&!members.has(a)?a:null;
      if(outside&&floating.has(nextOwner.get(outside))&&byId.get(outside).y>=anchor.buildContext.floorY&&byId.get(outside).y<=top){
        members.add(outside);nextOwner.set(outside,anchor.id);joined.add(outside);grew=true;
      }
    }}
  }
  for(const b of identified.bricks){const id=nextOwner.get(b.id);if(!assigned.has(id))assigned.set(id,[]);assigned.get(id).push(b);}
  const replay=plan.modules.filter(m=>assigned.has(m.id)).map(m=>{
    const bricks=assigned.get(m.id),ids=new Set(bricks.map(b=>b.id));
    const changed=m.brickIds.length!==ids.size||m.brickIds.some(id=>!ids.has(id));
    const originalOrder=plan.steps.filter(s=>s.moduleId===m.id).flatMap(s=>s.newBrickIds);
    return {id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,brickIds:[...ids],
      brickOrder:changed?bricks.map(b=>b.id):originalOrder,
      ...(m.buildContext?{buildContext:{...m.buildContext,orderPolicy:changed?'connected-patches':m.buildContext.orderPolicy==='planned-actions'?'course-first':m.buildContext.orderPolicy}}:{})};
  });
  return {replay,anchorId:anchor.id,joinedBrickIds:[...joined]};
}

/** Choose exact connections and their assembly ownership before sequencing. */
export function planConnectedAssemblies(before){
  if(!before.assemblyPlan||before.assemblyError||!before.assemblyPlan.stats.unresolvedBrickCount
    ||before.brickModel.bricks.length>800)return before;
  const started=performance.now(),attempts=[],accepted=[];let current=before,checks=0;
  for(let round=0;round<6&&checks<16;round++){
    const protectedIds=new Set(current.assemblyPlan.modules.filter(m=>m.buildContext).flatMap(m=>m.brickIds));
    const protectedBricks=current.assemblyPlan.bricks.filter(b=>protectedIds.has(b.id));
    const proposals=proposeConnectedPacking(current.brickModel,{maxChecks:96,maxCandidates:4});
    // A high-gain seam can destroy a completed table recipe. Spend the remaining
    // bounded evaluation allowance on alternatives outside those assemblies.
    const alternatives=protectedBricks.length
      ? proposeConnectedPacking(current.brickModel,{maxChecks:96,maxCandidates:4,protectedBricks}).proposals:[];
    const diverse=proposeConnectedPacking(current.brickModel,{maxChecks:96,maxCandidates:4,protectedBricks,diverseInterfaces:true}).proposals;
    const signatures=new Set(proposals.proposals.map(p=>JSON.stringify(p.after)));
    for(const proposal of [...alternatives,...diverse]) {
      const key=JSON.stringify(proposal.after);
      if(!signatures.has(key)){signatures.add(key);proposals.proposals.push(proposal);}
    }
    let chosen;
    for(const proposal of proposals.proposals){
      if(++checks>16)break;
      try{
        const brickModel={...current.brickModel,bricks:proposal.bricks};
        const ownership=ownershipReplay(current.assemblyPlan,brickModel,proposal);
        const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:ownership.replay,
          preferLocalProgress:true,preferLocalFoundations:true,integratedBuild:current.assemblyPlan.integratedBuild??false});
        const candidate=planHangingAssemblies(prepareAssemblyGuide({...current,brickModel,assemblyPlan},{moduleReplay:ownership.replay}));
        const reasons=[...assemblyRejectionReasons(current.assemblyPlan,candidate.assemblyPlan),
          ...orderQualityRejections(assessAssemblyQuality(current.assemblyPlan),assessAssemblyQuality(candidate.assemblyPlan))];
        if(unresolvedCells(candidate.assemblyPlan).size>=unresolvedCells(current.assemblyPlan).size)reasons.push('Unresolved occupied volume did not decrease');
        if(candidate.assemblyPlan.stats.upwardInsertionBrickCount>current.assemblyPlan.stats.upwardInsertionBrickCount)reasons.push('Upward insertions increased');
        if(!candidate.instructionPlan.stats.coverageComplete||!candidate.guide.stats.coverageComplete
          ||!candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete)reasons.push('Incomplete source coverage');
        attempts.push({round,connectedCellCount:proposal.connectedCellCount,rejectionReasons:reasons});
        if(reasons.length)continue;
        chosen=candidate;accepted.push({round,before:proposal.before,after:proposal.after,
          connectedCellCount:proposal.connectedCellCount,anchorId:ownership.anchorId,joinedBrickIds:ownership.joinedBrickIds});break;
      }catch(error){attempts.push({round,rejectionReasons:[error.message]});}
    }
    if(!chosen)break;current=chosen;
  }
  const report={selected:accepted.length>0,accepted,attempts,checks:Math.min(checks,16),planningMs:performance.now()-started,
    beforeUnresolved:before.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:current.assemblyPlan.stats.unresolvedBrickCount};
  if(!accepted.length)return {...before,connectedAssemblyPlanning:report};
  const histogram={};for(const b of current.brickModel.bricks){const type=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[type]=(histogram[type]??0)+1;}
  return {...current,connectedAssemblyPlanning:report,diagnostics:inspectConstruction(current.brickModel),
    metrics:{...current.metrics,brickCount:current.brickModel.bricks.length,partHistogram:histogram,
      conversionMs:before.metrics.conversionMs+report.planningMs}};
}
