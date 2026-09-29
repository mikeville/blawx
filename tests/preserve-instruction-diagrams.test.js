import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {retainUnchangedDiagrams} from '../src/preserve-instruction-diagrams.js';

function fixture(groups=[[0],[1],[2],[3]], diagrams=[[0,1],[2,3]]) {
  const base=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:Array.from({length:4},(_,x)=>({x,y:0,z:0,w:1,d:1,color:'blue'}))},integratedBuild:true});
  const ids=base.bricks.map(b=>b.id),visible=[];
  const steps=groups.map((group,i)=>{const additions=group.map(j=>ids[j]);visible.push(...additions);return {
    id:`source-${i}`,moduleId:base.modules[0].id,label:'Build the layer',kind:'build',newBrickIds:additions,highlightBrickIds:additions,
    visibleBrickIds:[...visible],issues:[],insertionDirection:'down'};});
  const assemblyPlan={...base,steps};
  const instructionPlan={...assemblyPlan,steps:diagrams.map((group,i)=>{
    const sources=group.map(j=>steps[j]),all=sources.flatMap(s=>s.newBrickIds);
    return {...sources.at(-1),id:`diagram-${i}`,newBrickIds:all,highlightBrickIds:all,sourceStepIds:sources.map(s=>s.id),orderedOperations:sources};
  })};
  return {assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
const coverage=r=>assert.deepEqual(r.instructionPlan.steps.flatMap(s=>s.sourceStepIds),r.assemblyPlan.steps.map(s=>s.id));

test('keeps accepted diagrams when validation splits batches and changes internal placement order',()=>{
  const before=fixture([[0,1],[2,3]],[[0],[1]]),after=fixture([[1],[0],[2],[3]],[[0],[1],[2],[3]]);
  const original=structuredClone(after),r=retainUnchangedDiagrams(before,after);
  assert.equal(r.instructionPlan.steps.length,2);coverage(r);
  assert.deepEqual(r.instructionPlan.steps[0].orderedOperations.map(s=>s.newBrickIds),after.assemblyPlan.steps.slice(0,2).map(s=>s.newBrickIds));
  assert.deepEqual(after,original);assert.equal(r.assemblyPlan,after.assemblyPlan);
});

test('chooses complete diagram coverage when a retained prefix would strand a changed tail',()=>{
  const before=fixture(),after=fixture([[0],[1],[2],[3]],[[0,1,2],[3]]);
  const failed=after.assemblyPlan.steps[3];failed.kind='unresolved';failed.issues=[{code:'unsupported-addition',severity:'error',brickIds:failed.newBrickIds}];
  after.instructionPlan.steps[1]={...after.instructionPlan.steps[1],kind:failed.kind,issues:failed.issues};
  const r=retainUnchangedDiagrams(before,after);coverage(r);
  assert.equal(r.instructionPlan.steps.length,2);
  assert.equal(r.instructionPlan.steps[0].newBrickIds.length,3);
  assert.equal(r.instructionPlan.steps[1].kind,'unresolved');assert.deepEqual(r.instructionPlan.steps[1].issues,failed.issues);
});

test('does not reuse a diagram across a changed receiving scene or insertion direction',()=>{
  for(const change of ['scene','direction']) {
    const before=fixture(),after=fixture([[0],[1],[2],[3]],[[0],[1],[2],[3]]);
    if(change==='scene')after.assemblyPlan.steps[1].visibleBrickIds=[];
    else after.assemblyPlan.steps[1].insertionDirection='up';
    const r=retainUnchangedDiagrams(before,after);coverage(r);
    assert.equal(r.instructionPlan.steps[0].newBrickIds.length,1);
  }
});

test('retained component instructions point to their renumbered final diagram',()=>{
  const before=fixture(),after=fixture([[0],[1],[2],[3]],[[0],[1],[2],[3]]);
  for(const [i,s]of before.instructionPlan.steps.entries())s.componentTask={id:'section',index:i+1,total:2,lastStepId:'diagram-1'};
  const r=retainUnchangedDiagrams(before,after);
  assert.ok(r.instructionPlan.steps.every(s=>s.componentTask.lastStepId===r.instructionPlan.steps.at(-1).id));coverage(r);
});

test('a relocated component can leave the background without fragmenting unchanged tasks',()=>{
  const before=fixture([[0],[1],[2],[3]],[[0],[1,2],[3]]);
  const after=fixture([[1],[2],[3],[0]],[[0],[1],[2],[3]]);
  const moved=before.assemblyPlan.steps[0].newBrickIds[0];
  const strict=retainUnchangedDiagrams(before,after);
  assert.equal(strict.instructionPlan.steps[0].newBrickIds.length,1);
  const retained=retainUnchangedDiagrams(before,after,{omittedContextIds:new Set([moved])});
  assert.equal(retained.instructionPlan.steps.length,3);coverage(retained);
  assert.equal(retained.instructionPlan.steps[0].newBrickIds.length,2);
  assert.ok(!retained.instructionPlan.steps[0].visibleBrickIds.includes(moved));
  assert.ok(retained.instructionPlan.steps.at(-1).visibleBrickIds.includes(moved));
});

test('renumbering a nested recipe keeps its working scope and refreshes diagram references',()=>{
  const before=fixture(),after=fixture([[0],[1],[2],[3]],[[0],[1],[2],[3]]);
  const recipe={id:'parent/child',parentModuleId:'parent',separate:false,floorY:0};
  for(const s of before.assemblyPlan.steps)s.nestedRecipe={...recipe,firstStepId:'source-0'};
  for(const s of before.instructionPlan.steps)s.nestedRecipe={...recipe,firstStepId:'source-0'};
  for(const [i,s]of after.assemblyPlan.steps.entries()){
    s.id=`renumbered-${i}`;s.nestedRecipe={...recipe,firstStepId:'renumbered-0'};
    after.instructionPlan.steps[i].sourceStepIds=[s.id];
    after.instructionPlan.steps[i].nestedRecipe=s.nestedRecipe;
  }
  const retained=retainUnchangedDiagrams(before,after);coverage(retained);
  assert.equal(retained.instructionPlan.steps.length,2);
  assert.ok(retained.instructionPlan.steps.every(s=>s.nestedRecipe.firstStepId==='renumbered-0'));
});

test('renumbering keeps each table recipe tied to its own completion, including partially retained recipes',()=>{
  const before=fixture([[0],[1],[2],[3]],[[0],[1],[2],[3]]),after=structuredClone(before);
  for(const [i,s]of before.instructionPlan.steps.entries())s.tableRecipe={ordinal:i%2+1,total:2,completionStepId:i<2?'diagram-1':'diagram-3',layerTask:true};
  const r=retainUnchangedDiagrams(before,after);coverage(r);
  assert.deepEqual(r.instructionPlan.steps.map(s=>s.tableRecipe.completionStepId),['instruction-step-2','instruction-step-2','instruction-step-4','instruction-step-4']);
  delete before.instructionPlan.steps[0].tableRecipe;
  const partial=retainUnchangedDiagrams(before,after);coverage(partial);
  assert.equal(partial.instructionPlan.steps[1].tableRecipe.completionStepId,'instruction-step-2');
  assert.equal(partial.instructionPlan.steps[3].tableRecipe.completionStepId,'instruction-step-4');
});

test('retaining diagrams preserves explicit working poses in literal operations',()=>{
 const before=fixture(),after=fixture([[0],[1],[2],[3]],[[0],[1],[2],[3]]);
 for(const result of[before,after])for(const plan of[result.assemblyPlan,result.instructionPlan])
  for(const s of plan.steps){s.insertionDirection='up';s.workingOrientation={kind:'inverted',surfaceY:3};}
 const kept=retainUnchangedDiagrams(before,after);
 assert.equal(kept.instructionPlan.steps.length,2);
 assert(kept.instructionPlan.steps.flatMap(s=>s.orderedOperations).every(s=>s.workingOrientation?.surfaceY===3));
 after.assemblyPlan.steps[1].workingOrientation.surfaceY=4;
 assert.equal(retainUnchangedDiagrams(before,after).instructionPlan.steps[0].newBrickIds.length,1);
});
