import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleRepeatedDetails} from '../src/repeated-detail-order.js';
import {createGuideSections} from '../src/guide-sections.js';

function fixture(transform=b=>b){
  const brick=(id,x,y,z=0)=>transform({id,x,y,z,w:2,d:2,color:'blue'});
  const base=[brick('a0',0,0),brick('b0',10,0),brick('c0',4,0,4)];
  const batches=[base,[brick('a1',0,1),brick('a2',0,2)],
    ...Array.from({length:8},(_,i)=>[brick(`c${i+1}`,4,i+1,4)]),[brick('b1',10,1),brick('b2',10,2)]];
  const bricks=batches.flat(),visible=[],canonical=[],steps=[];
  for(const [i,batch]of batches.entries()){
    const sources=batch.map(b=>{
      visible.push(b.id);
      const s={id:`source-${b.id}`,moduleId:'main',label:'Build',kind:'build',newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[...visible],issues:[]};canonical.push(s);return s;
    });
    const ids=batch.map(b=>b.id);
    steps.push({...sources.at(-1),id:`diagram-${i}`,newBrickIds:ids,highlightBrickIds:[...ids],
      sourceStepIds:sources.map(s=>s.id),orderedOperations:sources.map(s=>({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
  }
  const modules=[{id:'main',kind:'grounded',label:'Build',brickIds:bricks.map(b=>b.id)}],stats={stepCount:steps.length,brickCount:bricks.length,coverageComplete:true};
  const assemblyPlan={version:1,bricks,modules,steps:canonical,stats},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{bricks},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('moves a delayed completed match beside its peer while retaining literal operations',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:'red'})]){
    const before=fixture(transform),frozen=structuredClone(before),after=scheduleRepeatedDetails(before);
    assert.equal(after.repeatedDetailScheduling.selected,true);
    assert.deepEqual(after.instructionPlan.steps.slice(1,3).map(s=>s.newBrickIds),[['a1','a2'],['b1','b2']]);
    assert.equal(after.instructionPlan.steps.length,before.instructionPlan.steps.length);assert.equal(after.brickModel,before.brickModel);
    assert.deepEqual(before,frozen);
    for(const field of ['assemblyPlan','instructionPlan']){
      const old=new Map(before[field].steps.map(s=>[s.id,s]));
      for(const s of after[field].steps){const {visibleBrickIds,...a}=s,{visibleBrickIds:unused,...b}=old.get(s.id);assert.deepEqual(a,b);}
    }
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0]);
    assert.equal(scheduleRepeatedDetails(after),after);
  }
});

test('does not move a near match, an unfinished detail or a deliberately planned action',()=>{
  for(const edit of [r=>{r.instructionPlan.bricks.find(b=>b.id==='b2').color='green';},
    r=>{
      r.instructionPlan.bricks.push({id:'later',x:10,y:3,z:0,w:2,d:2,color:'blue'});
      r.instructionPlan.modules[0].brickIds.push('later');
      const source={...r.assemblyPlan.steps.at(-1),id:'source-later',newBrickIds:['later'],highlightBrickIds:['later'],
        visibleBrickIds:[...r.assemblyPlan.steps.at(-1).visibleBrickIds,'later']};
      r.assemblyPlan.steps.push(source);r.instructionPlan.steps.push({...source,id:'diagram-later',sourceStepIds:[source.id],
        orderedOperations:[{id:source.id,kind:'build',newBrickIds:['later'],highlightBrickIds:['later'],issues:[]}]});
      r.guide=createGuideSections(r.instructionPlan);
    },
    r=>{r.instructionPlan.steps.at(-1).instructionAction={kind:'feature'};},
    r=>{r.instructionPlan.steps.at(-1).buildRegion={id:'accepted'};},
    r=>{r.instructionPlan.modules[0].buildContext={kind:'work-surface'};}]){
    const before=fixture();edit(before);assert.equal(scheduleRepeatedDetails(before),before);
  }
});

test('cannot cross warnings, joins, module boundaries or unavailable supports',()=>{
  for(const edit of [r=>{r.instructionPlan.steps[5].issues=[{code:'limited-support'}];},
    r=>{r.instructionPlan.steps[5].kind='join';},r=>{r.instructionPlan.steps[8].moduleId='other';},
    r=>{const p=r.instructionPlan.bricks.find(b=>b.id==='c8');Object.assign(p,{x:10,y:0,z:0});}]){
    const before=fixture();edit(before);assert.equal(scheduleRepeatedDetails(before),before);
  }
});
