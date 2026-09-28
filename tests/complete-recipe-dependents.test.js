import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {completeRecipeDependents,discoverRecipeDependents} from '../src/complete-recipe-dependents.js';

function fixture(turn=0,hanging=2){
 const base=[0,1,2].map(y=>({x:0,y,z:0,w:2,d:2,color:'black'}));
 const dependents=Array.from({length:hanging},(_,i)=>({x:2,y:3-hanging+i,z:0,w:2,d:2,color:'blue'}));
 const receiver=[3,4].map(y=>({x:0,y,z:0,w:4,d:2,color:'green'}));
 const move=bs=>bs.map(b=>({...rotateRecipeBrick(b,turn),color:turn%2?({black:'tan',blue:'red',green:'yellow'}[b.color]):b.color}));
 const a=move([...base,...dependents]),b=move(receiver),brickModel={version:1,kind:'bricks',bricks:[...a,...b]},moduleReplay=[
  {id:'foundation',label:'Foundation',kind:'grounded',brickIds:a.map(recipeBrickId),brickOrder:a.map(recipeBrickId)},
  {id:'receiver',label:'Body',kind:'detail',groupType:'work-surface',brickIds:b.map(recipeBrickId),brickOrder:b.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:3}}];
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false});
 const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,hanging);
 return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('a proven receiver gains complete hanging dependents without losing its existing tasks',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),proposals=discoverRecipeDependents(before.assemblyPlan),after=completeRecipeDependents(before);
  assert.equal(proposals.length,1);assert.deepEqual(proposals[0].groups.map(g=>g.length),[2]);
  assert.ok(after.dependentRecipeCompletion?.selected,JSON.stringify(after.dependentRecipeCompletion));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  const joins=after.assemblyPlan.steps.filter(s=>s.kind==='join');assert.equal(joins.length,2);assert.equal(joins[0].joinContext.direction,'up');assert.equal(joins[1].joinContext.direction,'down');
  const start=after.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='receiver/core'&&s.kind==='build');
  const guidance=createStepGuidance(after.instructionPlan,start,{byStepId:new Map()});
  assert.ok(guidance.map);assert.match(guidance.instruction,/Place the lower pieces first/);
  assert.equal(completeRecipeDependents(after),after);
 }
});

test('singleton dependents keep their inventory with their placement and use singular guidance',()=>{
 const after=completeRecipeDependents(fixture(0,1));assert.ok(after.dependentRecipeCompletion?.selected);
 const steps=after.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='receiver/hanging-component-1');
 assert.equal(steps.length,1);assert.equal(steps[0].kind,'join');assert.equal(steps[0].newBrickIds.length,1);assert.equal(steps[0].sourceStepIds.length,2);
 const text=createStepGuidance(after.instructionPlan,steps[0],{byStepId:new Map()}).instruction;
 assert.match(text,/this piece underneath/);assert.doesNotMatch(text,/completed assembly/);
});

test('existing repetitions and absent failures do not become expansion candidates',()=>{
 const before=fixture(),p=structuredClone(before.assemblyPlan);p.modules[1].recipeFamily='protected';
 assert.deepEqual(discoverRecipeDependents(p),[]);assert.deepEqual(discoverRecipeDependents(before.assemblyPlan,{maxCandidates:0}),[]);
 const noFailures=structuredClone(before.assemblyPlan);noFailures.stats.unresolvedBrickCount=0;assert.deepEqual(discoverRecipeDependents(noFailures),[]);
 assert.deepEqual(discoverRecipeDependents(null),[]);
});

test('an irregular hanging component can retain its own complete child recipe',()=>{
 const shape=[{x:0,y:0,z:0,w:1,d:3},{x:1,y:0,z:2,w:1,d:1},{x:0,y:1,z:0,w:1,d:2},
  {x:0,y:1,z:2,w:1,d:3},{x:1,y:1,z:2,w:1,d:4},{x:2,y:1,z:3,w:1,d:3},{x:0,y:2,z:3,w:3,d:2}];
 for(let turn=0;turn<4;turn++){
  const move=bs=>bs.map(b=>rotateRecipeBrick(b,turn));
  const base=move([0,1,2,3].map(y=>({x:3,y,z:3,w:1,d:2,color:'black'}))),hanging=move(shape.map(b=>({...b,y:b.y+1,color:turn%2?'red':'blue'}))),core=move([4,5].map(y=>({x:0,y,z:3,w:4,d:2,color:'green'})));
  const ordinary=[...base,...hanging],brickModel={version:1,kind:'bricks',bricks:[...ordinary,...core]},moduleReplay=[
   {id:'base',label:'Base',kind:'grounded',brickIds:ordinary.map(recipeBrickId),brickOrder:ordinary.map(recipeBrickId)},
   {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:core.map(recipeBrickId),brickOrder:core.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:4}}];
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,allowUnderAttachments:false}),instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,7);
  const after=completeRecipeDependents({brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}});
  assert.ok(after.dependentRecipeCompletion?.selected,JSON.stringify(after.dependentRecipeCompletion));assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.ok(after.assemblyPlan.moduleRecipes.body.moduleRecipes['hanging-component-1']);
  assert.ok(after.assemblyPlan.steps.some(s=>s.nestedRecipe?.id.startsWith('body/hanging-component-1/')));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 }
});
