import test from 'node:test';
import assert from 'node:assert/strict';
import {createStepGuidance,guidanceMarkup} from '../src/guide-step-guidance.js';

test('component tasks use displayed completion numbers and describe bottom-up additions',()=>{
  const bricks=[{id:'lower',x:0,y:1,z:0,w:2,d:2},{id:'upper',x:0,y:2,z:0,w:2,d:2}];
  const step={id:'start',kind:'build',newBrickIds:['lower','upper'],highlightBrickIds:['lower','upper'],visibleBrickIds:['lower','upper'],
    componentTask:{id:'feature',index:1,total:2,lastStepId:'finish'}};
  const plan={bricks,modules:[],steps:[step]};
  assert.match(createStepGuidance(plan,step,{byStepId:new Map([['finish',17]])}).instruction,/through step 17 before moving/);
  const last={...step,componentTask:{...step.componentTask,index:2}};
  assert.match(createStepGuidance(plan,last,{byStepId:new Map()}).instruction,/lower pieces first.*upwards/);
});

test('foundation map retains gaps, sizes and the displayed attachment number',()=>{
  const bricks=[{id:'a',x:2,y:3,z:4,w:2,d:4},{id:'b',x:6,y:3,z:4,w:1,d:2}];
  const step={id:'foundation',moduleId:'platform',kind:'build',visibleBrickIds:['a','b'],newBrickIds:['a','b'],highlightBrickIds:['a','b']};
  const join={id:'join',moduleId:'platform',kind:'join',joinContext:{direction:'down',supportGroups:[]}};
  const plan={bricks,modules:[{id:'platform',buildContext:{kind:'work-surface',floorY:3}}],steps:[step,join]};
  const before=structuredClone(plan);
  const guidance=createStepGuidance(plan,step,{byStepId:new Map([['join',12]])});
  assert.match(guidance.instruction,/flat table.*step 12/);
  assert.equal(guidance.map.width,5);assert.equal(guidance.map.depth,4);
  assert.deepEqual(guidance.map.bricks.map(b=>[b.x,b.z,b.w,b.d]),[[0,0,2,4],[4,0,1,2]]);
  assert.match(guidanceMarkup(guidance),/One grid square is one stud/);
  assert.deepEqual(plan,before);
});

test('warnings distinguish unsupported, obstructed and temporary placements without claiming a repair',()=>{
  const plan={bricks:[],modules:[],steps:[]};
  for(const [code,expected] of [['unsupported-addition',/no verified support/],['blocked-insertion',/block this placement/],['temporary-hold',/stability has not been verified/]]){
    const guidance=createStepGuidance(plan,{issues:[{code}]},{byStepId:new Map()});
    assert.match(guidance.warning,expected);
  }
  const unknown=createStepGuidance(plan,{issues:[{code:'future-code',message:'Specific condition.'}]},{byStepId:new Map()});
  assert.equal(unknown.warning,'Specific condition.');
  assert.equal(guidanceMarkup(unknown),'');
});

test('matching additions at opposite ends are described as new placements, not another view',()=>{
  const bricks=[{id:'a',x:0,y:2,z:0,w:4,d:1,color:'black'},{id:'b',x:0,y:2,z:12,w:4,d:1,color:'black'}];
  const steps=bricks.map(b=>({id:b.id,moduleId:'body',kind:'build',newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[b.id],issues:[]}));
  const plan={bricks,steps,modules:[{id:'body',brickIds:['a','b']}]};
  assert.match(createStepGuidance(plan,steps[1],{byStepId:new Map()}).instruction,/matching pieces at the opposite end/);
  assert.equal(steps.length,2,'both distinct placements retain their steps');
  bricks[1].color='red';
  assert.equal(createStepGuidance(plan,steps[1],{byStepId:new Map()}).instruction,'','a different recipe is not called matching');
});

test('upward attachments describe their actual direction and do not claim support below',()=>{
  const step={id:'under',kind:'build',insertionDirection:'up',issues:[{code:'limited-support'}]};
  const guidance=createStepGuidance({bricks:[],modules:[],steps:[step]},step,{byStepId:new Map()});
  assert.match(guidance.instruction,/from underneath.*studs facing up/);
  assert.doesNotMatch(guidance.warning,/studs below/);
});
