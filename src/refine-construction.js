import { createAssemblyPlan } from './assembly.js';
import { inspectConstruction } from './construction.js';
import { proposeBrickRefinements } from './brick-refinement.js';

const MAX_EVALUATIONS = 64;
const MAX_PASSES = 3;
const cellKey = (x,y,z) => `${x},${y},${z}`;
const brickKey = b => `${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const compareBricks = (a,b) => a.y-b.y || a.z-b.z || a.x-b.x || a.w-b.w || a.d-b.d || a.color.localeCompare(b.color);
const cellsOf = brick => {
  const cells = [];
  for(let x=brick.x;x<brick.x+brick.w;x++) for(let z=brick.z;z<brick.z+brick.d;z++) cells.push(cellKey(x,brick.y,z));
  return cells;
};

export function packingProfile(bricks) {
  const cells = new Map();
  const parent = bricks.map((_,i)=>i);
  const find = i => { while(parent[i]!==i) { parent[i]=parent[parent[i]];i=parent[i]; } return i; };
  const union = (a,b) => { parent[find(a)]=find(b); };
  bricks.forEach((brick,index)=>{
    for(const key of cellsOf(brick)) {
      if(cells.has(key)) throw new Error('Refinement candidate has overlapping placements.');
      cells.set(key,{index,color:brick.color});
    }
  });
  let unsupportedCellCount = 0;
  bricks.forEach((brick,index)=>{
    let supported = brick.y===0;
    for(let x=brick.x;x<brick.x+brick.w;x++) for(let z=brick.z;z<brick.z+brick.d;z++) {
      const lower = cells.get(cellKey(x,brick.y-1,z));
      if(lower) { supported=true;union(index,lower.index); }
    }
    if(!supported) unsupportedCellCount+=brick.w*brick.d;
  });
  for(const cell of cells.values()) cell.component=find(cell.index);
  return {cells,unsupportedCellCount};
}

export function packingRejectionReasons(before, after) {
  const reasons = [];
  const mappedComponents = new Map();
  if(before.cells.size!==after.cells.size) reasons.push('Occupied volume changed');
  for(const [key,cell] of before.cells) {
    const next = after.cells.get(key);
    if(!next || next.color!==cell.color) { reasons.push('Geometry or color changed');break; }
    const mapped = mappedComponents.get(cell.component);
    if(mapped!==undefined && mapped!==next.component) { reasons.push('An existing stud component was split');break; }
    mappedComponents.set(cell.component,next.component);
  }
  if(after.unsupportedCellCount>before.unsupportedCellCount) reasons.push('Unsupported occupied volume increased');
  return reasons;
}

export function unresolvedCells(plan) {
  const byId = new Map(plan.bricks.map(brick=>[brick.id,brick]));
  return new Set(plan.steps.filter(step=>step.kind==='unresolved').flatMap(step=>
    (step.newBrickIds.length ? step.newBrickIds : step.highlightBrickIds).flatMap(id=>cellsOf(byId.get(id)))));
}

export function assemblyRejectionReasons(before, after) {
  const reasons = [];
  if(!after.stats.coverageComplete) reasons.push('Incomplete assembly coverage');
  for(const metric of ['rootFailureCount','blockedJoinCount','temporaryHoldStepCount']) {
    if(after.stats[metric]>before.stats[metric]) reasons.push(`${metric} increased`);
  }
  const original = unresolvedCells(before);
  if([...unresolvedCells(after)].some(key=>!original.has(key))) reasons.push('Previously resolved occupied cells became unresolved');
  return reasons;
}

function histogram(bricks) {
  const counts = {};
  for(const b of bricks) {
    const key = `${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;
    counts[key]=(counts[key]??0)+1;
  }
  return counts;
}

