import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {planNestedAssemblies} from '../src/nested-assemblies.js';
import {refineCaptureRecipes,recipeReplay,restrictRecipe} from '../src/capture-recipes.js';
import {completeAssemblyRecipes} from '../src/complete-assembly-recipes.js';
import {unresolvedCells} from '../src/refine-construction.js';

function result(bricks) {
  const brickModel={version:1,kind:'bricks',bricks};
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true});
  const compacted=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan),
    metrics:{conversionMs:0,stageTiming:{}}};
}
function transform(bricks,turn) {
  return bricks.map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+20,z:b.z+15,color:turn?(b.color==='black'?'blue':'yellow'):b.color};
  });
}
const corner=[{x:0,y:0,z:0,w:4,d:2,color:'black'},
  {x:0,y:1,z:0,w:4,d:2,color:'green'},{x:2,y:2,z:0,w:2,d:2,color:'green'},
  {x:4,y:2,z:0,w:1,d:2,color:'green'},{x:2,y:3,z:0,w:3,d:2,color:'green'}];
const shelf=[{x:0,y:0,z:0,w:2,d:2,color:'black'},
  ...Array.from({length:6},(_,i)=>({x:0,y:1,z:2*i,w:2,d:2,color:'green'})),
  ...Array.from({length:5},(_,i)=>({x:0,y:2,z:1+2*i,w:2,d:2,color:'green'})),
  ...Array.from({length:3},(_,i)=>({x:0,y:3,z:4*i,w:2,d:4,color:'green'}))];

function coverage(before,after) {
  assert.deepEqual(after.brickModel,before.brickModel);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  const old=unresolvedCells(before.assemblyPlan);
  assert.ok([...unresolvedCells(after.assemblyPlan)].every(cell=>old.has(cell)));
}

test('discovers a small capture from contact and support failures across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++) {
    const before=result(transform(corner,turn)),snapshot=structuredClone(before),after=planNestedAssemblies(before);
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,2);
    assert.equal(after.nestedAssemblyPlanning.kind,'flat-captures');
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.assemblyPlan.steps.filter(s=>s.kind==='join').length,1);
    coverage(before,after);assert.deepEqual(before,snapshot);
  }
});

test('automatically builds a complete upper assembly and proves its actual attachment',()=>{
  for(let turn=0;turn<4;turn++) {
    const before=result(transform(shelf,turn)),after=planNestedAssemblies(before);
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,13);
    assert.equal(after.nestedAssemblyPlanning.kind,'nested-component');
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    const parent=after.nestedAssemblyPlanning.moduleId;
    const join=after.assemblyPlan.steps.find(s=>s.moduleId===parent&&s.kind==='join'&&!s.nestedRecipe);
    assert.ok(join);assert.ok(join.joinContext.supportGroups.length);
    assert.ok(after.assemblyPlan.steps.filter(s=>s.nestedRecipe).every(s=>s.kind==='build'&&!s.issues.length));
    coverage(before,after);assert.equal(planNestedAssemblies(after),after);
  }
});

test('capture discovery respects its bounded search and leaves an already valid model alone',()=>{
  const before=result(corner),zero=refineCaptureRecipes(before.brickModel,before.assemblyPlan,{maxChecks:0});
  assert.equal(zero.plan,before.assemblyPlan);assert.deepEqual(zero.attempts,[]);
  const one=refineCaptureRecipes(before.brickModel,before.assemblyPlan,{maxChecks:1});assert.equal(one.attempts.length,1);
  const valid=result(corner.slice(0,3));assert.equal(planNestedAssemblies(valid),valid);
});

test('recipe replay retains explicit groups and working context without leaking removed pieces',()=>{
  const before=result(corner),module=before.assemblyPlan.modules[0];module.actionOrder=true;
  module.buildContext={kind:'work-surface',floorY:0,orderPolicy:'connected-patches'};
  const replay=recipeReplay(before.assemblyPlan)[0];
  assert.equal(replay.buildContext.orderPolicy,'connected-patches');assert.equal(replay.actionOrder,true);
  const kept=replay.brickIds.slice(1),subset=restrictRecipe(replay,kept);
  assert.deepEqual(subset.placementGroups.flat().sort(),[...kept].sort());
  assert.deepEqual(subset.brickOrder.sort(),[...kept].sort());assert.equal(replay.brickIds.length,corner.length);
});

test('complete recipe evaluation preserves coverage and attachment across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++){
    const before=result(transform(shelf,turn)),snapshot=structuredClone(before),after=completeAssemblyRecipes(before);
    assert.ok(after.completeRecipePlanning?.selected,JSON.stringify(after.completeRecipePlanning));
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.ok(after.assemblyPlan.steps.some(s=>s.kind==='join'&&!s.issues.length));
    coverage(before,after);assert.deepEqual(before,snapshot);
    assert.equal(completeAssemblyRecipes(after),after);
  }
});

test('placement preservation is explicit and never freezes a failed module',()=>{
  const valid=result(corner.slice(0,3));
  assert.equal(recipeReplay(valid.assemblyPlan)[0].actionOrder,undefined);
  const replay=recipeReplay(valid.assemblyPlan,{preservePlacements:true})[0];
  assert.equal(replay.actionOrder,true);
  assert.deepEqual(replay.placementGroups,valid.assemblyPlan.steps.filter(s=>s.newBrickIds.length).map(s=>s.newBrickIds));
  const failed=result(corner);
  assert.equal(recipeReplay(failed.assemblyPlan,{preservePlacements:true})[0].actionOrder,undefined);
});
