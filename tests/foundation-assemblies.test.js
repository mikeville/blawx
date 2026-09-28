import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {planFoundationAssemblies} from '../src/foundation-assemblies.js';
import {inspectConstruction} from '../src/construction.js';
import {assemblyRejectionReasons,packingProfile} from '../src/refine-construction.js';
import {assessAssemblyQuality,orderQualityRejections} from '../src/assembly-quality.js';

const brick=(x,y,z,w=1,d=1,color='black')=>({x,y,z,w,d,color});
function fixture(turns=0) {
  const bricks=[];
  // Two incompletely supported pedestals under a separately buildable span.
  // Choosing only one support repair cannot unlock the span's four upper pieces.
  for(const x of [0,6]) bricks.push(brick(x,0,0),brick(x,1,0),brick(x+1,1,0,1,1,'red'),brick(x,2,0,2,1));
  for(const x of [0,2,4,6])bricks.push(brick(x,3,0,2,1,'green'));
  bricks.push(brick(0,4,0,4,1,'green'),brick(4,4,0,4,1,'green'),brick(2,5,0,4,1,'green'));
  const transformed=bricks.map(source=>{let b={...source};for(let n=0;n<turns;n++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+13,z:b.z-9,color:{black:'blue',red:'yellow',green:'white'}[b.color]};});
  const brickModel={version:1,kind:'bricks',bricks:transformed};
  return prepareAssemblyGuide({brickModel,diagnostics:inspectConstruction(brickModel),assemblyPlan:createAssemblyPlan({brickModel}),
    metrics:{mappedCellCount:400,conversionMs:0,structuralAddedMappedCellCount:0}});
}

test('joint support repairs unlock a complete span recipe across rotations and preserve every source cell',()=>{
  for(const turns of [0,1,2,3]) {
    const before=fixture(turns),snapshot=structuredClone(before);
    const after=planFoundationAssemblies(before,{adjustments:true});
    assert.equal(after.foundationAssemblyPlanning.selected,true,JSON.stringify(after.foundationAssemblyPlanning));
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.assemblyPlan.stats.rootFailureCount,0);
    assert.equal(after.foundationAssemblyPlanning.repair.addedCellCount,2);
    assert.equal(after.foundationAssemblyPlanning.repair.extension.accepted.length,2);
    assert.equal(after.foundationAssemblyPlanning.repeatedRecipes.length,1);
    assert.equal(after.brickModel.bricks.length,before.brickModel.bricks.length);
    const original=packingProfile(before.brickModel.bricks),candidate=packingProfile(after.brickModel.bricks);
    for(const [key,cell] of original.cells)assert.equal(candidate.cells.get(key)?.color,cell.color);
    assert.equal(candidate.cells.size,original.cells.size+2);
    assert.deepEqual(assemblyRejectionReasons(before.assemblyPlan,after.assemblyPlan),[]);
    assert.deepEqual(orderQualityRejections(assessAssemblyQuality(before.assemblyPlan),assessAssemblyQuality(after.assemblyPlan)),[]);
    assert.equal(after.instructionPlan.stats.coverageComplete,true);
    assert.equal(after.guide.stats.coverageComplete,true);
    const band=after.assemblyPlan.modules.find(m=>m.buildContext);
    assert.equal(after.assemblyPlan.modules.filter(m=>m.kind==='grounded').length,2);
    const join=after.assemblyPlan.steps.find(s=>s.moduleId===band.id&&s.kind==='join');
    assert.equal(join.joinContext.supportGroups.length,2);
    assert.deepEqual(before,snapshot);
    assert.equal(planFoundationAssemblies(after,{adjustments:true}),after,'an accepted recipe is protected');
  }
});

test('support extensions stay disabled without adjustments and respect the shared geometry budget',()=>{
  const before=fixture();
  assert.equal(planFoundationAssemblies(before),before);
  const exhausted={...before,metrics:{...before.metrics,structuralAddedMappedCellCount:24}};
  assert.equal(planFoundationAssemblies(exhausted,{adjustments:true}),exhausted);
});
