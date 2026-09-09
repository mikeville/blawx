import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyPlan } from '../src/assembly.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { refineWorkSurfaceOrder, workSurfacePreservationRejections } from '../src/refine-work-surface-order.js';
import { assemblyRejectionReasons } from '../src/refine-construction.js';
import { assessAssemblyQuality, orderQualityRejections } from '../src/assembly-quality.js';

const brick = (x, y, w, color = 'red') => ({x, y, z:0, w, d:2, color});
function bandResult(count) {
  const bricks = [brick(0,0,2), brick(2*count-2,0,2)];
  for (let i=0;i<count;i++) bricks.push(brick(2*i,1,2));
  bricks.push(brick(0,2,1));
  for (let i=0;i<count-1;i++) bricks.push(brick(2*i+1,2,2));
  bricks.push(brick(2*count-1,2,1));
  // A side branch makes this an irregular band, suitable for connected patches.
  bricks[2].d = 4;
  bricks.push({...brick(0,2,2),z:2});
  return preparedBand(bricks);
}
function preparedBand(bricks) {
  const brickModel = {version:1, kind:'bricks', bricks};
  const plan = createAssemblyPlan({brickModel});
  const assemblyPlan = createAssemblyPlan({brickModel,
    workSurfaceBrickIds:plan.bricks.filter(b=>b.y>0).map(b=>b.id),
    preferLocalProgress:true, preferLocalFoundations:true});
  return prepareAssemblyGuide({brickModel, assemblyPlan, diagnostics:{preserved:true}, metrics:{conversionMs:7}});
}

function rectangularBand() {
  const bricks = [brick(0,0,4), {...brick(8,0,4),z:6}];
  for (const [z,d] of [[0,1],[1,2],[3,2],[5,2],[7,1]]) {
    for (const x of [0,4,8]) bricks.push({...brick(x,1,4),z,d});
  }
  for (const z of [0,4]) {
    for (const [x,w] of [[0,1],[1,2],[3,2],[5,2],[7,2],[9,2],[11,1]]) {
      bricks.push({...brick(x,2,w),z,d:4});
    }
  }
  return preparedBand(bricks);
}

test('regular platforms complete rectangular courses without relaxing assembly or join checks', () => {
  const input = rectangularBand();
  const output = refineWorkSurfaceOrder(input);
  const report = output.workSurfaceOrdering;
  assert.equal(report.policy,'rectangular-layers');
  assert.equal(report.selected,true,JSON.stringify(report.rejectionReasons));
  assert.equal(report.after.grouping.mixedCourseDiagramCount,0);
  assert.equal(report.after.grouping.courseReturnCount,0);
  assert.ok(report.after.grouping.rectangularCoverageRatio>=report.before.grouping.rectangularCoverageRatio);
  assert.equal(report.after.canonical.finalComponentCount,1);
  const band = output.assemblyPlan.modules.find(m=>m.buildContext?.kind==='work-surface');
  assert.deepEqual(workSurfacePreservationRejections(input,output,band),[]);
  assert.deepEqual(orderQualityRejections(assessAssemblyQuality(input.assemblyPlan),assessAssemblyQuality(output.assemblyPlan)),[]);
  assert.equal(band.buildContext.orderPolicy,'rectangular-layers');
  const again = prepareAssemblyGuide(output);
  assert.deepEqual(again.assemblyPlan.steps.map(s=>s.newBrickIds),output.assemblyPlan.steps.map(s=>s.newBrickIds));
  assert.deepEqual(output.brickModel,input.brickModel);
  assert.ok(report.after.canonical.peakLooseBrickCount>1,'Loose floor bricks are measured, not a universal rejection.');
});

