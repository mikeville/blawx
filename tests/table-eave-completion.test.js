import test from 'node:test';
import assert from 'node:assert/strict';
import {tableEaveFixture as fixture} from './helpers/table-eave-fixture.js';
import {proposeConnectedPacking} from '../src/connected-packing.js';
import {completeDetachedComponents} from '../src/complete-detached-components.js';
import {packingProfile,packingRejectionReasons} from '../src/refine-construction.js';
import {contactCells} from '../src/local-interface-repair.js';

const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
const region=r=>r.brickModel.bricks.filter(b=>b.y===1||b.y===2);

test('table-floor seams complete an overhanging recipe across rotations without changing geometry or attachments',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),snapshot=structuredClone(before);
    assert.equal(proposeConnectedPacking(before.brickModel,{region:region(before)}).proposals.length,0);
    const after=completeDetachedComponents(before),report=after.detachedComponentCompletion;
    assert.ok(report?.selected);assert.deepEqual(before,snapshot);
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,1);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.deepEqual(cells(before.brickModel.bricks),cells(after.brickModel.bricks));
    assert.deepEqual(packingRejectionReasons(packingProfile(before.brickModel.bricks),packingProfile(after.brickModel.bricks)),['Unsupported occupied volume increased']);
    const oldJoin=before.assemblyPlan.steps.find(s=>s.kind==='join'),join=after.assemblyPlan.steps.find(s=>s.kind==='join');
    assert.deepEqual(join.issues,[]);assert.deepEqual(contactCells(before.assemblyPlan,oldJoin),contactCells(after.assemblyPlan,join));
    const outside=r=>r.instructionPlan.steps.filter(s=>s.moduleId==='later').map(s=>({new:s.newBrickIds,highlight:s.highlightBrickIds,issues:s.issues}));
    assert.deepEqual(outside(before),outside(after));
    assert.ok(report.accepted.every(r=>r.handlingAfter.finalComponentCount===1&&r.handlingAfter.peakLooseBrickCount<=r.handlingBefore.peakLooseBrickCount+r.handlingAfter.introducedBrickCount-r.handlingBefore.introducedBrickCount+2));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  }
});

test('table-floor permission is regional and does not relax upper-course or old-component protection',()=>{
  const before=fixture(),options={region:region(before)};
  assert.equal(proposeConnectedPacking(before.brickModel,{workSurfaceFloorY:1}).proposals.length,0);
  assert.equal(proposeConnectedPacking(before.brickModel,{...options,workSurfaceFloorY:0}).proposals.length,0);
  const split=fixture(0,{splitUpper:true});
  assert.equal(proposeConnectedPacking(split.brickModel,{region:region(split),workSurfaceFloorY:1}).proposals.length,0);
  const after=completeDetachedComponents(split);assert.ok(!after.detachedComponentCompletion?.selected);assert.deepEqual(after.brickModel,split.brickModel);
});

test('seam completion requires a real work surface and a feasible final attachment',()=>{
  for(const mode of ['no-floor','no-base','repeat','nested']){
    const before=fixture(0,{withoutBase:mode==='no-base'});
    const roof=before.assemblyPlan.modules.find(m=>m.id==='roof');
    if(mode==='no-floor')delete roof.buildContext;
    if(mode==='repeat')roof.sharedHandledRecipe={familyId:'pair'};
    if(mode==='nested')before.assemblyPlan.steps[0].nestedRecipe={id:'child'};
    const after=completeDetachedComponents(before);
    assert.ok(!after.detachedComponentCompletion?.selected,mode);
    assert.deepEqual(after.brickModel,before.brickModel,mode);
  }
});
