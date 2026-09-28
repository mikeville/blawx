import test from 'node:test';
import assert from 'node:assert/strict';
import {receiverFixture} from './helpers/receiver-recipe-fixture.js';
import {replanReceiverRecipes} from '../src/receiver-recipes.js';
import {createGuideSections} from '../src/guide-sections.js';
import {consolidateConnectionTasks} from '../src/connection-task-diagrams.js';

function sourceDiagrams(turn=0){
  const receiver=replanReceiverRecipes(receiverFixture(turn));
  assert.ok(receiver.receiverRecipePlanning.selected);
  const proof=receiver.receiverRecipePlanning.attempts.at(-1),task={kind:'receiver-connections',moduleId:proof.parentId,brickIds:proof.upper,underIds:proof.lower};
  const instructionPlan={...receiver.assemblyPlan,steps:receiver.assemblyPlan.steps.map(s=>({...s,id:`raw-${s.id}`,sourceStepIds:[s.id],
    orderedOperations:[{id:s.id,kind:s.kind,insertionDirection:s.insertionDirection??'down',newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues}]}))};
  return {result:{...receiver,instructionPlan,guide:createGuideSections(instructionPlan)},task};
}

test('a complete receiver connection task stays together across rotation and color changes',()=>{
 for(let turn=0;turn<4;turn++){
  const {result,task}=sourceDiagrams(turn),snapshot=structuredClone(result),after=consolidateConnectionTasks(result,[task]);
  assert.notEqual(after,result);assert.deepEqual(result,snapshot);assert.equal(after.assemblyPlan,result.assemblyPlan);
  assert.equal(after.instructionPlan.steps.length,result.instructionPlan.steps.length-1);
  const combined=after.instructionPlan.steps.find(s=>s.connectionTask);
  assert.deepEqual(combined.newBrickIds,task.brickIds);
  assert.deepEqual(combined.connectionTask.underIds,task.underIds);
  for(const key of ['newBrickIds','sourceStepIds','orderedOperations'])assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s[key]),result.instructionPlan.steps.flatMap(s=>s[key]));
  const replaced=new Set(combined.connectionTask.sourceDiagramIds);
  for(const step of result.instructionPlan.steps)if(!replaced.has(step.id))assert.deepEqual(after.instructionPlan.steps.find(s=>s.id===step.id),step);
  assert.equal(consolidateConnectionTasks(after,[task]),after);
 }
});

test('a purpose marker cannot excuse missing future attachment evidence',()=>{
 for(const variant of ['wrong-kind','duplicate','no-capture','wrong-capture-direction','partial-group']){
  const {result,task}=sourceDiagrams();
  if(variant==='wrong-kind')task.kind='random-course';
  if(variant==='duplicate')task.brickIds[1]=task.brickIds[0];
  if(variant==='no-capture')task.underIds=[];
  if(variant==='wrong-capture-direction')result.assemblyPlan.steps.find(s=>s.newBrickIds.includes(task.underIds[0])).insertionDirection='down';
  if(variant==='partial-group'){
    const source=result.assemblyPlan.steps.find(s=>s.newBrickIds.includes(task.brickIds[0]));
    result.assemblyPlan.steps.find(s=>s.newBrickIds.includes(task.underIds[0])).placementGroupId=source.placementGroupId;
  }
  assert.equal(consolidateConnectionTasks(result,[task]),result,variant);
 }
});

test('scope, insertion direction and intervening work remain real boundaries',()=>{
 for(const variant of ['scope','upward','interruption','different-group']){
  const {result,task}=sourceDiagrams(),first=result.instructionPlan.steps.find(s=>s.newBrickIds.includes(task.brickIds[0]));
  if(variant==='scope')first.nestedRecipe={id:'another-scope'};
  if(variant==='upward')first.insertionDirection='up';
  if(variant==='interruption'){
    const i=result.instructionPlan.steps.indexOf(first);const [earlier]=result.instructionPlan.steps.splice(i-1,1);result.instructionPlan.steps.splice(i,0,earlier);
  }
  if(variant==='different-group')result.assemblyPlan.steps.find(s=>s.newBrickIds.includes(task.brickIds[1])).placementGroupId='different-task';
  assert.equal(consolidateConnectionTasks(result,[task]),result,variant);
 }
});

test('missing receiver support or an overhead blocker prevents a combined diagram',()=>{
 for(const variant of ['missing-support','overhead']){
  const {result,task}=sourceDiagrams(),first=result.instructionPlan.steps.find(s=>s.newBrickIds.includes(task.brickIds[0]));
  if(variant==='missing-support')first.visibleBrickIds=[...first.newBrickIds];
  else{
    const target=result.instructionPlan.bricks.find(b=>b.id===task.brickIds[0]);
    const blocker=result.instructionPlan.bricks.find(b=>first.visibleBrickIds.includes(b.id)&&!task.brickIds.includes(b.id));
    Object.assign(blocker,{x:target.x,z:target.z,y:target.y+1,w:target.w,d:target.d});
  }
  assert.equal(consolidateConnectionTasks(result,[task]),result,variant);
 }
});
