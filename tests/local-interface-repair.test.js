import test from 'node:test';
import assert from 'node:assert/strict';
import {detachedInterfaceFixture as fixture} from './helpers/detached-interface-fixture.js';
import {repairLocalInterfaces,discoverLocalInterfaceRepairs,contactCells} from '../src/local-interface-repair.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
import {createAssemblyJoinPreview} from '../src/assembly-join-preview.js';
import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';
const cells=bricks=>new Map(bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));

test('small detached assemblies gain spaced interfaces and complete recipes across orientations and colors',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),saved=structuredClone(before),after=repairLocalInterfaces(before,{allowExtensions:true});
    assert.ok(after.localInterfaceRepair?.selected,JSON.stringify(after.localInterfaceRepair));
    assert.deepEqual(before,saved);
    const old=cells(before.brickModel.bricks),next=cells(after.brickModel.bricks);
    for(const [position,color]of old)assert.equal(next.get(position),color);
    assert.equal(next.size-old.size,4);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.assemblyEvaluation.after.unresolvedBrickCount,0);
    const receipt=after.localInterfaceRepair.attempts.at(-1);
    assert.equal(receipt.contactSpan,7);
    assert.ok(receipt.handlingAfter.every(m=>m.finalComponentCount===1));
    const builds=after.assemblyPlan.steps.filter(s=>s.moduleId==='detached');
    assert.equal(builds.filter(s=>s.kind==='join').length,1);
    assert.ok(builds.every(s=>!s.issues.length));
    assert.equal(builds.at(-1).kind,'join');
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
    const p=createBookletPresentation(after);
    assert.ok(p.presentation.sections.filter(s=>s.moduleIds.includes('detached')).every(s=>s.label==='Assembly'||s.label==='Attach assemblies'));
    const join=after.instructionPlan.steps.find(s=>s.moduleId==='detached'&&s.kind==='join'),view=chooseInstructionSequence(after.instructionPlan).get(join.id);
    assert.ok(view?.passes&&!view.truncated);
    const expanded=createAssemblyJoinPreview({model:{...after.brickModel,bricks:after.assemblyPlan.bricks.filter(b=>join.visibleBrickIds.includes(b.id))},highlightIds:new Set(join.highlightBrickIds),joinContext:join.joinContext});
    assert.ok(expanded.active);
    assert.equal(expanded.targetStuds.length,2);
    assert.deepEqual(repairLocalInterfaces(after,{allowExtensions:true}),after);
  }
});

test('repair respects adjustment opt-in, missing supports, exhausted additions and incompatible ownership',()=>{
  const original=fixture();assert.equal(repairLocalInterfaces(original),original);
  for(const variant of ['missing-gap','wrong-color','outside-gap','budget','nested','upward','late-receiver']){
    const r=fixture();
    if(variant==='missing-gap')r.continuityRefinement.supportCells=[];
    if(variant==='wrong-color')r.continuityRefinement.supportCells.forEach(c=>c.color='yellow');
    if(variant==='outside-gap')r.continuityRefinement.supportCells.forEach(c=>c.x+=20);
    if(variant==='budget')r.metrics={structuralAddedMappedCellCount:24};
    if(variant==='nested')r.assemblyPlan.steps[0].nestedRecipe={id:'nested'};
    if(variant==='upward')r.assemblyPlan.steps.find(s=>s.moduleId==='detached').insertionDirection='up';
    if(variant==='late-receiver')r.assemblyPlan.modules.reverse();
    const after=repairLocalInterfaces(r,{allowExtensions:true});
    assert.ok(!after.localInterfaceRepair?.selected,variant);
    assert.deepEqual(after.brickModel,r.brickModel,variant);
    assert.deepEqual(after.instructionPlan,r.instructionPlan,variant);
  }
});

test('an overhead obstruction cannot be excused by a connected final stud graph',()=>{
  const r=fixture(0,{blocked:true});assert.ok(discoverLocalInterfaceRepairs(r).length);
  const after=repairLocalInterfaces(r,{allowExtensions:true});
  assert.ok(!after.localInterfaceRepair?.selected,JSON.stringify(after.localInterfaceRepair));
  assert.deepEqual(after.brickModel,r.brickModel);
  assert.ok(after.localInterfaceRepair.attempts.some(a=>a.reasons.includes('Incomplete handled repair')));
});

test('duplicate support proposals cannot duplicate geometry and existing source metrics require raw evidence',()=>{
  const r=fixture();r.continuityRefinement.supportCells.push({...r.continuityRefinement.supportCells[0]});
  const a=repairLocalInterfaces(r,{allowExtensions:true});assert.ok(a.localInterfaceRepair?.selected);assert.equal(a.localInterfaceRepair.attempts[0].addedCells.length,4);
  r.metrics={geometryDifferenceRatio:.01};assert.equal(repairLocalInterfaces(r,{allowExtensions:true}),r);
});

test('attachment evidence counts validated supports rather than visible failed geometry',()=>{
 const bricks=[{id:'support',x:0,y:0,z:0,w:2,d:2},{id:'failed',x:2,y:0,z:0,w:2,d:2},{id:'moving',x:0,y:1,z:0,w:4,d:2}];
 const plan={bricks,graph:{edges:[{a:'support',b:'moving'},{a:'failed',b:'moving'}]}};
 const step={highlightBrickIds:['moving'],visibleBrickIds:['support','failed','moving'],joinContext:{direction:'down',supportGroups:[{contacts:[{supportBrickId:'support',bandBrickId:'moving',studs:4}]}]}};
 assert.deepEqual(contactCells(plan,step),['0,1,0:down','0,1,1:down','1,1,0:down','1,1,1:down']);
 assert.deepEqual(contactCells(plan,{...step,visibleBrickIds:['support','moving']}),contactCells(plan,step));
 const removed={...step,joinContext:{direction:'down',supportGroups:[]}};assert.deepEqual(contactCells(plan,removed),[]);
});
