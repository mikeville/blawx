import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {recipeBrickId} from '../src/assembly-recipes.js';
import {recipeReplay} from '../src/capture-recipes.js';
import {replayNestedRecipes} from '../src/replay-nested-recipes.js';

function fixture(turn=0) {
  const transform=b=>{for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};return {...b,color:turn%2?'blue':b.color};};
  const local=[{x:0,y:0,z:0,w:2,d:1,color:'red'},{x:2,y:0,z:0,w:2,d:1,color:'red'},
    {x:0,y:1,z:0,w:4,d:1,color:'red'},{x:0,y:2,z:0,w:1,d:1,color:'red'}].map(transform);
  const identified=createAssemblyPlan({brickModel:{kind:'bricks',version:1,bricks:local}}).bricks;
  const ids=local.map(recipeBrickId);
  const brickModel={kind:'bricks',version:1,bricks:[transform({x:0,y:0,z:0,w:4,d:1,color:'black'}),...local.map(b=>({...b,y:b.y+1}))]};
  const global=createAssemblyPlan({brickModel}).bricks;
  const parent=global.filter(b=>b.y>0).map(b=>b.id),base=global.filter(b=>b.y===0).map(b=>b.id);
  assert.deepEqual(new Set(ids),new Set(identified.map(b=>b.id)));
  return {brickModel,moduleReplay:[{id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
    {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:parent,brickOrder:parent,buildContext:{kind:'work-surface',floorY:1}}],
    moduleRecipes:{body:{moduleReplay:[{id:'local',label:'Local',kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:ids.map(id=>[id])}],diagramGroups:[ids.slice(0,3)]}}};
}

test('readable local grouping survives translation, rotation and repeated physical reconstruction',()=>{
  for(let turn=0;turn<4;turn++){
    const options=fixture(turn),snapshot=structuredClone(options),plan=createAssemblyPlan(options),before=structuredClone(plan);
    delete before.moduleRecipes.body.diagramGroups;
    const old=compactAssemblyPlan(before),next=compactAssemblyPlan(plan);
    assert.ok(next.plan.steps.length<old.plan.steps.length);
    assert.ok(next.report.recipeDiagrams.some(a=>a.merged));
    assert.deepEqual(next.plan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id));
    assert.deepEqual(options,snapshot);
    const rebuilt=createAssemblyPlan({...options,moduleReplay:recipeReplay(plan,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(plan)});
    assert.deepEqual(compactAssemblyPlan(rebuilt).plan.steps.map(s=>s.newBrickIds),next.plan.steps.map(s=>s.newBrickIds));
    assert.deepEqual(next.plan.steps.flatMap(s=>s.orderedOperations).map(s=>[s.id,s.kind,s.newBrickIds]),plan.steps.map(s=>[s.id,s.kind,s.newBrickIds]));
  }
});

test('stored grouping cannot waive warnings, insertion direction, working scope or exact membership',()=>{
  const plan=createAssemblyPlan(fixture());
  const builds=plan.steps.filter(s=>s.moduleId==='body'&&s.kind==='build');
  for(const mutate of [
    p=>{p.steps.find(s=>s.id===builds[1].id).issues=[{code:'temporary-hold',severity:'warning',brickIds:builds[1].newBrickIds}];},
    p=>{p.steps.find(s=>s.id===builds[1].id).insertionDirection='up';},
    p=>{p.steps.find(s=>s.id===builds[1].id).nestedRecipe={...builds[1].nestedRecipe,id:'other'};},
    p=>{p.moduleRecipes.body.diagramGroups[0].push('missing');},
    p=>{p.moduleRecipes.body.diagramGroups[0].pop();p.moduleRecipes.body.diagramGroups[0].push(p.moduleRecipes.body.moduleReplay[0].brickIds.at(-1));},
  ]){
    const changed=structuredClone(plan);mutate(changed);const output=compactAssemblyPlan(changed);
    assert.ok(!output.report.recipeDiagrams?.some(a=>a.merged));
    assert.deepEqual(output.plan.steps.flatMap(s=>s.sourceStepIds),changed.steps.map(s=>s.id));
  }
});

test('a one-piece nested assembly is one placement diagram with both physical operations retained',()=>{
  const options=fixture(),ids=options.moduleRecipes.body.moduleReplay[0].brickIds;
  options.moduleRecipes.body={moduleReplay:[{id:'lower',label:'Lower',kind:'grounded',brickIds:ids.slice(0,3),brickOrder:ids.slice(0,3)},
    {id:'cap',label:'Cap',kind:'detail',groupType:'work-surface',brickIds:ids.slice(3),brickOrder:ids.slice(3),buildContext:{kind:'work-surface',floorY:2}}]};
  const plan=createAssemblyPlan(options),join=plan.steps.find(s=>s.kind==='join'&&s.nestedRecipe?.id==='body/cap');
  const compacted=compactAssemblyPlan(plan),placement=compacted.plan.steps.find(s=>s.sourceStepIds.includes(join.id));
  assert.equal(placement.newBrickIds.length,1);assert.equal(placement.sourceStepIds.length,2);assert.equal(placement.kind,'join');
  assert.deepEqual(placement.joinContext,join.joinContext);
  for(const mutate of [s=>s.issues.push({code:'blocked-module-insertion',severity:'error',brickIds:s.highlightBrickIds}),s=>s.nestedRecipe.firstStepId='wrong']){
    const bad=structuredClone(plan);mutate(bad.steps.find(s=>s.id===join.id));
    assert.equal(compactAssemblyPlan(bad).plan.steps.find(s=>s.sourceStepIds.includes(join.id)).sourceStepIds.length,1);
  }
});
