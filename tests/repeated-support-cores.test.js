import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {refineRepeatedSupportCores} from '../src/repeated-support-cores.js';
import {deriveGuidePresentation} from '../src/guide-presentation.js';
import {repeatedSupportFixture as fixture} from './helpers/repeated-support-fixture.js';


test('identical cores repeat before differing interfaces with unchanged geometry and final attachment',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=refineRepeatedSupportCores(before);
  assert.ok(after.repeatedCoreRefinement?.selected);
  assert.equal(after.repeatedCoreRefinement.piecesPerCore,8);
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  const repeat=deriveGuidePresentation({plan:after.instructionPlan,guide:after.guide}).sections.find(s=>s.repeatCount===2);
  assert.ok(repeat);assert.equal(repeat.brickIds.length,8);assert.equal(repeat.instances.flatMap(i=>i.brickIds).length,16);
  const replaced=new Set(after.repeatedCoreRefinement.oldSourceStepIds);
  for(const s of before.assemblyPlan.steps)if(!replaced.has(s.id))assert.deepEqual(after.assemblyPlan.steps.find(n=>n.id===s.id),s);
  assert.deepEqual(after.assemblyPlan.graph,before.assemblyPlan.graph);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.ok(after.assemblyPlan.steps.every(s=>!s.issues.length));
  const coreIds=new Set(repeat.instances.flatMap(i=>i.brickIds)),interfaces=after.repeatedCoreRefinement.interfaceBrickIds;
  for(const id of interfaces){const step=after.assemblyPlan.steps.find(s=>s.newBrickIds.includes(id));assert.ok([...coreIds].every(i=>step.visibleBrickIds.includes(i)));}
  assert.equal(refineRepeatedSupportCores(after),after);
 }
});

test('repeat continuation cannot hide missing, failed, reversed or premature interface work',()=>{
 const base=refineRepeatedSupportCores(fixture());assert.ok(base.repeatedCoreRefinement?.selected);
 const cases=[
  r=>r.instructionPlan.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion',severity:'error'}),
  r=>r.instructionPlan.steps.find(s=>s.newBrickIds.includes(r.repeatedCoreRefinement.interfaceBrickIds[0])).issues.push({code:'unsupported',severity:'error'}),
  r=>r.instructionPlan.steps.find(s=>s.newBrickIds.includes(r.repeatedCoreRefinement.interfaceBrickIds[0])).insertionDirection='up',
  r=>{for(const m of r.instructionPlan.modules)if(m.repeatContinuation)m.repeatContinuation.brickIds=[];},
  r=>{const steps=r.instructionPlan.steps,i=steps.findIndex(s=>s.newBrickIds.includes(r.repeatedCoreRefinement.interfaceBrickIds[0]));steps.unshift(...steps.splice(i,1));},
 ];
 for(const mutate of cases){const r=structuredClone(base);mutate(r);assert.ok(deriveGuidePresentation({plan:r.instructionPlan,guide:r.guide}).sections.every(s=>s.repeatCount===1));}
});

test('different core courses and failed joins remain uncollapsed',()=>{
 const bad=fixture();bad.assemblyPlan.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion',severity:'error'});assert.equal(refineRepeatedSupportCores(bad),bad);
 const different=fixture();const group=different.assemblyPlan.steps.find(s=>s.kind==='join').joinContext.supportGroups[1];
 for(const plan of [different.assemblyPlan,different.instructionPlan])plan.bricks.find(b=>b.id===group.brickIds[0]).color='black';
 assert.equal(refineRepeatedSupportCores(different),different);
});

test('supported additions require real earlier lower supports and remain replayable',()=>{
 const base=fixture(),after=refineRepeatedSupportCores(base),plan=after.assemblyPlan;
 const replay=plan.modules.map(m=>({...m,brickOrder:plan.steps.filter(s=>s.moduleId===m.id).flatMap(s=>s.newBrickIds)}));
 const rebuilt=createAssemblyPlan({brickModel:after.brickModel,moduleReplay:replay});assert.equal(rebuilt.stats.unresolvedBrickCount,0);
 const interfaceIndex=replay.findIndex(m=>m.groupType==='supported-additions');assert.ok(interfaceIndex>0);
 const reordered=[replay[interfaceIndex],...replay.filter((_,i)=>i!==interfaceIndex)];
 assert.throws(()=>createAssemblyPlan({brickModel:after.brickModel,moduleReplay:reordered}),/earlier lower supports/);
 const altered=structuredClone(replay);altered[interfaceIndex].kind='detail';
 assert.throws(()=>createAssemblyPlan({brickModel:after.brickModel,moduleReplay:altered}));
});