// Reconsider seams before writing instructions. Geometry is fixed: this stage
// replaces rectangular parts, never adds support voxels or silently recolors.
export function refineConstruction(result) {
  const started = performance.now();
  const originalModel = result.brickModel;
  const originalPlan = result.assemblyPlan ?? createAssemblyPlan({brickModel:originalModel});
  let plan = originalPlan;
  let model = originalModel;
  let profile = packingProfile(model.bricks);
  const report = {
    version:1,policy:'exact-rectangular-refinement',evaluations:0,limit:MAX_EVALUATIONS,
    passes:0,accepted:[],rejections:{},searchNodes:0,searchLimitReached:false,
    before:{brickCount:model.bricks.length,partHistogram:histogram(model.bricks),unsupportedCellCount:profile.unsupportedCellCount,unresolvedCellCount:unresolvedCells(plan).size,assembly:plan.stats},
  };
  const localPlan = createAssemblyPlan({brickModel:model,preferLocalProgress:true});
  const orderRejections = assemblyRejectionReasons(plan,localPlan);
  if(!orderRejections.length) plan=localPlan;
  report.localOrdering={selected:!orderRejections.length,rejectionReasons:orderRejections};
  const attempted = new Set();
  for(let pass=0;pass<MAX_PASSES && report.evaluations<MAX_EVALUATIONS;pass++) {
    report.passes++;
    const candidates = proposeBrickRefinements(model);
    report.searchNodes+=candidates.stats.searchNodes;
    report.searchLimitReached ||= candidates.stats.limitReached;
    let acceptedThisPass = 0;
    for(const proposal of candidates.proposals) {
      if(report.evaluations>=MAX_EVALUATIONS) break;
      const oldKeys = new Set(proposal.before.map(brickKey));
      const identity = [...oldKeys].sort().join('|')+'>'+proposal.after.map(brickKey).sort().join('|');
      if(attempted.has(identity)) continue;
      attempted.add(identity);
      const currentKeys = new Set(model.bricks.map(brickKey));
      if([...oldKeys].some(key=>!currentKeys.has(key))) continue;
      const bricks = [...model.bricks.filter(brick=>!oldKeys.has(brickKey(brick))),...proposal.after]
        .map(({id:_id,...brick})=>brick).sort(compareBricks);
      const candidateModel = {...model,bricks};
      report.evaluations++;
      const candidateProfile = packingProfile(bricks);
      let reasons = packingRejectionReasons(profile,candidateProfile);
      if(bricks.length>model.bricks.length) reasons.push('Part count increased');
      const diagnostics = inspectConstruction(candidateModel);
      if(!diagnostics.checks.schema || !diagnostics.checks.legalFootprints || !diagnostics.checks.noCollisions) reasons.push('Invalid or overlapping parts');
      let candidatePlan;
      if(!reasons.length) {
        candidatePlan=createAssemblyPlan({brickModel:candidateModel,preferLocalProgress:report.localOrdering.selected});
        reasons=assemblyRejectionReasons(plan,candidatePlan);
      }
      if(reasons.length) {
        for(const reason of reasons) report.rejections[reason]=(report.rejections[reason]??0)+1;
        continue;
      }
      model=candidateModel;profile=candidateProfile;plan=candidatePlan;acceptedThisPass++;
      report.accepted.push({before:proposal.before,after:proposal.after,reason:proposal.reason});
    }
    if(!acceptedThisPass) break;
  }
  report.limitReached=report.evaluations>=MAX_EVALUATIONS;
  report.after={brickCount:model.bricks.length,partHistogram:histogram(model.bricks),unsupportedCellCount:profile.unsupportedCellCount,unresolvedCellCount:unresolvedCells(plan).size,assembly:plan.stats};
  report.geometryChanges=0;report.colorChanges=0;
  report.refinementMs=performance.now()-started;
  report.limitations='Bounded exact retiling, not an optimal packing or strength solver. Stud connectivity is preserved; support area, hand access, balance and clutch strength remain separate concerns. Automatic underside workarounds are disabled while packing and assembly quality are under review.';
  return {
    ...result,brickModel:{...model,meta:{...model.meta,packingRefinement:'exact-rectangular-v1'}},
    diagnostics:inspectConstruction(model),assemblyPlan:plan,packingRefinement:report,
    metrics:{...result.metrics,brickCount:model.bricks.length,partHistogram:histogram(model.bricks),
      conversionMs:result.metrics.conversionMs+report.refinementMs,
      stageTiming:{...result.metrics.stageTiming,refinementMs:report.refinementMs}},
  };
}
