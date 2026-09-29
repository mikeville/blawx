import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {recipeBrickId} from '../src/assembly-recipes.js';

function fixture(turn=0,{hidden=false,orderPolicy}={}){
 const transform=brick=>{
  let b={...brick};for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
  return {...b,x:b.x+12,z:b.z+8,color:turn%2&&b.color==='green'?'blue':b.color};
 };
 const floor=[...Array.from({length:6},(_,i)=>({x:i,y:0,z:0,w:1,d:2,color:'green'})),
  {x:0,y:1,z:0,w:6,d:2,color:'green'}];
 const child=hidden?[
  {x:3,y:2,z:1,w:1,d:1,color:'green'},{x:1,y:3,z:1,w:6,d:1,color:'green'},
  ...[0,2,4,6].map(x=>({x,y:4,z:-2,w:2,d:8,color:'green'})),
 ]:[{x:0,y:2,z:0,w:1,d:1,color:'green'},{x:0,y:3,z:0,w:4,d:2,color:'green'}];
 const local=[...floor,...child].map(transform),ids=local.map(recipeBrickId);
 const brickModel={version:1,kind:'bricks',bricks:[transform({x:0,y:0,z:0,w:6,d:2,color:'black'}),...local.map(b=>({...b,y:b.y+1}))]};
 const identified=createAssemblyPlan({brickModel}).bricks,base=identified.filter(b=>b.y===0).map(b=>b.id),body=identified.filter(b=>b.y>0).map(b=>b.id);
 return createAssemblyPlan({brickModel,moduleReplay:[
  {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:body,brickOrder:body,buildContext:{kind:'work-surface',floorY:1}},
 ],moduleRecipes:{body:{moduleReplay:[
  {id:'floor',label:'Floor',kind:'grounded',brickIds:ids.slice(0,floor.length),brickOrder:ids.slice(0,floor.length)},
  {id:'cap',label:'Cap',kind:'detail',groupType:'work-surface',brickIds:ids.slice(floor.length),brickOrder:ids.slice(floor.length),buildContext:{kind:'work-surface',floorY:2,...(orderPolicy?{orderPolicy}:{})}},
 ]}}});
}

const childSteps=plan=>plan.steps.filter(step=>step.nestedRecipe?.id==='body/cap');

test('one complete small nested assembly preserves its advisory and separate attachment across rotations',()=>{
 for(let turn=0;turn<4;turn++){
  const source=fixture(turn),snapshot=structuredClone(source),original=childSteps(source);
  assert.equal(source.stats.unresolvedBrickCount,0);
  assert.equal(source.modules.find(m=>m.id==='body').brickIds.length,9);
  assert.equal(original.filter(s=>s.kind==='build').length,2);
  assert.equal(original.flatMap(s=>s.issues).filter(i=>i.code==='limited-support').length,1);
  const output=compactAssemblyPlan(source),steps=childSteps(output.plan);
  assert.equal(steps.length,2);assert.equal(steps[0].newBrickIds.length,2);assert.equal(steps[1].kind,'join');
  assert.deepEqual(steps[0].issues,original.flatMap(s=>s.issues));
  assert.deepEqual(steps[1].joinContext,original.at(-1).joinContext);
  assert.deepEqual(output.plan.steps.flatMap(s=>s.sourceStepIds),source.steps.map(s=>s.id));
  assert.deepEqual(output.plan.steps.flatMap(s=>s.orderedOperations).map(s=>[s.id,s.kind,s.newBrickIds,s.issues]),source.steps.map(s=>[s.id,s.kind,s.newBrickIds,s.issues]));
  assert.ok(output.report.smallAssemblyDiagrams.some(a=>a.merged));
  assert.deepEqual(source,snapshot);
 }
});

test('small assembly compaction cannot conceal a hidden piece or waive an invalid operation, scope or attachment',()=>{
 const layered=compactAssemblyPlan(fixture(0,{orderPolicy:'rectangular-layers'}));
 assert.equal(childSteps(layered.plan).filter(s=>s.kind==='build').length,2);
 assert.ok(layered.report.smallAssemblyDiagrams.some(a=>a.reasons.includes('rectangular-layer-boundary')));
 const hidden=fixture(0,{hidden:true}),hiddenOutput=compactAssemblyPlan(hidden);
 assert.ok(childSteps(hiddenOutput.plan).filter(s=>s.kind==='build').length>1);
 assert.ok(hiddenOutput.report.smallAssemblyDiagrams.some(a=>a.reasons.includes('visibility')));
 for(const mutate of [
  steps=>steps[1].issues.push({code:'temporary-hold',severity:'warning',brickIds:steps[1].newBrickIds}),
  steps=>steps[1].issues.push({code:'unsupported-addition',severity:'error',brickIds:steps[1].newBrickIds}),
  steps=>{steps[1].insertionDirection='up';},
  steps=>{steps[1].nestedRecipe={...steps[1].nestedRecipe,id:'other'};},
  steps=>{steps.at(-1).issues.push({code:'blocked-module-insertion',severity:'error',brickIds:steps.at(-1).highlightBrickIds});},
  steps=>{steps.at(-1).nestedRecipe.firstStepId='missing';},
  steps=>{steps.at(-1).highlightBrickIds.pop();},
 ]){
  const source=fixture();mutate(childSteps(source));
  const result=compactAssemblyPlan(source);
  assert.ok(!result.report.smallAssemblyDiagrams?.some(a=>a.merged));
  assert.deepEqual(result.plan.steps.flatMap(s=>s.sourceStepIds),source.steps.map(s=>s.id));
 }
});
