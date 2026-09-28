import { createAssemblyPlan } from './assembly.js';
import { inspectConstruction } from './construction.js';
import { proposeBrickRefinements } from './brick-refinement.js';
import { packingProfile, packingRejectionReasons, unresolvedCells, assemblyRejectionReasons } from './refine-construction.js';
import { prepareAssemblyGuide } from './prepare-assembly-guide.js';
import { planSubassemblies } from './plan-subassemblies.js';
import { proposeAttachmentCorridors } from './attachment-corridors.js';
import { remapAttachmentBand } from './attachment-band.js';
import { measureBrickDifference } from './construction-differences.js';
import { refineWorkSurfaceOrder } from './refine-work-surface-order.js';

const MAX_REPACKS = 8;
const MAX_JOIN_CHECKS = 96;
const MAX_JOIN_ROUNDS = 16;
const brickKey = ({x,y,z,w,d,color}) => `${x},${y},${z}:${w}x${d}:${color}`;
const cellKey = ({x,y,z}) => `${x},${y},${z}`;

function plan(result, band = null) {
  return prepareAssemblyGuide({...result, assemblyPlan: createAssemblyPlan({
    brickModel: result.brickModel, integratedBuild: true,
    preferLocalProgress: true, preferLocalFoundations: true,
    ...(band ? {workSurfaceBrickIds: band.workSurfaceBrickIds, workSurfaceOrder: band.workSurfaceOrder} : {}),
  })});
}

function connectSeams(result, report) {
  let current = result;
  for (let round = 0; round < MAX_REPACKS; round++) {
    const profile = packingProfile(current.brickModel.bricks);
    const generated = proposeBrickRefinements(current.brickModel, {maxPatches: 64, maxSearchNodes: 20_000, supportOnly: false});
    let best = null;
    for (const proposal of generated.proposals) {
      const replaced = new Set(proposal.before.map(brickKey));
      const bricks = [...current.brickModel.bricks.filter(b => !replaced.has(brickKey(b))), ...proposal.after];
      if (packingRejectionReasons(profile, packingProfile(bricks)).length) continue;
      const brickModel = {...current.brickModel, bricks};
      const diagnostics = inspectConstruction(brickModel);
      if (diagnostics.stats.componentCount >= current.diagnostics.stats.componentCount) continue;
      if (!best || diagnostics.stats.componentCount < best.diagnostics.stats.componentCount) best = {brickModel, diagnostics, proposal};
    }
    if (!best) break;
    report.repacked.push({before: best.proposal.before, after: best.proposal.after});
    current = {...current, brickModel: best.brickModel, diagnostics: best.diagnostics};
  }
  return current;
}

function supportShortGaps(result, budget, report, rawModel) {
  const bricks = result.brickModel.bricks.map(({id, ...b}) => ({...b}));
  const profile = packingProfile(bricks);
  const source = bricks.toSorted((a,b) => a.y-b.y || a.z-b.z || a.x-b.x);
  const rawColors = new Map(rawModel.cells.map(c => [cellKey(c), c.color]));
  for (const brick of source) {
    if (!brick.y) continue;
    const cells = [];
    for (let z=brick.z;z<brick.z+brick.d;z++) for(let x=brick.x;x<brick.x+brick.w;x++) cells.push({x,y:brick.y-1,z});
    if (cells.some(c => profile.cells.has(cellKey(c)))) continue;
    // A one-course gap may receive a small support entirely below the existing
    // footprint. Never grow arbitrary columns down to the floor.
    const supported = cells.filter(c => c.y===0 || profile.cells.has(cellKey({...c,y:c.y-1})));
    const needed = Math.ceil(brick.w * brick.d / 4);
    if (supported.length < needed || report.supportCells.length + needed > budget) continue;
    for (const cell of supported.slice(0, needed)) {
      const below = profile.cells.get(cellKey({...cell,y:cell.y-1}));
      const votes = new Map();
      for (let tick=cell.y*6;tick<(cell.y+1)*6;tick++) {
        const color=rawColors.get(cellKey({...cell,y:Math.floor(tick/5)}));
        if(color) votes.set(color,(votes.get(color)??0)+1);
      }
      const color=[...votes].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0]?.[0];
      const added = {...cell, color: color ?? below?.color ?? brick.color};
      bricks.push({...added,w:1,d:1});
      profile.cells.set(cellKey(cell),{color:added.color,index:bricks.length-1});
      report.supportCells.push(added);
    }
  }
  const brickModel = {...result.brickModel, bricks};
  return {...result,brickModel,diagnostics:inspectConstruction(brickModel)};
}

