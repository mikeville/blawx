import test from 'node:test';
import assert from 'node:assert/strict';
import {restoreUnchangedRecipeMetadata} from '../src/complete-assembly-recipes.js';
import {refineRepeatedSupportCores} from '../src/repeated-support-cores.js';
import {repeatedSupportFixture} from './helpers/repeated-support-fixture.js';
import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';

function reconstructed(before){
 const next=structuredClone(before),ids=new Map(next.assemblyPlan.steps.map(s=>[s.id,`rebuilt-${s.id}`]));
 for(const m of next.assemblyPlan.modules)for(const key of ['recipeFamily','repeatContinuation','sharedHandledRecipe','localInterfaceRepair'])delete m[key];
 for(const s of next.assemblyPlan.steps)s.id=ids.get(s.id);
 for(const s of next.instructionPlan.steps){s.sourceStepIds=s.sourceStepIds.map(id=>ids.get(id));for(const op of s.orderedOperations??[])op.id=ids.get(op.id);}
 next.instructionPlan.modules=next.assemblyPlan.modules;
 return next;
}
const repeats=r=>createBookletPresentation(r).presentation.sections.filter(s=>s.repeatCount>1).map(s=>({copies:s.repeatCount,parts:s.instances.flatMap(i=>i.brickIds).sort()}));

test('reconstruction restores repeated cores and resolves their attachment against current source IDs',()=>{
 for(let turn=0;turn<4;turn++){
  const before=refineRepeatedSupportCores(repeatedSupportFixture(turn)),candidate=reconstructed(before),snapshot=structuredClone(candidate);
  const after=restoreUnchangedRecipeMetadata(before,candidate);
  assert.deepEqual(repeats(after),repeats(before));assert.equal(repeats(after)[0].copies,2);
  for(const m of after.assemblyPlan.modules.filter(m=>m.repeatContinuation)){
   const join=after.assemblyPlan.steps.find(s=>s.id===m.repeatContinuation.joinSourceStepId);
   assert.ok(join.id.startsWith('rebuilt-'));assert.equal(join.kind,'join');assert.deepEqual(join.issues,[]);
  }
  assert.deepEqual(candidate,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
 }
});

test('changed membership, placement direction and failed or reversed joins cannot inherit repeat evidence',()=>{
 const before=refineRepeatedSupportCores(repeatedSupportFixture()),core=before.assemblyPlan.modules.find(m=>m.recipeFamily);
 for(const mutate of [
  r=>r.assemblyPlan.modules.find(m=>m.id===core.id).brickIds.pop(),
  r=>r.assemblyPlan.steps.find(s=>s.moduleId===core.id).insertionDirection='up',
  r=>r.assemblyPlan.steps.find(s=>s.kind==='join').issues.push({severity:'error',code:'blocked-module-insertion'}),
  r=>r.assemblyPlan.steps.find(s=>s.kind==='join').joinContext.direction='up',
 ]){
  const candidate=reconstructed(before);mutate(candidate);
  const after=restoreUnchangedRecipeMetadata(before,candidate);
  assert.equal(after.assemblyPlan.modules.find(m=>m.id===core.id).repeatContinuation,undefined);
 }
});

test('mirrored guidance survives only while both recipe memberships and placements survive',()=>{
 const before=refineRepeatedSupportCores(repeatedSupportFixture()),[source,target]=before.assemblyPlan.modules;
 target.mirroredAssembly={sourceModuleId:source.id,rotationQuarterTurns:0};
 target.componentRecipe={receiverModuleId:source.id};
 const candidate=reconstructed(before);
 for(const m of candidate.assemblyPlan.modules){delete m.mirroredAssembly;delete m.componentRecipe;}
 const restored=restoreUnchangedRecipeMetadata(before,candidate);
 assert.deepEqual(restored.assemblyPlan.modules.find(m=>m.id===target.id).mirroredAssembly,target.mirroredAssembly);
 assert.deepEqual(restored.assemblyPlan.modules.find(m=>m.id===target.id).componentRecipe,target.componentRecipe);
 candidate.assemblyPlan.modules.find(m=>m.id===source.id).brickIds.pop();
 assert.equal(restoreUnchangedRecipeMetadata(before,candidate).assemblyPlan.modules.find(m=>m.id===target.id).mirroredAssembly,undefined);
});
