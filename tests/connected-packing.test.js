import test from 'node:test';import assert from 'node:assert/strict';
import {proposeConnectedPacking} from '../src/connected-packing.js';
import {packingProfile,packingRejectionReasons} from '../src/refine-construction.js';
const brick=(x,y,z,w,d,color='blue')=>({x,y,z,w,d,color});
const model=bricks=>({version:1,kind:'bricks',bricks});

test('chooses an exact seam that bonds a detached strip across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++){
    const bricks=[brick(0,0,0,1,2,'lightGray'),brick(0,1,0,1,2),brick(1,1,0,1,2)].map(b=>{
      for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
      return {...b,x:b.x+12,z:b.z-4,color:b.color==='blue'?'red':'tan'};
    });
    const source=model(bricks),snapshot=structuredClone(source),result=proposeConnectedPacking(source);
    assert.ok(result.proposals.length);assert.ok(result.checks<=96);assert.deepEqual(source,snapshot);
    for(const p of result.proposals){
      assert.equal(p.connectedCellCount,2);assert.equal(p.afterUngroundedCells,0);
      assert.deepEqual(packingRejectionReasons(packingProfile(bricks),packingProfile(p.bricks)),[]);
    }
  }
});

test('a gap or a color boundary cannot be treated as a bond',()=>{
  const base=[brick(0,0,0,1,2,'lightGray'),brick(0,1,0,1,2)];
  assert.deepEqual(proposeConnectedPacking(model([...base,brick(2,1,0,1,2)])).proposals,[]);
  assert.deepEqual(proposeConnectedPacking(model([...base,brick(1,1,0,1,2,'red')])).proposals,[]);
});

test('search bounds and already-grounded construction produce no speculative changes',()=>{
  const source=model([brick(0,0,0,1,2),brick(0,1,0,1,2),brick(1,1,0,1,2)]);
  assert.equal(proposeConnectedPacking(source,{maxChecks:0}).checks,0);
  assert.deepEqual(proposeConnectedPacking(source,{maxCandidates:0}).proposals,[]);
  assert.throws(()=>proposeConnectedPacking(source,{maxChecks:-1}),/limits/);
  assert.deepEqual(proposeConnectedPacking(model([brick(0,0,0,2,2),brick(0,1,0,2,2)])).proposals,[]);
});

import {planConnectedAssemblies} from '../src/connected-assemblies.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {planComponentPacking} from '../src/component-packing.js';
test('a connecting seam carries its dependent pieces into the receiving assembly and validates the complete plan',()=>{
  const brickModel=model([brick(0,0,0,1,2,'lightGray'),brick(0,1,0,1,2),brick(1,1,0,1,2),brick(1,2,0,1,2)]);
  const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0}}),snapshot=structuredClone(before);
  assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
  const after=planConnectedAssemblies(before);
  assert.equal(after.connectedAssemblyPlanning.selected,true,JSON.stringify(after.connectedAssemblyPlanning));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.guide.stats.coverageComplete,true);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(packingRejectionReasons(packingProfile(before.brickModel.bricks),packingProfile(after.brickModel.bricks)),[]);
  assert.deepEqual(before,snapshot);
  assert.equal(planConnectedAssemblies(after),after);
});

function platformFixture(turn=0){
  return model([
    ...[0,1].flatMap(y=>[brick(0,y,0,2,2,'darkGray'),brick(6,y,0,2,2,'darkGray')]),
    ...[2,3].flatMap(y=>[0,2,4,6].map(x=>brick(x,y,0,2,4))),
    brick(0,4,0,4,2),brick(4,4,0,4,2),brick(2,5,0,4,2),
  ].map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+12,z:b.z+12,color:b.color==='blue'?'red':'tan'};
  }));
}

test('a globally connected model still needs a bonded platform recipe across rotations',()=>{
  for(let turn=0;turn<4;turn++){
    const brickModel=platformFixture(turn);
    const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,integratedBuild:true}),metrics:{conversionMs:0}});
    const snapshot=structuredClone(before);
    assert.equal(before.assemblyPlan.graph.components.length,1);
    assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
    const after=planComponentPacking(before);
    assert.equal(after.componentPacking.selected,true,JSON.stringify(after.componentPacking));
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.deepEqual(packingRejectionReasons(packingProfile(brickModel.bricks),packingProfile(after.brickModel.bricks)),[]);
    const offline=after.assemblyPlan.modules.filter(m=>m.buildContext);
    assert.equal(offline.length,1);
    const recipe=after.assemblyPlan.steps.filter(s=>s.moduleId===offline[0].id);
    assert.ok(recipe.some(s=>s.kind==='join'));
    assert.ok(recipe.every(s=>s.issues.every(i=>i.severity!=='error')));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.equal(after.guide.stats.coverageComplete,true);
    assert.deepEqual(before,snapshot);
    assert.equal(planComponentPacking(after),after);
  }
});