function connectTrim(result, budget, report) {
  let current = result;
  for (let round=0;round<MAX_JOIN_ROUNDS && report.joinChecks<MAX_JOIN_CHECKS;round++) {
    const remaining = budget - report.supportCells.length - report.connectorCells.length;
    if (remaining <= 0 || current.assemblyPlan.stats.unresolvedBrickCount === 0) break;
    const proposals = proposeAttachmentCorridors(current,{maxAddedCells:remaining,maxProposals:96});
    let best = null;
    let roundChecks = 0;
    for (const proposal of proposals) {
      const brickModel = {...current.brickModel,bricks:proposal.bricks};
      const diagnostics = inspectConstruction(brickModel);
      if (diagnostics.stats.componentCount >= current.diagnostics.stats.componentCount) continue;
      try {
        const band = remapAttachmentBand(current,proposal);
        report.joinChecks++;
        roundChecks++;
        const candidate = plan({...current,brickModel,diagnostics},band);
        const rejections = assemblyRejectionReasons(current.assemblyPlan,candidate.assemblyPlan);
        for (const reason of rejections) report.joinRejections[reason]=(report.joinRejections[reason]??0)+1;
        if (!rejections.length
          && candidate.assemblyPlan.stats.unresolvedBrickCount < current.assemblyPlan.stats.unresolvedBrickCount
          && (!best || candidate.assemblyPlan.stats.unresolvedBrickCount < best.candidate.assemblyPlan.stats.unresolvedBrickCount)) {
          best={candidate,proposal};
          break;
        }
      } catch (error) {
        // Ownership/plan validation is an expected rejection, not a reason to
        // keep a connector that changes an established support recipe.
        report.rejectedJoins++;
      }
      if (roundChecks>=12 || report.joinChecks>=MAX_JOIN_CHECKS) break;
    }
    if (!best) break;
    current=best.candidate;
    report.connectors.push({before:best.proposal.before,after:best.proposal.after});
    report.connectorCells.push(...best.proposal.addedCells);
  }
  return current;
}

// Evaluate a coordinated repair through its final instructions. Local seam
// repair can temporarily expose unsupported roots that a subsequent table-built
// platform solves; comparing that intermediate plan to the final baseline would
// incorrectly reject a useful repair. The final acceptance guard stays strict.
export function createContinuityCandidate(seed, rawModel) {
  const started=performance.now();
  const budget=Math.max(0,Math.min(96,Math.floor(seed.metrics.mappedCellCount*.05))
    -(seed.metrics.structuralAddedMappedCellCount??0));
  const report={version:1,selected:false,budget,repacked:[],supportCells:[],connectorCells:[],connectors:[],
    joinChecks:0,rejectedJoins:0,joinRejections:{},limits:{repackingRounds:MAX_REPACKS,joinChecks:MAX_JOIN_CHECKS,joinRounds:MAX_JOIN_ROUNDS},rejectionReasons:[]};
  let candidate=connectSeams(seed,report);
  candidate=supportShortGaps(candidate,budget,report,rawModel);
  candidate=planSubassemblies(plan(candidate));
  candidate=connectTrim(candidate,budget,report);
  candidate=refineWorkSurfaceOrder(candidate,{prioritizeHandling:true});
  report.stageMs=performance.now()-started;
  return {candidate,report};
}

export function repairConstructionContinuity(before, seed, rawModel) {
  const {candidate,report}=createContinuityCandidate(seed,rawModel);
  const difference=measureBrickDifference(rawModel,candidate.brickModel);
  report.difference=difference;
  const reasons=report.rejectionReasons;
  reasons.push(...assemblyRejectionReasons(before.assemblyPlan,candidate.assemblyPlan));
  if(unresolvedCells(candidate.assemblyPlan).size>=unresolvedCells(before.assemblyPlan).size) reasons.push('Unresolved occupied volume did not improve');
  if(candidate.diagnostics.stats.collisionPairCount || candidate.diagnostics.stats.illegalFootprintCount) reasons.push('Invalid brick geometry');
  if(difference.geometryDifferenceRatio>before.metrics.geometryDifferenceRatio+.05) reasons.push('Geometry difference exceeded five percentage points');
  // Added connector cells may overlap the fractional raw-color boundary after
  // resampling. Old occupied cells are never recolored; bound this incidental
  // overlap separately rather than treating it as a free palette change.
  if(difference.colorDifferenceRatio>before.metrics.colorDifferenceRatio+.005) reasons.push('Connector color difference exceeded half a percentage point');
  if(!candidate.guide.stats.coverageComplete || !candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete) reasons.push('Incomplete guide coverage');
  report.before=before.assemblyPlan.stats;
  report.after=candidate.assemblyPlan.stats;
  report.selected=reasons.length===0;
  if(!report.selected) return {...before,continuityRefinement:report};
  const partHistogram={};
  for(const {w,d} of candidate.brickModel.bricks) {
    const key=`${Math.min(w,d)}x${Math.max(w,d)}`;
    partHistogram[key]=(partHistogram[key]??0)+1;
  }
  return {...candidate,continuityRefinement:report,metrics:{...candidate.metrics,...difference,
    brickCount:candidate.brickModel.bricks.length,partHistogram,
    structuralAddedMappedCellCount:(seed.metrics.structuralAddedMappedCellCount??0)+report.supportCells.length+report.connectorCells.length,
    conversionMs:before.metrics.conversionMs+seed.metrics.conversionMs+report.stageMs,
    stageTiming:{...candidate.metrics.stageTiming,continuityRepairMs:report.stageMs}}};
}