test('selects a measured handling improvement while preserving geometry, joins and operation coverage', () => {
  const input = bandResult(8);
  const snapshot = structuredClone(input);
  const output = refineWorkSurfaceOrder(input);
  const report = output.workSurfaceOrdering;
  assert.equal(report.policy,'connected-patches');
  assert.equal(report.selected,true,JSON.stringify(report.rejectionReasons));
  assert.ok(report.after.canonical.peakDetachedBrickCount < report.before.canonical.peakDetachedBrickCount);
  assert.ok(report.after.canonical.detachedBrickExposure < report.before.canonical.detachedBrickExposure);
  assert.ok(report.after.canonical.firstBondAtAddition < report.before.canonical.firstBondAtAddition);
  assert.equal(report.after.canonical.finalComponentCount,1);
  assert.deepEqual(assemblyRejectionReasons(input.assemblyPlan,output.assemblyPlan),[]);
  assert.deepEqual(orderQualityRejections(assessAssemblyQuality(input.assemblyPlan),assessAssemblyQuality(output.assemblyPlan)),[]);
  assert.deepEqual(output.brickModel,input.brickModel);
  assert.deepEqual(output.diagnostics,input.diagnostics);
  assert.deepEqual(output.assemblyPlan.inventory,input.assemblyPlan.inventory);
  assert.deepEqual(output.assemblyPlan.steps.find(s=>s.kind==='join').joinContext,
    input.assemblyPlan.steps.find(s=>s.kind==='join').joinContext);
  assert.deepEqual(output.instructionPlan.steps.flatMap(s=>s.orderedOperations.map(op=>op.id)),output.assemblyPlan.steps.map(s=>s.id));
  assert.equal(output.assemblyEvaluation.compaction.brickCoverageComplete,true);
  assert.deepEqual(input,snapshot);
  assert.equal(output.metrics.conversionMs,input.metrics.conversionMs+report.orderingMs);
  assert.equal(output.metrics.stageTiming.guidePreparationMs,input.metrics.stageTiming.guidePreparationMs);
  assert.equal(report.geometryChanges,0);
  assert.equal(report.colorChanges,0);
});

test('rejects altered outside warning evidence and join highlights even with unchanged aggregate counts', () => {
  const source = bandResult(8);
  const band = source.assemblyPlan.modules.find(m=>m.buildContext?.kind==='work-surface');
  const outside = source.assemblyPlan.steps.find(s=>s.moduleId!==band.id);
  outside.issues.push({code:'temporary-hold',severity:'warning',message:'Recorded handling obligation.',brickIds:[outside.newBrickIds[0]]});
  const alteredIssue = structuredClone(source);
  alteredIssue.assemblyPlan.steps.find(s=>s.id===outside.id).issues[0].brickIds = [band.brickIds[0]];
  assert.deepEqual(alteredIssue.assemblyPlan.stats,source.assemblyPlan.stats);
  assert.ok(workSurfacePreservationRejections(source,alteredIssue,band).includes('Operations outside the selected band changed'));
  const alteredJoin = structuredClone(source);
  alteredJoin.assemblyPlan.steps.find(s=>s.moduleId===band.id&&s.kind==='join').highlightBrickIds.pop();
  assert.deepEqual(alteredJoin.assemblyPlan.stats,source.assemblyPlan.stats);
  assert.ok(workSurfacePreservationRejections(source,alteredJoin,band).includes('Successful join or its support contacts changed'));
});

test('re-preparing the guide preserves the selected patch order', () => {
  const chosen = refineWorkSurfaceOrder(bandResult(8));
  assert.equal(chosen.workSurfaceOrdering.selected,true);
  const again = prepareAssemblyGuide(chosen);
  const band = again.assemblyPlan.modules.find(m=>m.buildContext?.kind==='work-surface');
  assert.equal(band.buildContext.orderPolicy,'connected-patches');
  assert.deepEqual(again.assemblyPlan.steps.map(s=>s.newBrickIds),chosen.assemblyPlan.steps.map(s=>s.newBrickIds));
});

test('retains the prior guide when the one candidate has no further handling improvement', () => {
  const chosen = refineWorkSurfaceOrder(bandResult(8));
  const again = refineWorkSurfaceOrder(chosen);
  assert.equal(again.workSurfaceOrdering.selected,false);
  assert.ok(again.workSurfaceOrdering.rejectionReasons.includes('Detached-brick exposure did not strictly decrease'));
  assert.strictEqual(again.assemblyPlan,chosen.assemblyPlan);
  assert.strictEqual(again.instructionPlan,chosen.instructionPlan);
  assert.deepEqual(again.workSurfaceOrdering.before,again.workSurfaceOrdering.after);
});

test('does not generate an ordering candidate for a plan without a work-surface band', () => {
  const brickModel = {version:1,kind:'bricks',bricks:[brick(0,0,2)]};
  const input = prepareAssemblyGuide({brickModel,metrics:{conversionMs:0}});
  assert.strictEqual(refineWorkSurfaceOrder(input),input);
});
