import test from 'node:test';
import assert from 'node:assert/strict';
import {replayInstructionOrder} from '../src/instruction-order-replay.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
import {completeSupportedCourses} from '../src/course-completion.js';
import {recognizeCourseFeature} from '../src/course-features.js';
import {createGuideSections} from '../src/guide-sections.js';

function fromBatches(batches){
  const bricks=batches.flat(),visible=[],sources=[],steps=[];
  for(const [i,batch]of batches.entries()){
    const canonical=batch.map(b=>{visible.push(b.id);const s={id:`source-${b.id}`,moduleId:'main',kind:'build',label:'Build',
      newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[...visible],issues:[]};sources.push(s);return s;});
    const ids=batch.map(b=>b.id);
    steps.push({...canonical.at(-1),id:`diagram-${i}`,newBrickIds:ids,highlightBrickIds:[...ids],sourceStepIds:canonical.map(s=>s.id),
      orderedOperations:canonical.map(s=>({id:s.id,kind:'build',newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
  }
  const modules=[{id:'main',kind:'grounded',label:'Build',brickIds:bricks.map(b=>b.id)}],stats={stepCount:steps.length,brickCount:bricks.length,coverageComplete:true};
  const assemblyPlan={version:1,bricks,modules,steps:sources,stats},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{bricks},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
function delayedLayer(transform=b=>b){
  const b=(id,x,y,z=0)=>transform({id,x,y,z,w:2,d:2,color:'blue'});
  const result=fromBatches([[b('base-left',0,0),b('base-right',2,0),b('base-far',10,0)],
    [b('lower-left',0,1)],[b('course-left',0,2)],[b('upper-left',0,3)],
    [b('far',10,1)],[b('lower-right',2,1)],[b('course-right',2,2)]]);
  result.instructionPlan.steps[1].instructionAction={id:'lower-action',kind:'feature'};
  for(const i of [2,3])result.instructionPlan.steps[i].buildRegion={id:'earlier-area',index:i-1,total:2,firstStepId:'diagram-2',lastStepId:'diagram-3'};
  result.guide=createGuideSections(result.instructionPlan);return result;
}
const payload=s=>{const {visibleBrickIds,...rest}=s;return rest;};

test('completes a course with its lower prerequisites before returning to upper work',()=>{
  for(const transform of [b=>b,b=>({...b,x:30-b.z-b.d,z:b.x,w:b.d,d:b.w,color:'red'})]){
    const before=delayedLayer(transform),frozen=structuredClone(before),after=completeSupportedCourses(before);
    assert.deepEqual(before,frozen);assert.equal(after.brickModel,before.brickModel);
    assert.equal(after.courseCompletion.selected,true);
    assert.deepEqual(after.instructionPlan.steps.map(s=>s.id),['diagram-0','diagram-1','diagram-5','diagram-2','diagram-3','diagram-4']);
    assert.deepEqual(after.courseCompletion.changes[0].prerequisiteStepIds,['diagram-5']);
    assert.deepEqual(after.instructionPlan.steps[3].newBrickIds,['course-left','course-right']);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)),before.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.orderedOperations).sort((a,b)=>a.id.localeCompare(b.id)),before.instructionPlan.steps.flatMap(s=>s.orderedOperations).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.equal(completeSupportedCourses(after),after);
  }
});

test('retires an interrupted heuristic range without changing its deliberate actions',()=>{
  const before=delayedLayer();
  for(const i of [1,2,3])before.instructionPlan.steps[i].buildRegion={id:'area',index:i,total:3,firstStepId:'diagram-1',lastStepId:'diagram-3'};
  const after=completeSupportedCourses(before);
  assert.ok(after.courseCompletion?.selected);
  assert.ok(after.instructionPlan.steps.every(s=>!s.buildRegion));
  assert.deepEqual(after.instructionPlan.steps[1].instructionAction,before.instructionPlan.steps[1].instructionAction);
});

test('protects purposeful actions, lower-task ownership, warnings, modules and table recipes',()=>{
  for(const edit of [r=>{r.instructionPlan.steps[6].instructionAction={kind:'feature'};},
    r=>{r.instructionPlan.steps[5].instructionAction={kind:'feature'};},
    r=>{r.instructionPlan.steps[5].buildRegion={id:'separate',index:1,total:1};},
    r=>{r.instructionPlan.steps[4].issues=[{code:'limited-support'}];},
    r=>{r.instructionPlan.steps[4].moduleId='other';},
    r=>{r.instructionPlan.modules[0].buildContext={kind:'table'};}]){
    const before=delayedLayer();edit(before);assert.equal(completeSupportedCourses(before),before);
  }
});

test('preserves exact original supports and rejects a combined placement hidden behind later work',()=>{
  const before=delayedLayer();
  const support=before.assemblyPlan.steps.find(s=>s.newBrickIds.includes('course-right'));
  support.visibleBrickIds=support.visibleBrickIds.filter(id=>id!=='lower-right');
  assert.equal(completeSupportedCourses(before),before,'Does not invent a support contact absent from the canonical operation');
  // Completing an enclosure would move its remaining lower walls ahead of
  // the interior. The operations replay, but the interior must stay visible.
  const b=(id,x,y,z)=>({id,x,y,z,w:2,d:2,color:'blue'});
  const ring=y=>[[0,0],[2,0],[4,0],[0,2],[4,2],[0,4],[2,4],[4,4]].map(([x,z],i)=>b(`ring${y}-${i}`,x,y,z));
  const r=fromBatches([[...ring(0),{...b('inside0',2,0,2),color:'orange'}],ring(1),
    [ring(2)[0]],[ring(3)[0]],[ring(4)[0]],
    [{...b('inside1',2,1,2),color:'orange'}],[{...b('inside2',2,2,2),color:'orange'}],
    [...ring(2).slice(1),...ring(3).slice(1)],ring(4).slice(1)]);
  for(const i of [1,2,3])r.instructionPlan.steps[i].instructionAction={id:`planned-${i}`,kind:'feature'};
  const proposed=replayInstructionOrder(r,4,9,[7,4,8,5,6].map(i=>r.instructionPlan.steps[i]));
  assert.ok(proposed,'Support and insertion alone admit the enclosed interior');
  assert.equal(chooseInstructionSequence(r.instructionPlan).get('diagram-6').passes,true);
  assert.equal(chooseInstructionSequence(proposed.instructionPlan).get('diagram-6').passes,false);
  assert.equal(completeSupportedCourses(r),r);
});

test('recognizes dense stepped profiles without accepting sparse, disconnected or perforated layers',()=>{
  const layer=Array.from({length:10},(_,i)=>({id:`part-${i}`,x:i*2,y:2,z:i<2?1:0,w:2,d:4,color:'blue'}));
  assert.equal(recognizeCourseFeature(layer,{completeArea:true}),null);
  assert.equal(recognizeCourseFeature(layer,{completeArea:true,elongatedProfile:true}),'profile');
  const rotate=b=>({...b,x:30-b.z-b.d,z:b.x,w:b.d,d:b.w,color:'green'});
  assert.equal(recognizeCourseFeature(layer.map(rotate),{elongatedProfile:true}),'profile');
  const disconnected=layer.map((b,i)=>({...b,x:b.x+(i>=5?3:0)}));
  assert.equal(recognizeCourseFeature(disconnected,{elongatedProfile:true}),null);
  const part=(id,x,z,w,d)=>({id,x,y:2,z,w,d,color:'blue'});
  const hole=[part('top',0,0,20,1),part('bottom',0,3,20,1),part('left',0,1,8,2),
    part('right',10,1,10,2),part('cap',8,1,2,1)];
  assert.equal(recognizeCourseFeature(hole,{elongatedProfile:true}),null);
});