test('regional bonds preserve external connections and cannot borrow bricks outside the selected region',()=>{
  const source=platformFixture();
  const region=source.bricks.filter(b=>b.y===2||b.y===3);
  const proposed=proposeConnectedPacking(source,{region});
  assert.ok(proposed.proposals.length);
  for(const candidate of proposed.proposals){
    assert.ok(candidate.before.every(b=>region.includes(b)));
    assert.deepEqual(packingRejectionReasons(packingProfile(source.bricks),packingProfile(candidate.bricks)),[]);
  }
  assert.throws(()=>proposeConnectedPacking(source,{region:[brick(100,2,100,2,2)]}),/existing whole bricks/);
  assert.deepEqual(proposeConnectedPacking(source,{region:[region[0]]}).proposals,[]);
});

test('connecting a platform is insufficient when the completed component has nowhere to attach',()=>{
  const brickModel=platformFixture();
  brickModel.bricks=brickModel.bricks.filter(b=>b.y>=2);
  const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,integratedBuild:true}),metrics:{conversionMs:0}});
  const after=planComponentPacking(before);
  assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
  assert.notEqual(after.componentPacking?.selected,true);
  assert.equal(after.assemblyPlan,before.assemblyPlan);
  assert.equal(after.brickModel,before.brickModel);
});

test('a diverse shortlist reaches separate interfaces while protected recipes keep their exact bricks',()=>{
  const site=(x,color)=>[brick(x,0,0,1,2,'tan'),brick(x,1,0,1,2,color),brick(x+1,1,0,1,2,color)];
  const first=site(0,'red'),second=site(12,'blue'),source=model([...first,...second]),snapshot=structuredClone(source);
  const diverse=proposeConnectedPacking(source,{maxChecks:24,maxCandidates:2,diverseInterfaces:true});
  assert.equal(new Set(diverse.proposals.map(p=>p.interface)).size,2);
  assert.ok(diverse.checks<=24);
  const protectedResult=proposeConnectedPacking(source,{protectedBricks:first});
  assert.ok(protectedResult.proposals.length);
  for(const proposal of protectedResult.proposals){
    assert.ok(proposal.before.every(b=>b.x>=12));
    assert.deepEqual(proposal.bricks.filter(b=>b.x<12),first);
    assert.deepEqual(packingRejectionReasons(packingProfile(source.bricks),packingProfile(proposal.bricks)),[]);
  }
  assert.deepEqual(source,snapshot);
});

test('a connecting seam and its separate-build recipe are accepted together',()=>{
  const brickModel=model([brick(0,0,0,1,1,'tan'),brick(0,1,0,1,1,'tan'),
    brick(0,2,0,2,1,'tan'),brick(0,3,0,2,1,'tan'),
    brick(1,4,0,1,1,'tan'),brick(1,5,0,1,1,'red'),
    brick(2,4,0,1,1,'white'),brick(2,5,0,1,1,'red')]);
  const identified=createAssemblyPlan({brickModel,integratedBuild:true});
  const ids=predicate=>identified.bricks.filter(predicate).map(b=>b.id);
  const replay=[{id:'base',label:'Base',kind:'grounded',brickIds:ids(b=>b.y<2)},
    {id:'platform',label:'Platform',kind:'detail',groupType:'work-surface',brickIds:ids(b=>b.y===2||b.y===3),buildContext:{kind:'work-surface',floorY:2,orderPolicy:'course-first'}},
    {id:'body',label:'Body',kind:'grounded',groupType:'continuation',brickIds:ids(b=>b.y>=4&&b.x===1)},
    {id:'detached',label:'Detached',kind:'floating',brickIds:ids(b=>b.x===2)}].map(m=>({...m,brickOrder:m.brickIds}));
  const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,moduleReplay:replay,integratedBuild:true}),metrics:{conversionMs:0}},{moduleReplay:replay});
  const snapshot=structuredClone(before),after=planConnectedAssemblies(before);
  assert.equal(after.connectedAssemblyPlanning.selected,true,JSON.stringify(after.connectedAssemblyPlanning));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.ok(after.assemblyPlan.modules.filter(m=>m.buildContext).length>=2);
  assert.ok(after.assemblyPlan.steps.filter(s=>s.kind==='join').every(s=>!s.issues.length));
  assert.deepEqual(after.assemblyPlan.modules.find(m=>m.id==='platform').brickIds,before.assemblyPlan.modules.find(m=>m.id==='platform').brickIds);
  assert.deepEqual(packingRejectionReasons(packingProfile(brickModel.bricks),packingProfile(after.brickModel.bricks)),[]);
  assert.deepEqual(before,snapshot);
});
