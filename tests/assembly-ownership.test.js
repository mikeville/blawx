import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {integrateSmallDetails} from '../src/assembly-ownership.js';
import {assemblyRejectionReasons} from '../src/refine-construction.js';
const b=(x,y,z,w=1,d=1,color='green')=>({x,y,z,w,d,color});
function prepared(bricks){const brickModel={version:1,kind:'bricks',bricks};return prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0}});}
const fixture=()=>[b(0,0,0,2,2),...Array.from({length:5},(_,i)=>b(0,i+1,0,1,2)),b(1,1,0,1,1,'red'),b(1,2,0,1,1,'red')];
test('a small supported color detail becomes part of the parent build across rotations and palettes',()=>{
 for(const turn of [0,1,2,3]){
  const before=prepared(fixture().map(source=>{let r={...source};for(let i=0;i<turn;i++)r={...r,x:-r.z-r.d,z:r.x,w:r.d,d:r.w};return {...r,x:r.x+9,z:r.z-5,color:r.color==='red'?'blue':'yellow'};}));
  const snapshot=structuredClone(before),detail=before.assemblyPlan.modules.find(m=>m.kind==='detail');assert.ok(detail);
  const after=integrateSmallDetails(before);assert.equal(after.detailOwnership.selected,true,JSON.stringify(after.detailOwnership));
  assert.equal(after.assemblyPlan.modules.length,before.assemblyPlan.modules.length-1);
  assert.equal(after.assemblyPlan.steps.filter(s=>s.kind==='join').length,0);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.assemblyPlan.stats.temporaryHoldStepCount,0);
  assert.deepEqual(after.brickModel,before.brickModel);
  assert.deepEqual(after.assemblyPlan.inventory,before.assemblyPlan.inventory);
  assert.deepEqual(assemblyRejectionReasons(before.assemblyPlan,after.assemblyPlan),[]);
  assert.equal(after.instructionPlan.stats.coverageComplete,true);
  assert.equal(after.guide.stats.coverageComplete,true);
  assert.deepEqual(before,snapshot);
  assert.equal(integrateSmallDetails(after),after);
 }
});
test('substantial components retain independent recipes',()=>{
 const before=prepared([b(0,0,0,2,2),...Array.from({length:16},(_,i)=>b(0,i+1,0,1,2)),...Array.from({length:5},(_,i)=>b(1,i+1,0,1,1,'red'))]);
 assert.ok(before.assemblyPlan.modules.some(m=>m.kind==='detail'&&m.brickIds.length===5));
 assert.equal(integrateSmallDetails(before),before);
});
test('a work-surface recipe is never treated as a small color detail',()=>{
 const brickModel={version:1,kind:'bricks',bricks:[b(0,0,0),b(2,0,0),b(0,1,0),b(2,1,0),b(0,2,0,3,1)]};
 const base=createAssemblyPlan({brickModel});
 const plan=createAssemblyPlan({brickModel,workSurfaceBrickIds:base.bricks.filter(b=>b.y>0).map(b=>b.id)});
 const before=prepareAssemblyGuide({brickModel,assemblyPlan:plan,metrics:{conversionMs:0}});
 assert.equal(integrateSmallDetails(before),before);
});
