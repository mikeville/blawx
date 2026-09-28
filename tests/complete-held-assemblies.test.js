import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeHeldAssemblies} from '../src/complete-held-assemblies.js';
import {contactCells} from '../src/local-interface-repair.js';
import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';

function fixture(turn=0,blocked=false) {
  const colors=turn%2?{blue:'red',tan:'white',brown:'black',red:'blue',green:'yellow'}:{};
  let bricks=[{x:0,y:0,z:0,w:2,d:4,color:'blue'},...[
    {x:0,y:1,w:1,color:'tan'},{x:0,y:2,w:1,color:'brown'},{x:0,y:3,w:1,color:'red'},
    {x:1,y:3,w:1,color:'tan'},{x:0,y:4,w:2,color:'tan'},{x:0,y:5,w:2,color:'green'},
  ].map(b=>({...b,z:0,d:4}))];
  if(blocked){bricks.push({x:2,y:0,z:0,w:2,d:4,color:'blue'});for(let y=1;y<6;y++)bricks.push({x:2,y,z:0,w:1,d:2,color:'blue'});bricks.push({x:0,y:6,z:0,w:4,d:2,color:'blue'});}
  bricks=bricks.map(b=>{let n={...b};for(let i=0;i<turn;i++)n={...n,x:-n.z-n.d,z:n.x,w:n.d,d:n.w};return {...n,x:n.x+12,z:n.z+12,color:colors[b.color]??b.color};});
  const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel}).bricks;
  const baseColor=colors.blue??'blue',base=identified.filter(b=>b.color===baseColor).map(b=>b.id),panel=identified.filter(b=>!base.includes(b.id)).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,maxBricksPerStep:1,moduleReplay:[
    {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
    {id:'panel',label:'Panel',kind:'detail',brickIds:panel,brickOrder:panel},
  ]});
  // Retain the legacy source diagrams, including their suspended placements.
  const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('held sections become complete recipes with real attachments across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),snapshot=structuredClone(before),after=completeHeldAssemblies(before);
    assert.equal(after.heldAssemblyCompletion.selected,true);
    assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
    assert.ok(before.assemblyPlan.steps.some(s=>s.issues.some(i=>i.code==='temporary-hold')));
    assert.ok(after.assemblyPlan.steps.filter(s=>s.moduleId==='panel').every(s=>!s.issues.length));
    const join=after.assemblyPlan.steps.find(s=>s.moduleId==='panel'&&s.kind==='join'&&!s.nestedRecipe);
    assert.ok(join.joinContext);assert.equal(join.joinContext.direction,'down');
    assert.deepEqual(contactCells(after.assemblyPlan,join),contactCells(before.assemblyPlan,before.assemblyPlan.steps.find(s=>s.moduleId==='panel'&&s.kind==='join')));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    assert.equal(after.heldAssemblyCompletion.attempts[0].handling[0].finalComponentCount,1);
    assert.ok(createBookletPresentation(after).numbering.diagramCount<=createBookletPresentation(before).numbering.diagramCount+1);
    assert.strictEqual(completeHeldAssemblies(after),after);
  }
});

test('protected repeated ownership and absent holding problems are not reconstructed',()=>{
  for(const marker of ['recipeFamily','sharedHandledRecipe','repeatContinuation','componentRecipe','mirroredAssembly']){
    const before=fixture();before.assemblyPlan.modules.find(m=>m.id==='panel')[marker]={id:'protected'};
    assert.strictEqual(completeHeldAssemblies(before),before);
  }
  const before=fixture();for(const s of before.assemblyPlan.steps)s.issues=[];
  assert.strictEqual(completeHeldAssemblies(before),before);
});

test('a roof blocking the completed section is not excused by an isolated recipe',()=>{
  const before=fixture(0,true),after=completeHeldAssemblies(before);
  assert.notEqual(after.heldAssemblyCompletion?.selected,true);
  assert.deepEqual(after.assemblyPlan,before.assemblyPlan);
});

function overhangingRecipe(turn=0,courses=1) {
  const palette=turn%2?{blue:'green',black:'brown',white:'tan'}:{};
  let bricks=[{x:0,y:0,z:0,w:2,d:4,color:'blue'}];
  for(let x=0;x<6;x+=2)for(let z=0;z<4;z+=2)bricks.push({x,y:1,z,w:2,d:2,color:'black'});
  for(let x=0;x<8;x+=2)bricks.push({x,y:2,z:0,w:2,d:4,color:'white'});
  for(let y=3;y<=4+courses;y++)for(let z=0;z<4;z+=2)for(const [x,w]of y%2?[[0,4],[4,4]]:[[0,2],[2,4],[6,2]])bricks.push({x,y,z,w,d:2,color:'white'});
  bricks=bricks.map(b=>{let n={...b};for(let i=0;i<turn;i++)n={...n,x:-n.z-n.d,z:n.x,w:n.d,d:n.w};return {...n,x:n.x+10,z:n.z+10,color:palette[n.color]??n.color};});
  const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel}).bricks;
  const base=identified.filter(b=>b.y===0).map(b=>b.id),panel=identified.filter(b=>b.y>0).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[
    {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
    {id:'panel',label:'Panel',kind:'detail',brickIds:panel,brickOrder:panel},
  ]});
  return prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}});
}

test('a complete upper assembly replaces an awkward underside strategy across rotations and palettes',()=>{
  for(const [turn,courses]of [[0,1],[1,1],[2,1],[3,1],[0,13]]){
    const before=overhangingRecipe(turn,courses),snapshot=structuredClone(before),after=completeHeldAssemblies(before);
    const attempts=after.heldAssemblyCompletion.attempts;
    assert.ok(attempts.some(a=>a.allowUnderAttachments&&!a.selected));
    assert.ok(attempts.some(a=>!a.allowUnderAttachments&&a.selected));
    assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
    const steps=after.assemblyPlan.steps.filter(s=>s.moduleId==='panel');
    assert.ok(steps.every(s=>!s.issues.length));assert.equal(steps.filter(s=>s.kind==='join').length,2);
    assert.ok(steps.every(s=>s.insertionDirection!=='up'));
    const inner=steps.find(s=>s.kind==='join'&&s.nestedRecipe),outer=steps.find(s=>s.kind==='join'&&!s.nestedRecipe);
    assert.ok(steps.indexOf(inner)<steps.indexOf(outer));assert.ok(inner.joinContext);assert.ok(outer.joinContext);
    assert.deepEqual(contactCells(after.assemblyPlan,outer),contactCells(before.assemblyPlan,before.assemblyPlan.steps.find(s=>s.kind==='join')));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    assert.ok(createBookletPresentation(after).numbering.diagramCount<=createBookletPresentation(before).numbering.diagramCount+1);
  }
});
