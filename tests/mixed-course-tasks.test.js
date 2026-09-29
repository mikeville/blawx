import test from 'node:test';
import assert from 'node:assert/strict';
import {refineMixedCourseTasks} from '../src/mixed-course-tasks.js';
import {proposeCourseFeatures} from '../src/course-features.js';
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
function sharedSurface(transform=b=>b){
  const b=(id,x,y,z,w=2,d=2,color='blue')=>transform({id,x,y,z,w,d,color});
  const batch=(i,x,w)=>[b(`support-${i}`,1+4*i,1,0,1,2,'tan'),b(`back-${i}`,x,2,2,w,2),b(`strip-${i}`,4*i,2,0,4,2,'white')];
  return fromBatches([[b('base',0,0,0,12,4),b('far-base',20,0,0)],
    [b('back-support',0,1,2,12,2)],
    [b('old-back-1',4,2,2),b('old-back-2',8,2,2)],
    batch(0,0,4),[b('far-1',20,1,0)],batch(1,6,2),[b('far-2',20,2,0)],batch(2,10,2)]);
}
const payload=s=>{const {visibleBrickIds,...rest}=s;return rest;};

test('plans repeated supports, a completed contextual surface, then its contrasting strip',()=>{
  for(const transform of [b=>b,b=>({...b,x:40-b.z-b.d,z:b.x,w:b.d,d:b.w,color:{blue:'green',white:'yellow',tan:'red'}[b.color]})]){
    const before=sharedSurface(transform),frozen=structuredClone(before),after=refineMixedCourseTasks(before);
    assert.ok(after.mixedCourseTaskRefinement?.selected);
    assert.deepEqual(after.mixedCourseTaskRefinement.features.map(f=>[f.kind,f.pieceCount]),[['pattern',3],['panel-completion',3],['panel',3]]);
    assert.deepEqual(after.instructionPlan.steps.slice(3,6).map(s=>s.newBrickIds),[
      ['support-0','support-1','support-2'],['back-0','back-1','back-2'],['strip-0','strip-1','strip-2']]);
    assert.equal(after.instructionPlan.steps.length,before.instructionPlan.steps.length);
    assert.equal(after.brickModel,before.brickModel);assert.deepEqual(before,frozen);
    assert.deepEqual(after.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)),before.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.orderedOperations).sort((a,b)=>a.id.localeCompare(b.id)),before.instructionPlan.steps.flatMap(s=>s.orderedOperations).sort((a,b)=>a.id.localeCompare(b.id)));
    assert.equal(refineMixedCourseTasks(after),after);
  }
});

test('consolidates the upper course when it is one readable feature',()=>{
  const before=sharedSurface(b=>({...b,color:b.color==='white'?'blue':b.color}));
  const after=refineMixedCourseTasks(before);
  assert.ok(after.mixedCourseTaskRefinement?.selected);
  assert.equal(after.instructionPlan.steps.length,before.instructionPlan.steps.length-1);
  assert.equal(after.instructionPlan.stats.stepCount,after.instructionPlan.steps.length);
  assert.equal(after.guide.stats.substepCount,after.instructionPlan.steps.length);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
});

test('does not infer a shared task from irregular supports or cross protected work',()=>{
  for(const edit of [r=>{r.instructionPlan.bricks.find(b=>b.id==='support-2').x++;},
    r=>{r.instructionPlan.steps[4].issues=[{code:'unsupported'}];},
    r=>{r.instructionPlan.steps[4].moduleId='other';},
    r=>{r.instructionPlan.steps[5].instructionAction={kind:'feature',id:'deliberate'};},
    r=>{r.instructionPlan.modules[0].buildContext={kind:'table'};},
    r=>{r.assemblyPlan.steps.find(s=>s.newBrickIds.includes('support-1')).instructionAction={kind:'feature'};},
    r=>{const s=r.assemblyPlan.steps.find(s=>s.newBrickIds.includes('support-2'));s.visibleBrickIds=s.visibleBrickIds.filter(id=>id!=='base');}]){
    const before=sharedSurface();edit(before);assert.equal(refineMixedCourseTasks(before),before);
  }
});

test('preserves indivisible multi-piece canonical operations',()=>{
  const before=sharedSurface(),diagram=before.instructionPlan.steps[3];
  const ids=diagram.sourceStepIds,start=before.assemblyPlan.steps.findIndex(s=>s.id===ids[0]);
  const joined={...before.assemblyPlan.steps[start+2],id:'indivisible',newBrickIds:[...diagram.newBrickIds],highlightBrickIds:[...diagram.newBrickIds]};
  before.assemblyPlan.steps.splice(start,3,joined);diagram.sourceStepIds=['indivisible'];
  diagram.orderedOperations=[{id:'indivisible',kind:'build',newBrickIds:[...diagram.newBrickIds],highlightBrickIds:[...diagram.newBrickIds],issues:[],insertionDirection:'down'}];
  assert.equal(refineMixedCourseTasks(before),before);
});

test('context must fill the bounded same-color course with whole existing bricks',()=>{
  const r=sharedSurface(),all=r.instructionPlan.bricks,additions=all.filter(b=>b.id.startsWith('back-')&&!b.id.includes('support'));
  const prior=all.filter(b=>b.y<2||b.id.startsWith('old-back'));
  const proposal=p=>proposeCourseFeatures(additions,p,{completeArea:true,contextualPanels:true});
  assert.equal(proposal(prior).length,1);assert.equal(proposal(prior)[0].kind,'panel-completion');
  for(const p of [prior.filter(b=>b.id!=='old-back-1'),prior.map(b=>b.id==='old-back-1'?{...b,color:'red'}:b),
    prior.map(b=>b.id==='old-back-1'?{...b,z:1,d:3}:b)])assert.notEqual(proposal(p)?.length,1);
});

test('completes an interrupted mixed-color layer after its missing lower support',()=>{
  const b=(id,x,y,z,w=2,d=2,color='blue')=>({id,x,y,z,w,d,color});
  const before=fromBatches([[b('base',0,0,0,12,4)],
    [b('rear-support',0,1,2,12,2),b('left-support',1,1,0,1,2)],
    [b('left-rear',0,2,2,6,2),b('left-front',0,2,0,6,2,'white')],
    [b('upper',0,3,2)],
    [b('right-support',9,1,0,1,2)],
    [b('right-rear',6,2,2,6,2),b('right-front',6,2,0,6,2,'white')]]);
  const after=refineMixedCourseTasks(before);
  assert.ok(after.mixedCourseTaskRefinement?.selected);
  assert.deepEqual(after.mixedCourseTaskRefinement.prerequisiteStepIds,['diagram-4']);
  assert.equal(after.instructionPlan.steps[2].id,'diagram-4');
  assert.deepEqual(after.instructionPlan.steps[3].newBrickIds,['left-rear','left-front','right-rear','right-front']);
  assert.equal(after.instructionPlan.steps[4].id,'diagram-3');
  assert.deepEqual(after.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)),before.assemblyPlan.steps.map(payload).sort((a,b)=>a.id.localeCompare(b.id)));
  before.instructionPlan.steps[4].instructionAction={id:'separate-action',kind:'feature'};
  assert.equal(refineMixedCourseTasks(before),before,'Do not dismantle a deliberate lower task');
});
