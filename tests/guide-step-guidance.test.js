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
  assert.doesNotMatch(guidanceMarkup(guidance),/Layout|<details|<svg role="img"/);
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

test('reader omits routine layer narration and duplicate maps but preserves assembly handling',()=>{
  const bricks=[{id:'a',x:0,y:2,z:0,w:2,d:2},{id:'b',x:0,y:3,z:0,w:2,d:2}];
  const start={id:'start',moduleId:'m',kind:'build',newBrickIds:['a'],visibleBrickIds:['a'],highlightBrickIds:['a'],tableRecipe:{ordinal:1,total:2,completionStepId:'finish'}};
  const finish={...start,id:'finish',newBrickIds:['b'],visibleBrickIds:['a','b'],highlightBrickIds:['b'],tableRecipe:{ordinal:2,total:2,completionStepId:'finish'}};
  const join={id:'join',moduleId:'m',kind:'join',joinContext:{direction:'down',supportGroups:[]}};
  const plan={bricks,modules:[{id:'m',buildContext:{kind:'work-surface',floorY:2}}],steps:[start,finish,join]};
  const numbering={byStepId:new Map([['finish',8],['join',9]])};
  const first=createStepGuidance(plan,start,numbering),last=createStepGuidance(plan,finish,numbering);
  assert.match(first.displayInstruction,/Build separately.*flat table.*step 9.*flat through step 8/);
  assert.ok(first.map);
  assert.doesNotMatch(guidanceMarkup(first),/Layout|<details/);
  assert.equal(last.displayInstruction,'');
  assert.equal(guidanceMarkup(last),'');
  assert.match(last.instruction,/Complete the top layer/,'detailed placement evidence remains available');
});

test('reader retains physical turns, individual underside placement and real warnings',()=>{
  const upside={id:'upside',kind:'build',workingOrientation:{kind:'inverted'},newBrickIds:[]};
  const under={id:'under',kind:'build',insertionDirection:'up',attachmentTask:{kind:'individual-pieces'},issues:[{code:'limited-support'}]};
  const plan={bricks:[],modules:[],steps:[upside,under]}, numbering={byStepId:new Map()};
  const first=createStepGuidance(plan,upside,numbering),next=createStepGuidance(plan,under,numbering);
  assert.match(first.displayInstruction,/upside down.*studs facing down/);
  assert.match(next.displayInstruction,/Turn the completed section upright.*Support.*one piece at a time.*studs facing up/);
  assert.match(next.warning,/Only a small part/);
});

test('compact reader retains repeat quantities and each displayed attachment reference',()=>{
  const start={id:'start',moduleId:'m',kind:'build',newBrickIds:[],nestedRecipe:{id:'child',separate:true,floorY:0}};
  const join={id:'join',moduleId:'m',kind:'join',nestedRecipe:{id:'child',separate:true},joinContext:{direction:'down',supportGroups:[]}};
  const plan={bricks:[],modules:[{id:'m',brickIds:[]}],steps:[start,join]};
  const guidance=createStepGuidance(plan,start,{byStepId:new Map([['join',12],['second',15]])},{copies:2,attachmentStepIds:['join','second']});
  assert.match(guidance.displayInstruction,/Build 2 copies.*steps 12, 15/);
});
