import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';

function fixture(turn=0,blocked=false) {
  const palette=turn%2?{black:'white',red:'blue',green:'tan',yellow:'brown',blue:'red'}:{};
  const source=[
    {x:0,y:0,z:0,w:1,d:2,color:'black'},
    {x:0,y:1,z:0,w:1,d:2,color:'black'},
    {x:0,y:2,z:0,w:2,d:1,color:'red'},
    {x:1,y:1,z:0,w:1,d:1,color:'green'},
    {x:0,y:2,z:1,w:1,d:1,color:'yellow'},
    ...(blocked?[{x:1,y:0,z:0,w:1,d:1,color:'blue'}]:[]),
  ];
  const bricks=source.map(b=>{let n={...b};for(let i=0;i<turn;i++)n={...n,x:-n.z-n.d,z:n.x,w:n.d,d:n.w};return {...n,x:n.x+10,z:n.z+10,color:palette[n.color]??n.color};});
  const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel}).bricks;
  const pick=(color,y)=>identified.find(b=>b.color===(palette[color]??color)&&b.y===y).id;
  const order=[pick('black',0),...(blocked?[pick('blue',0)]:[]),pick('black',1),pick('red',2),pick('green',1),pick('yellow',2)];
  return {order,options:{brickModel,integratedBuild:true,allowUnderAttachments:true,moduleReplay:[
    {id:'base',label:'Base',kind:'grounded',brickIds:order,brickOrder:order,actionOrder:true,placementGroups:order.map(id=>[id])},
  ]}};
}

test('an unrelated ready piece does not suppress a valid scheduled bridge and underside insertion',()=>{
  for(let turn=0;turn<4;turn++){
    const {order,options}=fixture(turn),snapshot=structuredClone(options),plan=createAssemblyPlan(options);
    assert.deepEqual(options,snapshot);assert.equal(plan.stats.unresolvedBrickCount,0);
    assert.deepEqual(plan.steps.flatMap(s=>s.newBrickIds),order);
    assert.ok(plan.steps.every(s=>!s.issues.length));
    const upper=plan.steps.findIndex(s=>s.newBrickIds.includes(order[2]));
    const under=plan.steps.findIndex(s=>s.newBrickIds.includes(order[3]));
    assert.equal(under,upper+1);assert.equal(plan.steps[under].insertionDirection,'up');
  }
});

test('a scheduled bridge cannot waive a blocked underside insertion',()=>{
  for(let turn=0;turn<4;turn++)assert.throws(()=>createAssemblyPlan(fixture(turn,true).options),/before its prerequisites/);
});

test('ordinary placements within the scheduled group retain priority over an unnecessary bridge',()=>{
  const {options,order}=fixture();
  options.moduleReplay[0].placementGroups=[[order[0]],[order[1]],[order[2],order[4]],[order[3]]];
  options.moduleReplay[0].brickOrder=[order[0],order[1],order[2],order[4],order[3]];
  const plan=createAssemblyPlan(options);
  assert.equal(plan.stats.unresolvedBrickCount,0);
  assert.deepEqual(plan.steps.flatMap(s=>s.newBrickIds),[order[0],order[1],order[4],order[2],order[3]]);
  assert.equal(plan.steps.at(-1).insertionDirection,'up');
});
