import test from 'node:test';
import assert from 'node:assert/strict';
import {detachedRoofFixture as fixture} from './helpers/detached-roof-fixture.js';
import {completeDetachedComponents} from '../src/complete-detached-components.js';
import {contactCells} from '../src/local-interface-repair.js';
const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();

test('a detached fragment and its dependent detail complete their receiving recipe across rotations and colors',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),saved=structuredClone(before),after=completeDetachedComponents(before);
    assert.ok(after.detachedComponentCompletion?.selected,JSON.stringify(after.detachedComponentCompletion));assert.deepEqual(before,saved);
    assert.deepEqual(cells(after.brickModel.bricks),cells(before.brickModel.bricks));
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,1);
    const old=before.assemblyPlan,next=after.assemblyPlan,trim=next.modules.find(m=>m.id==='trim'),roof=next.modules.find(m=>m.id==='roof');
    assert.equal(trim.brickIds.length,1);assert.equal(next.bricks.find(b=>b.id===trim.brickIds[0]).color,'orange');
    assert.ok(next.bricks.some(b=>roof.brickIds.includes(b.id)&&b.color==='white'));
    const joins=next.steps.filter(s=>s.moduleId==='roof'&&s.kind==='join');assert.equal(joins.length,1);assert.deepEqual(joins[0].issues,[]);
    assert.deepEqual(contactCells(old,old.steps.find(s=>s.moduleId==='roof'&&s.kind==='join')),contactCells(next,joins[0]));
    const later=r=>r.instructionPlan.steps.filter(s=>s.moduleId==='later').map(s=>({new:s.newBrickIds,highlight:s.highlightBrickIds,issues:s.issues,kind:s.kind}));
    assert.deepEqual(later(before),later(after));
    const completeRoof=new Set(roof.brickIds);assert.ok(next.steps.filter(s=>s.moduleId==='later').every(s=>[...completeRoof].every(id=>s.visibleBrickIds.includes(id))));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),next.steps.map(s=>s.id));
    assert.deepEqual(next.steps.flatMap(s=>s.newBrickIds).sort(),next.bricks.map(b=>b.id).sort());
    assert.equal(completeDetachedComponents(after),after);
  }
});

test('ownership repair does not recolor a seam, alter a repeated recipe or cross nested scope',()=>{
  for(const mode of ['color','repeat','nested']){
    const r=fixture(0,{recolor:mode==='color'});
    if(mode==='repeat')r.assemblyPlan.modules.find(m=>m.id==='roof').sharedHandledRecipe={familyId:'pair'};
    if(mode==='nested')r.assemblyPlan.steps[0].nestedRecipe={id:'child'};
    const after=completeDetachedComponents(r);
    assert.ok(!after.detachedComponentCompletion?.selected,mode);
    assert.deepEqual(after.brickModel,r.brickModel);assert.deepEqual(after.instructionPlan,r.instructionPlan);
  }
});
