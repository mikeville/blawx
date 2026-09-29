import test from 'node:test';import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {refineOfflineRecipes} from '../src/offline-recipes.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';

function fragmentedArch(transform=b=>b){
  const brick=(x,y,w,color)=>transform({x,y,z:0,w,d:2,color});
  const brickModel={version:1,kind:'bricks',bricks:[brick(0,0,4,'lightGray'),brick(0,1,2,'blue'),brick(2,1,2,'blue'),
    brick(0,2,2,'yellow'),brick(2,2,2,'yellow'),brick(0,3,4,'red'),brick(9,8,1,'white')]};
  const identified=createAssemblyPlan({brickModel}).bricks;
  const band=identified.filter(b=>b.y>=1&&b.y<=3),base=identified.filter(b=>b.y===0),loose=identified.filter(b=>b.y===8);
  const descriptors=[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(b=>b.id)},
    {id:'arch',label:'Arch',kind:'detail',groupType:'work-surface',brickIds:band.map(b=>b.id),
      buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'},actionOrder:true,
      placementGroups:band.map(b=>[b.id]),brickOrder:band.map(b=>b.id)},
    {id:'loose',label:'Unresolved detail',kind:'floating',brickIds:loose.map(b=>b.id)}];
  const replay=descriptors.map(m=>({...m,brickOrder:m.brickOrder??m.brickIds}));
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay});
  const steps=assemblyPlan.steps.map(s=>({...s,id:`diagram-${s.id}`,sourceStepIds:[s.id],
    orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,
      insertionDirection:s.insertionDirection??'down'}]}));
  const instructionPlan={...assemblyPlan,steps};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),sequenceRefinement:{selected:false}};
}

function verifyPreservation(before,after){
  assert.equal(after.brickModel,before.brickModel);
  assert.deepEqual(after.assemblyPlan.modules,before.assemblyPlan.modules);
  const outside=s=>s.moduleId!=='arch'||!s.newBrickIds.length;
  assert.deepEqual(after.assemblyPlan.steps.filter(outside),before.assemblyPlan.steps.filter(outside));
  assert.deepEqual(after.instructionPlan.steps.filter(outside),before.instructionPlan.steps.filter(outside));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,before.assemblyPlan.stats.unresolvedBrickCount);
  assert.equal(after.sequenceRefinement,before.sequenceRefinement);
}

test('plans a late-connecting arch in complete courses without replaying unrelated failures',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'green':'tan'})]){
    const before=fragmentedArch(transform),frozen=structuredClone(before),after=refineOfflineRecipes(before);
    assert.equal(after.offlineRecipeRefinement.selected,true);
    assert.equal(after.offlineRecipeRefinement.beforeDiagrams,5);assert.equal(after.offlineRecipeRefinement.afterDiagrams,3);
    const layers=after.instructionPlan.steps.filter(s=>s.tableRecipe);
    assert.deepEqual(layers.map(s=>s.newBrickIds.length),[2,2,1]);
    const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b])),placed=[];
    const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
    for(const s of after.assemblyPlan.steps.filter(s=>s.moduleId==='arch'&&s.newBrickIds.length)){
      for(const id of s.newBrickIds){const b=byId.get(id);assert.ok(b.y===1||placed.some(p=>p.y===b.y-1&&overlap(p,b)));
        assert.ok(!placed.some(p=>p.y>b.y&&overlap(p,b)));placed.push(b);}
    }
    verifyPreservation(before,after);assert.deepEqual(before,frozen);assert.equal(refineOfflineRecipes(after),after);
  }
});

test('table guidance uses displayed completion and attachment numbers, including changed numbering',()=>{
  const after=refineOfflineRecipes(fragmentedArch()),plan=after.instructionPlan;
  const numbering={byStepId:new Map(plan.steps.map((s,i)=>[s.id,i+30]))};
  const layers=plan.steps.filter(s=>s.tableRecipe),join=plan.steps.find(s=>s.moduleId==='arch'&&s.kind==='join');
  assert.match(createStepGuidance(plan,layers[0],numbering).instruction,new RegExp(`through step ${numbering.byStepId.get(layers.at(-1).id)}`));
  assert.match(createStepGuidance(plan,layers[0],numbering).instruction,new RegExp(`in step ${numbering.byStepId.get(join.id)}`));
  assert.equal(createStepGuidance(plan,layers[1],numbering).instruction,'Complete this layer. Keep the section flat on the table.');
  assert.equal(createStepGuidance(plan,layers.at(-1),numbering).instruction,'Complete the top layer before attaching this section.');
});

test('preserves accepted actions, warned recipes, invalid joins, and upward placement boundaries',()=>{
  for(const protect of [r=>{r.instructionPlan.steps.find(s=>s.moduleId==='arch').instructionAction={id:'accepted',kind:'course'};},
    r=>{r.assemblyPlan.steps.find(s=>s.moduleId==='arch').issues=[{code:'temporary-hold'}];},
    r=>{r.assemblyPlan.steps.find(s=>s.moduleId==='arch'&&s.kind==='join').issues=[{code:'blocked-module-insertion'}];},
    r=>{r.assemblyPlan.steps.find(s=>s.moduleId==='arch').insertionDirection='up';}]){
    const before=fragmentedArch();protect(before);assert.equal(refineOfflineRecipes(before),before);
  }
});

test('rejects malformed diagram coverage and preserves already consolidated recipes',()=>{
  const before=fragmentedArch();before.instructionPlan.steps.find(s=>s.moduleId==='arch').newBrickIds=[];
  assert.equal(refineOfflineRecipes(before),before);
  const finished=refineOfflineRecipes(fragmentedArch());
  assert.equal(refineOfflineRecipes(finished),finished);
});
