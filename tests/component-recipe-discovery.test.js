import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {discoverCompleteComponentRecipe,discoverLayeredComponentRecipe} from '../src/component-recipe-discovery.js';
import {planNestedAssemblies,discoverNestedAssemblies} from '../src/nested-assemblies.js';
import {planAssemblyRecipes} from '../src/assembly-recipe-planning.js';
import {refineCaptureRecipes} from '../src/capture-recipes.js';

function overhang(turn=0){
  const bricks=[];
  for(let x=0;x<6;x+=2)for(let z=0;z<4;z+=2)bricks.push({x,y:0,z,w:2,d:2,color:'black'});
  for(let x=0;x<8;x+=2)bricks.push({x,y:1,z:0,w:2,d:4,color:'white'});
  for(let y=2;y<=4;y++)for(let z=0;z<4;z+=2)
    for(const [x,w]of y%2?[[0,4],[4,4]]:[[0,2],[2,4],[6,2]])bricks.push({x,y,z,w,d:2,color:'white'});
  return bricks.map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+20,y:b.y+3,z:b.z+20,color:turn%2?(b.color==='black'?'green':'yellow'):b.color};
  });
}

function replay(parts,recipe,{gap=false}={}){
  const low=parts.filter(b=>b.y===3),brickModel={version:1,kind:'bricks',bricks:[
    ...[0,1,2].flatMap(y=>low.map(b=>({...b,y}))),...parts.map(b=>({...b,y:b.y+(gap?1:0)})),
  ]};
  const identified=createAssemblyPlan({brickModel}).bricks;
  const base=identified.filter(b=>b.y<3).map(b=>b.id),body=identified.filter(b=>b.y>=3).map(b=>b.id);
  return createAssemblyPlan({brickModel,allowUnderAttachments:false,moduleReplay:[
    {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
    {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:body,brickOrder:body,
      buildContext:{kind:'work-surface',floorY:gap?4:3}},
  ],moduleRecipes:{body:recipe}});
}

test('shared discovery preserves complete child recipes and full courses across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++){
    const parts=overhang(turn),snapshot=structuredClone(parts),{floor,recipe}=discoverCompleteComponentRecipe(parts);
    assert.deepEqual(parts,snapshot);assert.equal(floor,3);
    assert.ok(Object.keys(recipe.moduleRecipes).length);
    assert.deepEqual(recipe.diagramGroups.map(ids=>ids.length),[6,4,6,4,6]);
    const plan=replay(parts,recipe);
    assert.equal(plan.stats.unresolvedBrickCount,0);
    assert.equal(plan.steps.filter(s=>s.kind==='join').length,2);
    assert.ok(plan.steps.some(s=>s.nestedRecipePath?.length===2));
    assert.ok(plan.steps.every(s=>s.insertionDirection!=='up'));
    assert.deepEqual(plan.steps.flatMap(s=>s.newBrickIds).sort(),plan.bricks.map(b=>b.id).sort());
    assert.ok(replay(parts,recipe,{gap:true}).stats.unresolvedBrickCount>0,'local success cannot replace a missing global contact');
  }
});

test('upper component discovery bounds its callback and rejects incomplete supplied recipes',()=>{
  const parts=overhang(),brickModel={version:1,kind:'bricks',bricks:[
    {x:20,y:0,z:20,w:2,d:2,color:'blue'},...parts.map(b=>({...b,y:b.y-2})),
  ]};
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true});
  const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),snapshot=structuredClone(before);
  let calls=0;
  const after=planNestedAssemblies(before,{discoverNestedRecipe:()=>{calls++;return {moduleReplay:[]};}});
  assert.ok(calls>0);assert.equal(calls,Math.min(8,discoverNestedAssemblies(assemblyPlan).length));
  const attempts=after.nestedAssemblyPlanning.attempts.filter(a=>a.strategy==='complete');
  assert.equal(attempts.length,calls);assert.ok(attempts.every(a=>a.rejectionReasons.length));
  assert.deepEqual(before,snapshot);
});

test('complete discovery rejects empty, oversized and disconnected raised components',()=>{
  assert.throws(()=>discoverCompleteComponentRecipe([]),/1–512/);
  assert.throws(()=>discoverCompleteComponentRecipe(Array(513).fill(overhang()[0])),/1–512/);
  assert.throws(()=>discoverCompleteComponentRecipe([
    {x:0,y:0,z:0,w:2,d:2,color:'blue'},
    {x:10,y:2,z:0,w:2,d:2,color:'blue'},
  ]),/Incomplete internal recipe/);
});

