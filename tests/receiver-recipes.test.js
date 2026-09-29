import {receiverFixture as fixture} from './helpers/receiver-recipe-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveGuidePresentation} from '../src/guide-presentation.js';
import {discoverReceiverRecipes,replanReceiverRecipes} from '../src/receiver-recipes.js';


test('receiver discovery and one complete attachment generalize across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),proposals=discoverReceiverRecipes(before);
  assert.equal(proposals.length,1);assert.equal(proposals[0].parentId,'platform');assert.deepEqual(proposals[0].childIds,['left','right']);
  const after=replanReceiverRecipes(before);
  assert.ok(after.receiverRecipePlanning?.selected,JSON.stringify(after.receiverRecipePlanning));
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);assert.deepEqual(after.assemblyPlan.graph,before.assemblyPlan.graph);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.assemblyPlan.steps.filter(s=>s.kind==='join').length,1);
  assert.equal(after.assemblyPlan.steps.filter(s=>s.insertionDirection==='up').flatMap(s=>s.newBrickIds).length,2);
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const report=after.receiverRecipePlanning.attempts.at(-1);
  assert.equal(report.handlingAfter.peakLooseBrickCount,report.handlingBefore.peakLooseBrickCount);
  assert.equal(report.handlingAfter.firstBondAtAddition,report.handlingBefore.firstBondAtAddition);
  assert.ok(report.afterDiagrams<report.beforeDiagrams);
  assert.equal(replanReceiverRecipes(after),after);
 }
});

test('repeated supports outside the receiver keep their original recipe',()=>{
 const r=fixture(0,{repeatedSupports:true}),a=replanReceiverRecipes(r);assert.ok(a.receiverRecipePlanning?.selected);
 const repeats=r=>deriveGuidePresentation({plan:r.instructionPlan,guide:r.guide}).sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,steps:s.stepIds.length,parts:s.instances[0].brickIds.length}));
 assert.deepEqual(repeats(r),[{copies:2,steps:1,parts:1}]);assert.deepEqual(repeats(a),repeats(r));
});

test('incomplete attachment evidence and interrupted scopes cannot define a receiver recipe',()=>{
 for(const variant of ['warning','contact','scope','nested']){
  const r=fixture();
  const child=r.assemblyPlan.steps.find(s=>s.moduleId==='left'&&s.kind==='join');
  if(variant==='warning')child.issues.push({code:'unstable',severity:'warning'});
  if(variant==='contact')child.joinContext.supportGroups[0].contacts[0].supportBrickId=r.assemblyPlan.modules[0].brickIds[0];
  if(variant==='scope')r.assemblyPlan.modules.splice(2,0,{id:'intervening',label:'Body',kind:'grounded',brickIds:[]});
  if(variant==='nested')child.nestedRecipe={id:'protected-child'};
  assert.deepEqual(discoverReceiverRecipes(r),[]);
 }
});

test('physical replay protects a child whose lower insertion path is blocked',()=>{
 const r=fixture(0,{blocked:true});assert.equal(discoverReceiverRecipes(r).length,1);const a=replanReceiverRecipes(r);
 // This child needs its independent downwards attachment. It cannot be moved
 // into an elevated receiver and pushed up through an already built obstacle.
 assert.ok(!a.receiverRecipePlanning?.selected);
  assert.deepEqual(a.assemblyPlan,r.assemblyPlan);
});

test('a real weak child bond can become a fully supported receiver task',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn,{weakCap:true}),snapshot=structuredClone(before);
  assert(before.assemblyPlan.steps.some(s=>s.issues.some(i=>i.code==='limited-support')));
  assert.deepEqual(discoverReceiverRecipes(before),[]);
  const after=replanReceiverRecipes(before,{allowChildStrengthAdvisories:true});
  assert(after.receiverRecipePlanning?.selected);
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  assert(after.assemblyPlan.steps.every(s=>!s.issues.length));
  assert.equal(after.assemblyPlan.steps.filter(s=>s.kind==='join').length,1);
  assert.equal(after.assemblyPlan.steps.filter(s=>s.insertionDirection==='up').flatMap(s=>s.newBrickIds).length,2);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.equal(replanReceiverRecipes(after,{allowChildStrengthAdvisories:true}),after);
 }
});

test('strength-advisory exploration still rejects errors and blocked insertions',()=>{
 const before=fixture(0,{weakCap:true});
 const bad=structuredClone(before);
 bad.assemblyPlan.steps.find(s=>s.moduleId==='left').issues.push({code:'unsupported-addition',severity:'error'});
 assert.deepEqual(discoverReceiverRecipes(bad,{allowChildStrengthAdvisories:true}),[]);
 const blocked=fixture(0,{blocked:true,weakCap:true});
 const after=replanReceiverRecipes(blocked,{allowChildStrengthAdvisories:true});
 assert(!after.receiverRecipePlanning?.selected);
 assert.deepEqual(after.assemblyPlan,blocked.assemblyPlan);
});
