import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeReceiverUndersides,discoverReceiverUndersides} from '../src/receiver-undersides.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {contactCells} from '../src/local-interface-repair.js';

function fixture(turn=0){
 const raw=[...Array.from({length:3},(_,y)=>({x:0,y,z:0,w:2,d:2,color:'black'})),
  ...Array.from({length:4},(_,i)=>({x:4+2*i,y:1,z:0,w:2,d:2,color:'darkGray'})),
  ...[[4,1],[5,2],[7,2],[9,3]].map(([x,w])=>({x,y:2,z:0,w,d:2,color:'darkGray'})),
  ...[0,1].flatMap(y=>Array.from({length:6},(_,i)=>({x:2*i,y:3+y,z:0,w:2,d:2,color:'green'}))),
  ...Array.from({length:5},(_,i)=>({x:1+2*i,y:5,z:0,w:2,d:2,color:'green'})),
  {x:2,y:6,z:0,w:2,d:2,color:'red'}];
 const bricks=raw.map(b=>({...rotateRecipeBrick(b,turn),color:turn&&b.color==='green'?'orange':b.color}));
 const brickModel={kind:'bricks',version:1,bricks},identified=createAssemblyPlan({brickModel}).bricks;
 const lower=identified.filter(b=>b.y<3).map(b=>b.id),upper=identified.filter(b=>b.y>=3&&b.y<6).map(b=>b.id),cap=identified.filter(b=>b.y===6).map(b=>b.id);
 const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,moduleReplay:[
  {id:'base',label:'Base',kind:'grounded',brickIds:lower,brickOrder:lower},
  {id:'receiver',label:'Receiver',kind:'detail',groupType:'work-surface',brickIds:upper,brickOrder:upper,buildContext:{kind:'work-surface',floorY:3}},
  {id:'cap',label:'Cap',kind:'grounded',groupType:'continuation',brickIds:cap,brickOrder:cap}],allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true});
 const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
 return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('lower components complete with their receiver before its unchanged outer attachment',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=completeReceiverUndersides(before);
  assert.ok(after.receiverUndersideCompletion?.selected,JSON.stringify(after.receiverUndersideCompletion));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.deepEqual(after.brickModel,before.brickModel);assert.deepEqual(before,snapshot);
  const oldJoin=before.assemblyPlan.steps.find(s=>s.moduleId==='receiver'&&s.kind==='join');
  const joins=after.assemblyPlan.steps.filter(s=>s.kind==='join');assert.equal(joins.length,2);
  assert.ok(joins[0].nestedRecipe?.separate);assert.equal(joins[1].nestedRecipe,undefined);
  assert.deepEqual(contactCells(before.assemblyPlan,oldJoin),contactCells(after.assemblyPlan,joins[1]));
  assert.ok(after.assemblyPlan.steps.filter(s=>s.moduleId==='receiver').every(s=>!s.issues.length));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  const moved=new Set(before.assemblyPlan.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds));
  const oldCap=before.instructionPlan.steps.find(s=>s.moduleId==='cap'),newCap=after.instructionPlan.steps.find(s=>s.moduleId==='cap');
  assert.deepEqual(newCap.newBrickIds,oldCap.newBrickIds);
  assert.deepEqual(newCap.visibleBrickIds.filter(id=>!moved.has(id)).sort(),oldCap.visibleBrickIds.filter(id=>!moved.has(id)).sort());
  assert.ok([...moved].every(id=>newCap.visibleBrickIds.includes(id)));
  assert.ok(after.instructionPlan.steps.filter(s=>s.moduleId==='base').every(s=>s.visibleBrickIds.every(id=>!moved.has(id))));
  assert.equal(completeReceiverUndersides(after),after);
 }
});

test('discovery refuses shared external ownership and unvalidated or repeated receivers',()=>{
 const before=fixture(),plan=before.assemblyPlan;assert.ok(discoverReceiverUndersides(plan).length);
 const detached=structuredClone(plan),receiver=new Set(plan.modules.find(m=>m.id==='receiver').brickIds);
 detached.graph.edges=detached.graph.edges.filter(e=>!receiver.has(e.a)&&!receiver.has(e.b));
 assert.deepEqual(discoverReceiverUndersides(detached),[]);
 const shared=structuredClone(plan),failed=plan.steps.find(s=>s.kind==='unresolved').newBrickIds[0],ground=plan.bricks.find(b=>b.y===0).id;
 shared.graph.edges.push({a:failed,b:ground,studs:1});assert.deepEqual(discoverReceiverUndersides(shared),[]);
 const repeated=structuredClone(plan);repeated.modules.find(m=>m.id==='receiver').recipeFamily={id:'repeated'};assert.deepEqual(discoverReceiverUndersides(repeated),[]);
 const blocked=structuredClone(plan);blocked.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion'});assert.deepEqual(discoverReceiverUndersides(blocked),[]);
});
