import test from 'node:test';
import assert from 'node:assert/strict';
import {receiverDetailFixture as fixture} from './helpers/receiver-detail-fixture.js';
import {repairReceiverDetails} from '../src/receiver-detail-repair.js';
import {contactCells} from '../src/local-interface-repair.js';

const cells=bs=>new Map(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));

test('a repaired detail joins its receiving course before the cap, across rotations and colors',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),saved=structuredClone(before),after=repairReceiverDetails(before,{allowExtensions:true});
    assert.ok(after.receiverDetailRepair?.selected);assert.deepEqual(before,saved);
    const old=before.assemblyPlan,next=after.assemblyPlan,report=after.receiverDetailRepair;
    assert.equal(old.stats.unresolvedBrickCount,2);assert.equal(next.stats.unresolvedBrickCount,1);
    assert.equal(report.addedCells.length,1);assert.equal(after.metrics.structuralAddedMappedCellCount,1);
    const oldCells=cells(old.bricks),newCells=cells(next.bricks);
    assert.equal(newCells.size,oldCells.size+1);
    for(const [key,color]of oldCells)assert.equal(newCells.get(key),color);
    const added=report.addedCells[0];assert.equal(newCells.get(`${added.x},${added.y},${added.z}`),added.color);
    assert.ok(next.bricks.some(b=>b.y===added.y+1&&b.x<=added.x&&b.x+b.w>added.x&&b.z<=added.z&&b.z+b.d>added.z));
    const detail=next.bricks.find(b=>b.color===(turn%2?'blue':'yellow'));
    const oldBody=before.instructionPlan.steps.filter(s=>s.moduleId==='body'),body=after.instructionPlan.steps.filter(s=>s.moduleId==='body');
    assert.equal(body.length,oldBody.length);
    assert.deepEqual(body[1].newBrickIds,[...oldBody[1].newBrickIds,detail.id]);
    assert.ok(body.every(s=>!s.issues.length));
    assert.ok(next.modules.find(m=>m.id==='body').brickIds.includes(detail.id));
    const outside=r=>r.instructionPlan.steps.filter(s=>s.moduleId==='top').map(s=>({new:s.newBrickIds,highlight:s.highlightBrickIds,issues:s.issues,kind:s.kind}));
    assert.deepEqual(outside(before),outside(after));
    const join=p=>p.steps.find(s=>s.moduleId==='top'&&s.kind==='join');
    assert.deepEqual(contactCells(old,join(old)),contactCells(next,join(next)));assert.deepEqual(join(next).issues,[]);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id));
    assert.deepEqual(next.steps.flatMap(s=>s.newBrickIds).sort(),next.bricks.map(b=>b.id).sort());
    assert.equal(repairReceiverDetails(after,{allowExtensions:true}),after);
  }
});

test('receiving-course repair requires opt-in, remaining allowance and a supported scope',()=>{
  for(const mode of ['disabled','budget','raw','dirty','upward','nested','repeat']){
    const before=fixture();
    if(mode==='budget')before.metrics={structuralAddedMappedCellCount:4};
    if(mode==='raw')before.metrics={geometryDifferenceRatio:0};
    if(mode==='dirty')before.assemblyPlan.steps[0].issues.push({code:'temporary-hold'});
    if(mode==='upward')before.assemblyPlan.steps[0].insertionDirection='up';
    if(mode==='nested')before.assemblyPlan.steps[0].nestedRecipe={id:'child'};
    if(mode==='repeat')before.assemblyPlan.modules[0].sharedHandledRecipe={familyId:'pair'};
    const saved=structuredClone(before),after=repairReceiverDetails(before,{allowExtensions:mode!=='disabled'});
    assert.ok(!after.receiverDetailRepair?.selected,mode);assert.deepEqual(before,saved,mode);
    for(const key of ['brickModel','assemblyPlan','instructionPlan','guide'])assert.deepEqual(after[key],before[key],mode+'/'+key);
  }
});

test('a geometrically connected detail is rejected when the receiving course is already covered',()=>{
  const before=fixture(0,{blocked:true});
  assert.ok(before.assemblyPlan.steps.filter(s=>s.moduleId==='body').every(s=>!s.issues.length));
  const after=repairReceiverDetails(before,{allowExtensions:true});
  assert.equal(after.receiverDetailRepair?.selected,false);
  assert.ok(after.receiverDetailRepair.attempts.some(a=>a.reasons.some(r=>r.includes('prerequisites'))));
  for(const key of ['brickModel','assemblyPlan','instructionPlan','guide'])assert.deepEqual(after[key],before[key]);
});
