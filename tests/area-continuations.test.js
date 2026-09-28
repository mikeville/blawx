import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleAreaContinuations} from '../src/area-continuations.js';
import {replayInstructionOrder} from '../src/instruction-order-replay.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
import {createGuideSections} from '../src/guide-sections.js';

function fromBatches(batches){
  const bricks=batches.flat(),visible=[],sources=[],steps=[];
  for(const [i,batch]of batches.entries()){
    const canonical=batch.map(b=>{visible.push(b.id);const s={id:`source-${b.id}`,moduleId:'main',kind:'build',label:'Build',
      newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[...visible],issues:[]};sources.push(s);return s;});
    const ids=batch.map(b=>b.id);
    steps.push({...canonical.at(-1),id:`diagram-${i}`,newBrickIds:ids,highlightBrickIds:[...ids],sourceStepIds:canonical.map(s=>s.id),
      orderedOperations:canonical.map(s=>({id:s.id,kind:'build',newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
  }
  const modules=[{id:'main',kind:'grounded',label:'Build',brickIds:bricks.map(b=>b.id)}],stats={stepCount:steps.length,brickCount:bricks.length,coverageComplete:true};
  const assemblyPlan={version:1,bricks,modules,steps:sources,stats},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{bricks},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
function wall(transform=b=>b){
  const b=(id,x,y,z=0,color='blue')=>transform({id,x,y,z,w:2,d:2,color});
  const layer=y=>[b(`a${y}`,0,y),b(`b${y}`,2,y)];
  const r=fromBatches([[...layer(0),b('c0',8,0,4,'orange')],layer(1),layer(2),
    ...Array.from({length:4},(_,i)=>[b(`c${i+1}`,8,i+1,4,'orange')]),layer(3),layer(4),layer(5)]);
  for(let i=1;i<=2;i++)r.instructionPlan.steps[i].buildRegion={id:'wall',index:i,total:2,firstStepId:'diagram-1',lastStepId:'diagram-2'};
  r.guide=createGuideSections(r.instructionPlan);return r;
}

test('support chains continue a started region without splitting courses or its prior actions',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'green':'tan'})]){
    const before=wall(transform),frozen=structuredClone(before),after=scheduleAreaContinuations(before);
    assert.equal(after.areaContinuationScheduling.selected,true);
    assert.deepEqual(after.instructionPlan.steps.map(s=>s.id),['diagram-0','diagram-1','diagram-2','diagram-7','diagram-8','diagram-9','diagram-3','diagram-4','diagram-5','diagram-6']);
    assert.equal(after.instructionPlan.steps[1].buildRegion.total,5);
    assert.equal(after.instructionPlan.steps[1].buildRegion.lastStepId,'diagram-9');
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    for(const field of ['instructionPlan','assemblyPlan']){
      const old=new Map(before[field].steps.map(s=>[s.id,s]));
      for(const s of after[field].steps){const {visibleBrickIds,buildRegion,...a}=s,{visibleBrickIds:unused,buildRegion:oldRegion,...b}=old.get(s.id);assert.deepEqual(a,b);}
    }
    assert.deepEqual(before,frozen);assert.equal(after.brickModel,before.brickModel);assert.equal(scheduleAreaContinuations(after),after);
  }
});

test('does not cross warning or module boundaries, move accepted actions, or start inside a region',()=>{
  for(const edit of [r=>{r.instructionPlan.steps[4].issues=[{code:'limited-support'}];},
    r=>{r.instructionPlan.steps[4].moduleId='other';},r=>{r.instructionPlan.steps[7].instructionAction={kind:'feature'};},
    r=>{r.instructionPlan.steps[2].buildRegion.total=3;},
    r=>{for(const i of [2,3])r.instructionPlan.steps[i].instructionAction={id:'whole-action',kind:'feature'};},r=>{r.instructionPlan.modules[0].buildContext={kind:'table'};}]){
    const before=wall();edit(before);assert.equal(scheduleAreaContinuations(before),before);
  }
});

test('retains a low enclosure when completing its walls would hide the intervening interior placements',()=>{
  const b=(id,x,y,z,color='blue')=>({id,x,y,z,w:2,d:2,color});
  const ring=y=>[[0,0],[2,0],[4,0],[0,2],[4,2],[0,4],[2,4],[4,4]].map(([x,z],i)=>b(`ring${y}-${i}`,x,y,z));
  const r=fromBatches([[...ring(0),b('inside0',2,0,2,'orange'),b('outside0',10,0,0,'orange')],ring(1),
    [b('inside1',2,1,2,'orange')],[b('inside2',2,2,2,'orange')],[b('outside1',10,1,0,'orange')],
    ring(2),ring(3),ring(4),ring(5)]);
  const proposed=replayInstructionOrder(r,2,9,[...r.instructionPlan.steps.slice(5),...r.instructionPlan.steps.slice(2,5)]);
  assert.ok(proposed,'The early wall is physically supported, so visibility must still veto it');
  assert.equal(chooseInstructionSequence(r.instructionPlan).get('diagram-3').passes,true);
  assert.equal(chooseInstructionSequence(proposed.instructionPlan).get('diagram-3').passes,false);
  assert.equal(scheduleAreaContinuations(r),r);
});