test('layered discovery preserves complete courses and rejects missing real attachments',()=>{
  for(let turn=0;turn<4;turn++){
    const parts=overhang(turn),snapshot=structuredClone(parts),{recipe}=discoverLayeredComponentRecipe(parts);
    assert.equal(recipe.allowUnderAttachments,false);
    assert.deepEqual(recipe.diagramGroups.map(ids=>ids.length),[6,4,6,4,6]);
    const plan=replay(parts,recipe);
    assert.equal(plan.stats.unresolvedBrickCount,0);
    assert.equal(plan.steps.filter(s=>s.kind==='join').length,2);
    assert.ok(plan.steps.every(s=>s.kind!=='build'||s.insertionDirection!=='up'));
    assert.deepEqual(plan.steps.flatMap(s=>s.newBrickIds).sort(),plan.bricks.map(b=>b.id).sort());
    assert.ok(replay(parts,recipe,{gap:true}).stats.unresolvedBrickCount>0);
    assert.deepEqual(parts,snapshot);
  }
  assert.throws(()=>discoverLayeredComponentRecipe([]),/1–512/);
  assert.throws(()=>discoverLayeredComponentRecipe(Array(513).fill(overhang()[0])),/1–512/);
  assert.throws(()=>discoverLayeredComponentRecipe([
    {x:0,y:0,z:0,w:2,d:2,color:'blue'},
    {x:10,y:2,z:0,w:2,d:2,color:'blue'},
  ]),/Incomplete internal recipe/);
});

test('capture and nested search keep two overhangs as complete components when underside placement is disabled',()=>{
 const parts=[{x:0,y:0,z:0,w:4,d:2,color:'black'},
  {x:0,y:1,z:0,w:4,d:2,color:'green'},{x:0,y:2,z:0,w:4,d:2,color:'green'},
  {x:4,y:2,z:0,w:1,d:2,color:'green'},{x:2,y:3,z:0,w:3,d:2,color:'green'},
  {x:-1,y:2,z:0,w:1,d:2,color:'blue'},{x:-1,y:3,z:0,w:3,d:2,color:'blue'}];
 for(let turn=0;turn<4;turn++){
  const brickModel={version:1,kind:'bricks',bricks:parts.map(b=>{
   for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
   return {...b,x:b.x+10,z:b.z+10,color:turn%2&&b.color==='green'?'yellow':b.color};
  })};
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true});
  const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),snapshot=structuredClone(before);
  for(const run of [options=>refineCaptureRecipes(brickModel,assemblyPlan,options).plan,
    options=>planNestedAssemblies(before,options).assemblyPlan,
    options=>planAssemblyRecipes(before,options).assemblyPlan]){
   const ordinary=run({}),explicit=run({allowUnderAttachments:true}),layered=run({allowUnderAttachments:false});
   const stable=value=>JSON.parse(JSON.stringify(value,(key,item)=>key.endsWith('Ms')?undefined:item));
   assert.deepEqual(stable(ordinary),stable(explicit),'existing default remains unchanged');
   assert.ok(ordinary.steps.some(s=>s.kind==='build'&&s.insertionDirection==='up'));
   assert.equal(layered.stats.unresolvedBrickCount,0);
   assert.ok(layered.steps.every(s=>s.kind!=='build'||s.insertionDirection!=='up'));
   assert.equal(layered.steps.filter(s=>s.kind==='join').length,2);
   assert.deepEqual(layered.steps.flatMap(s=>s.newBrickIds).sort(),layered.bricks.map(b=>b.id).sort());
  }
  assert.deepEqual(before,snapshot);
 }
});

function broadLayeredComponent(turn=0) {
  const bricks=[];
  for(let x=0;x<20;x+=2)for(let z=0;z<12;z+=2)bricks.push({x,y:3,z,w:2,d:2,color:'white'});
  for(let y=4;y<=11;y++) {
    const xs=y%2?[[0,2],[2,4],[6,4],[10,4],[14,4],[18,2]]:[[0,4],[4,4],[8,4],[12,4],[16,4]];
    const zs=y%2?[[0,1],[1,2],[3,2],[5,2],[7,2],[9,2],[11,1]]:[[0,2],[2,2],[4,2],[6,2],[8,2],[10,2]];
    for(const [x,w]of xs)for(const [z,d]of zs)bricks.push({x,y,z,w,d,color:'red'});
  }
  return bricks.map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+20,z:b.z+20,color:turn?(b.color==='white'?'green':'yellow'):b.color};
  });
}

test('large connected components complete and attach as one recipe across orientations',()=>{
  for(const turn of [0,1]) {
    const parts=broadLayeredComponent(turn),snapshot=structuredClone(parts);
    assert.equal(parts.length,348);
    const {recipe}=discoverCompleteComponentRecipe(parts),plan=replay(parts,recipe);
    assert.equal(plan.stats.unresolvedBrickCount,0);
    assert.equal(plan.steps.filter(s=>s.kind==='join'&&!s.nestedRecipe).length,1);
    assert.deepEqual(plan.steps.flatMap(s=>s.newBrickIds).sort(),plan.bricks.map(b=>b.id).sort());
    assert.ok(replay(parts,recipe,{gap:true}).stats.unresolvedBrickCount>0,'large recipe must still have a real receiving contact');
    assert.deepEqual(parts,snapshot);
    const brickModel={version:1,kind:'bricks',bricks:[
      ...[0,1,2].map(y=>({x:parts[0].x,y,z:parts[0].z,w:2,d:2,color:'blue'})),...parts,
    ]};
    const seed=createAssemblyPlan({brickModel,integratedBuild:true});
    const proposals=discoverNestedAssemblies(seed);
    assert.ok(proposals.some(p=>p.ids.length>256),'complete larger ownership must reach recipe discovery');
  }
});
