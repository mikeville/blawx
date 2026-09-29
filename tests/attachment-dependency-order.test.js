import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverAttachmentDependencies,planAttachmentDependency,scheduleAttachmentDependencies} from '../src/attachment-dependency-order.js';

function fixture(turn=0,{dependent=false,ordinary=false}={}){
  const tagged=[{owner:'base',x:0,y:0,z:0,w:dependent?2:4,d:2,color:'black'},
    {owner:'arch',x:0,y:1,z:0,w:dependent?4:2,d:2,color:'red'},
    {owner:'arch',x:0,y:2,z:0,w:2,d:2,color:'red'},
    {owner:'arch',x:0,y:3,z:0,w:4,d:2,color:'red'},
    ...[...(dependent?[]:[1]),2].map(y=>({owner:'insert',x:2,y,z:0,w:2,d:2,color:turn%2?'yellow':'blue'}))]
    .map(b=>rotateRecipeBrick(b,turn));
  const brickModel={version:1,kind:'bricks',bricks:tagged.map(({owner,...b})=>b)};
  const moduleReplay=['base','arch','insert'].map(id=>{
    const bs=tagged.filter(b=>b.owner===id),ids=bs.map(recipeBrickId);
    return{id,label:id,kind:id==='base'?'grounded':'detail',brickIds:ids,brickOrder:ids,
      ...(id!=='base'&&!(ordinary&&id==='insert')?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:Math.min(...bs.map(b=>b.y))}}:{})};
  });
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true}),instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

for(let turn=0;turn<4;turn++)test(`attach a complete workpiece before its insertion path closes (${turn})`,()=>{
  const before=fixture(turn),snapshot=structuredClone(before),proposals=discoverAttachmentDependencies(before);
  assert.equal(proposals.length,1);assert.deepEqual(proposals[0].blockers,['arch']);assert.deepEqual(proposals[0].receivers,['base']);
  const after=scheduleAttachmentDependencies(before);assert(after.attachmentDependencyScheduling?.selected,JSON.stringify(after.attachmentDependencyScheduling));
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  assert.deepEqual(after.assemblyPlan.modules.map(m=>m.id),['base','insert','arch']);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.instructionPlan.steps.length,before.instructionPlan.steps.length);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const buildGroups=r=>r.instructionPlan.steps.filter(s=>s.kind==='build').map(s=>[s.moduleId,[...s.newBrickIds].sort()]).sort();
  assert.deepEqual(buildGroups(after),buildGroups(before));assert.equal(scheduleAttachmentDependencies(after),after);
});

test('do not move a workpiece before its receiving assembly exists',()=>{
  const before=fixture(0,{dependent:true});assert.deepEqual(discoverAttachmentDependencies(before),[]);
  assert.equal(scheduleAttachmentDependencies(before),before);
  assert.throws(()=>planAttachmentDependency(before,{moduleId:'insert',from:2,to:1,contextIds:before.assemblyPlan.bricks.map(b=>b.id)}),/safely resolve/);
});

test('semantic boundaries and repeated work remain protected',()=>{
  for(const field of['semantic','target-repeat','crossed-repeat']){
    const before=fixture();
    if(field==='semantic')before.semanticGuide={};
    else before.assemblyPlan.modules.find(m=>m.id===(field==='target-repeat'?'insert':'arch')).recipeFamily='protected';
    assert.equal(scheduleAttachmentDependencies(before),before);
  }
});

test('other attachment failures cannot be hidden by an earlier ordering',()=>{
  const before=fixture();before.assemblyPlan.steps.find(s=>s.moduleId==='insert'&&s.kind==='unresolved').issues.push({code:'no-stud-engagement',severity:'error',brickIds:[]});
  assert.deepEqual(discoverAttachmentDependencies(before),[]);
});

test('an ordinary handled repair gets an explicit table recipe and real attachment contacts',()=>{
  const before=fixture(0,{ordinary:true}),after=scheduleAttachmentDependencies(before);
  assert(after.attachmentDependencyScheduling.selected);
  assert.equal(after.assemblyPlan.modules.find(m=>m.id==='insert').buildContext.kind,'work-surface');
  const join=after.instructionPlan.steps.find(s=>s.moduleId==='insert'&&s.kind==='join');
  assert(join.joinContext.supportGroups.flatMap(g=>g.contacts).length);
  assert(!after.assemblyPlan.steps.filter(s=>s.moduleId==='insert').some(s=>s.issues.some(i=>i.code==='temporary-hold')));
  assert(after.instructionPlan.steps.length<=before.instructionPlan.steps.length);
});
