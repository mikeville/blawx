import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {planReceiverBands,discoverReceiverBands} from '../src/receiver-band-assemblies.js';
import {prepareCompleteRecipeCandidate} from '../src/complete-assembly-recipes.js';
import {unresolvedCells} from '../src/refine-construction.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';

function fixture(turn=0){
 const bs=[{x:0,y:0,z:0,w:2,d:2,color:'black'},
  ...Array.from({length:6},(_,i)=>({x:0,y:1,z:2*i,w:2,d:2,color:'green'})),
  ...Array.from({length:5},(_,i)=>({x:0,y:2,z:1+2*i,w:2,d:2,color:'green'})),
  ...Array.from({length:3},(_,i)=>({x:0,y:3,z:4*i,w:2,d:4,color:'green'})),
  {x:0,y:4,z:8,w:2,d:2,color:'red'}];
 const moved=bs.map(b=>rotateRecipeBrick(b,turn)),x=Math.min(...moved.map(b=>b.x)),z=Math.min(...moved.map(b=>b.z));
 const brickModel={version:1,kind:'bricks',bricks:moved.map(b=>({...b,x:b.x-x,z:b.z-z,color:turn&&b.color==='green'?'yellow':b.color}))};
 const identified=createAssemblyPlan({brickModel}),body=identified.bricks.filter(b=>b.y<4).map(b=>b.id),cap=identified.bricks.filter(b=>b.y===4).map(b=>b.id);
 const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,moduleReplay:[{id:'body',label:'Body',kind:'grounded',brickIds:body,brickOrder:body},{id:'cap',label:'Cap',kind:'detail',brickIds:cap,brickOrder:cap}]});
 const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
 return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}
const prepare=(before,after)=>prepareCompleteRecipeCandidate(before,after).candidate;

test('a bounded receiver completes before supported continuation and unlocks its dependent attachment',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=planReceiverBands(before,{prepareCandidate:prepare});
  assert.ok(after.receiverBandPlanning.selected,JSON.stringify(after.receiverBandPlanning));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const parent=after.receiverBandPlanning.moduleId,steps=after.assemblyPlan.steps,join=steps.findIndex(s=>s.moduleId===parent&&s.kind==='join');
  assert.ok(join>0);assert.ok(steps.slice(0,join).filter(s=>s.moduleId===parent).every(s=>!s.issues.length));
  assert.ok(steps.slice(join+1).some(s=>s.moduleId===parent+'-continue'));
  assert.equal(before.assemblyPlan.steps.find(s=>s.moduleId==='cap'&&!s.newBrickIds.length).kind,'unresolved');
  assert.equal(steps.find(s=>s.moduleId==='cap'&&!s.newBrickIds.length).kind,'join');
  assert.deepEqual(after.brickModel,before.brickModel);assert.deepEqual(before,snapshot);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),steps.map(s=>s.id));
  assert.deepEqual(steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  const bad=unresolvedCells(before.assemblyPlan);assert.ok([...unresolvedCells(after.assemblyPlan)].every(c=>bad.has(c)));
  assert.equal(planReceiverBands(after),after);
 }
});

test('discovery requires real lower contacts and a complete table-supported band',()=>{
 const before=fixture(),proposals=discoverReceiverBands(before.assemblyPlan);assert.ok(proposals.length);
 const plan=structuredClone(before.assemblyPlan),floorIds=new Set(plan.bricks.filter(b=>b.y===0).map(b=>b.id));
 plan.graph.edges=plan.graph.edges.filter(e=>!floorIds.has(e.a)&&!floorIds.has(e.b));
 assert.deepEqual(discoverReceiverBands(plan),[]);
 const unsupported=structuredClone(before.assemblyPlan),first=unsupported.bricks.find(b=>b.y===2);
 unsupported.graph.edges=unsupported.graph.edges.filter(e=>!(e.a===first.id||e.b===first.id));
 assert.ok(discoverReceiverBands(unsupported).every(p=>!p.ids.includes(first.id)));
});

test('candidate preparation can reject a physical cut instead of accepting a fragmented guide',()=>{
 const before=fixture(),after=planReceiverBands(before,{prepareCandidate:()=>{throw Error('Unreadable tasks');}});
 assert.equal(after.receiverBandPlanning.selected,false);
 assert.deepEqual(after.assemblyPlan,before.assemblyPlan);
 assert.ok(after.receiverBandPlanning.attempts.some(a=>a.rejectionReasons.includes('Unreadable tasks')));
});
