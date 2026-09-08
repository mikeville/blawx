import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyPlan } from '../src/assembly.js';
import { inspectConstruction } from '../src/construction.js';
import { packingProfile, packingRejectionReasons, assemblyRejectionReasons, refineConstruction } from '../src/refine-construction.js';

const brick=(x,y,z,w=1,d=1,color='orange')=>({x,y,z,w,d,color});
const model=bricks=>({version:1,kind:'bricks',bricks});

test('exact retiling must preserve each existing stud-connected component',()=>{
  const before=[brick(0,0,0,1,2),brick(1,0,0,1,2),brick(0,1,0,2,1)];
  const after=[...before.slice(0,2),brick(0,1,0),brick(1,1,0)];
  assert.deepEqual(packingRejectionReasons(packingProfile(before),packingProfile(after)),['An existing stud component was split']);
});

test('joining two coplanar bricks can remove unsupported volume without losing occupied cells or contacts',()=>{
  const before=[brick(0,0,0),brick(0,1,0,2,2),brick(0,1,2,2,2)];
  const after=[before[0],brick(0,1,0,2,4)];
  const first=packingProfile(before),next=packingProfile(after);
  assert.equal(first.unsupportedCellCount,4);
  assert.equal(next.unsupportedCellCount,0);
  assert.deepEqual(packingRejectionReasons(first,next),[]);
  assert.equal(first.cells.size,next.cells.size);
});

test('cell-based assembly guard rejects loss of resolved volume despite fewer unresolved bricks',()=>{
  const original=createAssemblyPlan({brickModel:model([brick(0,0,0,2,4),brick(4,0,0)])});
  const candidate=structuredClone(original);
  candidate.steps[0].kind='unresolved';
  assert.ok(assemblyRejectionReasons(original,candidate).includes('Previously resolved occupied cells became unresolved'));
});

test('integrated refinement joins a hanging pair before choosing a downward assembly sequence',()=>{
  const brickModel=model([brick(0,0,0),brick(0,1,0,2,2),brick(0,1,2,2,2),brick(0,2,0,2,4)]);
  const result={brickModel,diagnostics:inspectConstruction(brickModel),assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0,stageTiming:{}},adjustments:[]};
  const saved=JSON.stringify(result);
  const refined=refineConstruction(result);
  assert.ok(refined.brickModel.bricks.some(b=>b.y===1&&b.w===2&&b.d===4));
  assert.ok(refined.brickModel.bricks.length<result.brickModel.bricks.length);
  assert.equal(refined.assemblyPlan.stats.rootFailureCount,0);
  assert.equal(refined.assemblyPlan.steps.some(step=>step.insertionDirection==='up'),false);
  assert.equal(JSON.stringify(result),saved);
  assert.deepEqual(packingRejectionReasons(packingProfile(result.brickModel.bricks),packingProfile(refined.brickModel.bricks)),[]);
});

test('supported retiling generalizes across colors, translations and all upright rotations',()=>{
  const source=[brick(0,0,0),brick(0,1,0,2,2),brick(0,1,2,2,2),brick(0,2,0,2,4)];
  for(const color of ['blue','white','black']) for(let turns=0;turns<4;turns++) for(const [dx,dz] of [[0,0],[17,-11],[-23,31]]) {
    const bricks=source.map(original=>{
      let b={...original,color};
      for(let turn=0;turn<turns;turn++) b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
      return {...b,x:b.x+dx,z:b.z+dz};
    });
    const brickModel=model(bricks);
    const result={brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0,stageTiming:{}}};
    const before=JSON.stringify(result);
    const refined=refineConstruction(result);
    assert.equal(refined.brickModel.bricks.length,3,`${color}, rotation ${turns}, offset ${dx},${dz}`);
    assert.equal(refined.assemblyPlan.stats.rootFailureCount,0);
    assert.equal(refined.assemblyPlan.stats.coverageComplete,true);
    assert.deepEqual(packingRejectionReasons(packingProfile(bricks),packingProfile(refined.brickModel.bricks)),[]);
    assert.equal(JSON.stringify(result),before);
  }
});
