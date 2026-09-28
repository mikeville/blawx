import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeUndersideAssemblies} from '../src/complete-underside-assemblies.js';
import {contactCells} from '../src/local-interface-repair.js';

function fixture(turn=0,{disconnected=false,single=false,dependentCaps=false}={}) {
  let bricks=[{x:0,y:0,z:0,w:2,d:2,color:'red'},{x:0,y:1,z:0,w:2,d:2,color:'red'},
    {x:0,y:2,z:0,w:2,d:2,color:'red'},{x:0,y:3,z:0,w:4,d:2,color:'red'},
    ...(!single?[{x:2,y:1,z:0,w:2,d:2,color:'green'}]:[]),
    ...(dependentCaps?[{x:2,y:2,z:0,w:1,d:2,color:'green'},{x:3,y:2,z:0,w:1,d:2,color:'green'}]:[{x:2,y:2,z:0,w:2,d:2,color:'green'}])];
  if(disconnected)bricks=bricks.map(b=>b.color==='green'?{...b,x:b.x+6}:b);
  for(let i=0;i<turn;i++)bricks=bricks.map(b=>({...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='red'?'blue':b.color==='green'?'yellow':b.color}));
  const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel}).bricks;
  const roof=identified.filter(b=>b.y===3).map(b=>b.id),caps=dependentCaps?identified.filter(b=>b.y===2&&b.color!==(turn?'blue':'red')).map(b=>b.id):[];
  const root=identified.filter(b=>b.y!==3&&!caps.includes(b.id)).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,allowUnderAttachments:false,moduleReplay:disconnected?null:[
    {id:'root',label:'Root',kind:'grounded',brickIds:root,brickOrder:root},
    {id:'roof',label:'Roof',kind:'detail',groupType:'work-surface',brickIds:roof,brickOrder:roof,buildContext:{kind:'work-surface',floorY:3}},
    ...(caps.length?[{id:'caps',label:'Caps',kind:'grounded',groupType:'continuation',brickIds:caps,brickOrder:caps}]:[]),
  ]});
  const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('complete hanging components transfer across rotations, palettes and single-piece attachments',()=>{
  for(let turn=0;turn<4;turn++)for(const single of [false,true]){
    const before=fixture(turn,{single}),snapshot=structuredClone(before),after=completeUndersideAssemblies(before);
    assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.completeUndersidePlanning.selected,true);
    assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const old=before.assemblyPlan.steps.find(s=>s.moduleId==='roof'&&s.kind==='join');
    const next=after.assemblyPlan.steps.find(s=>s.moduleId==='roof'&&s.kind==='join');
    assert.deepEqual(contactCells(before.assemblyPlan,old),contactCells(after.assemblyPlan,next));
    assert.ok(after.assemblyPlan.steps.some(s=>s.kind==='join'&&s.joinContext.direction==='up'));
  }
});

test('missing contact cannot be solved by inventing a hanging assembly',()=>{
  const before=fixture(0,{disconnected:true}),after=completeUndersideAssemblies(before);
  assert.equal(after.completeUndersidePlanning.selected,false);
  assert.deepEqual(after.assemblyPlan,before.assemblyPlan);
  assert.deepEqual(after.instructionPlan,before.instructionPlan);
});

test('a hanging recipe includes failed dependent details across earlier continuation boundaries',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn,{dependentCaps:true}),snapshot=structuredClone(before),after=completeUndersideAssemblies(before);
  assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const added=after.assemblyPlan.modules.filter(m=>!before.assemblyPlan.modules.some(n=>n.id===m.id));
  assert.equal(added.length,1);assert.equal(added[0].brickIds.length,3);
  assert.ok(before.assemblyPlan.modules.find(m=>m.id==='caps').brickIds.every(id=>added[0].brickIds.includes(id)));
  assert.equal(after.assemblyPlan.modules.some(m=>m.id==='caps'),false);
  const join=after.assemblyPlan.steps.find(s=>s.moduleId===added[0].id&&s.kind==='join'&&!s.nestedRecipe);
  assert.equal(join.joinContext.direction,'up');assert.deepEqual(join.issues,[]);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
 }
});

test('component discovery cannot take dependent pieces out of protected recipe ownership',()=>{
 const before=fixture(0,{dependentCaps:true});
 const caps=before.assemblyPlan.modules.find(m=>m.id==='caps');caps.componentRecipe={id:'protected'};
 const after=completeUndersideAssemblies(before);
 assert.deepEqual(after.assemblyPlan.modules.find(m=>m.id==='caps').brickIds,caps.brickIds);
 assert.ok(after.assemblyPlan.stats.unresolvedBrickCount>0);
});
