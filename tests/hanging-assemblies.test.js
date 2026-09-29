import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {planHangingAssemblies} from '../src/hanging-assemblies.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';

function fixture(turn=0) {
  const b=(x,y,w=1,color='lightGray')=>({x,y,z:0,w,d:1,color});
  const bricks=[b(0,0),b(0,1),b(0,2,2),b(2,2),b(1,3,2,'red')].map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+8,z:b.z+8,color:turn?(b.color==='red'?'blue':'tan'):b.color};
  });
  const brickModel={version:1,kind:'bricks',bricks};
  return prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,integratedBuild:true}),metrics:{conversionMs:0}});
}

test('overhangs become complete table-built sections with a valid receiving connection',()=>{
  for(let turn=0;turn<4;turn++) {
    const before=fixture(turn),snapshot=structuredClone(before),after=planHangingAssemblies(before);
    assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
    assert.equal(after.hangingAssemblyPlanning.selected,true);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.assemblyPlan.stats.upwardInsertionBrickCount,0);
    assert.equal(after.brickModel,before.brickModel);
    const module=after.assemblyPlan.modules.find(m=>m.buildContext);
    const steps=after.assemblyPlan.steps.filter(s=>s.moduleId===module.id);
    const join=steps.at(-1);
    assert.equal(join.kind,'join');assert.equal(join.issues.length,0);
    assert.equal(join.joinContext.direction,'down');
    assert.ok(join.joinContext.supportGroups.some(g=>g.contacts.length));
    const added=after.assemblyPlan.steps.flatMap(s=>s.newBrickIds);
    assert.equal(added.length,5);assert.equal(new Set(added).size,5);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(before,snapshot);
  }
});

test('a complete small assembly may span action boundaries but its attachment remains separate',()=>{
  const result=planHangingAssemblies(fixture()),plan=structuredClone(result.assemblyPlan);
  const module=plan.modules.find(m=>m.buildContext);
  const builds=plan.steps.filter(s=>s.moduleId===module.id&&s.kind==='build');
  builds.forEach((s,i)=>{s.instructionAction={id:`action-${i}`};s.placementGroupId=`group-${i}`;});
  const {plan:diagrams}=compactAssemblyPlan(plan);
  const recipe=diagrams.steps.filter(s=>s.moduleId===module.id);
  assert.equal(recipe.length,2);
  assert.equal(recipe[0].newBrickIds.length,3);
  assert.equal(recipe[0].orderedOperations.length,builds.length);
  assert.equal(recipe[1].kind,'join');
  assert.deepEqual(recipe[0].sourceStepIds,builds.map(s=>s.id));
  builds[0].issues.push({code:'unsupported-addition',severity:'error',brickIds:builds[0].newBrickIds,message:'Unsupported'});
  const rejected=compactAssemblyPlan(plan).plan.steps.filter(s=>s.moduleId===module.id);
  assert.ok(rejected.length>2);
});

test('detached geometry and already valid constructions do not acquire speculative assemblies',()=>{
  const valid=fixture();valid.assemblyPlan.stats.rootFailureCount=0;
  assert.equal(planHangingAssemblies(valid),valid);
  const brickModel={version:1,kind:'bricks',bricks:[{x:0,y:0,z:0,w:1,d:1,color:'tan'},{x:5,y:2,z:0,w:1,d:1,color:'red'}]};
  const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0}});
  const after=planHangingAssemblies(before);
  assert.equal(after.assemblyPlan,before.assemblyPlan);
});
