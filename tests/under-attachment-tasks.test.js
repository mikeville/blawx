import {retainUnchangedDiagrams} from '../src/preserve-instruction-diagrams.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {consolidateUnderAttachmentTasks} from '../src/under-attachment-tasks.js';
import {createBookletPresentation,createChapterDiagramData} from '../src/assembly-booklet-presentation.js';
import {bookletViewerOptions} from '../src/assembly-booklet-renderer.js';
import {createAssemblyJoinPreview} from '../src/assembly-join-preview.js';

function fixture(turn=0) {
  const move=b=>rotateRecipeBrick({...b,color:turn%2&&b.color==='blue'?'red':b.color},turn);
  const base=[0,1,2].map(y=>move({x:3,y,z:0,w:2,d:2,color:'black'}));
  const core=[move({x:0,y:3,z:0,w:8,d:2,color:'green'})];
  const children=[0,6].map(x=>[move({x,y:2,z:0,w:2,d:2,color:'blue'})]);
  const parent=[...core,...children.flat()],local=bs=>bs.map(b=>recipeBrickId({...b,y:b.y-2}));
  const descriptor=(id,bricks,extra={})=>({id,label:id,kind:'grounded',brickIds:bricks.map(recipeBrickId),brickOrder:bricks.map(recipeBrickId),...extra});
  const brickModel={version:1,kind:'bricks',bricks:[...base,...parent]};
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[descriptor('base',base),descriptor('body',parent,{kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:2}})],moduleRecipes:{body:{allowUnderAttachments:false,moduleReplay:[
    {id:'core',label:'Core',kind:'grounded',groupType:'table-root',brickIds:local(core),brickOrder:local(core),buildContext:{kind:'work-surface',floorY:1}},
    ...children.map((bs,i)=>({id:'child-'+i,label:'Child',kind:'detail',groupType:'work-surface',brickIds:local(bs),brickOrder:local(bs),buildContext:{kind:'work-surface',floorY:0,joinDirection:'up'}}))
  ]}},allowUnderAttachments:false});
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
const joins=r=>r.instructionPlan.steps.filter(s=>s.joinContext?.direction==='up');

test('independent underside placements form one task with exact physical operations across rotations',()=>{
  for(let turn=0;turn<4;turn++) {
    const r=fixture(turn),snapshot=structuredClone(r),after=consolidateUnderAttachmentTasks(r);
    assert.deepEqual(r,snapshot);assert.equal(after.assemblyPlan,r.assemblyPlan);assert.equal(after.brickModel,r.brickModel);
    assert.equal(after.instructionPlan.steps.length,r.instructionPlan.steps.length-1);
    for(const key of ['newBrickIds','sourceStepIds','orderedOperations']) assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s[key]),r.instructionPlan.steps.flatMap(s=>s[key]));
    const task=after.instructionPlan.steps.find(s=>s.attachmentTask);assert.ok(task);assert.equal(task.attachmentTask.placements.length,2);
    assert.equal(task.nestedRecipe,undefined);assert.equal(task.joinContext.supportGroups[0].contacts.length,2);
    assert.equal(consolidateUnderAttachmentTasks(after),after);
    const view=createBookletPresentation(after),spec=view.presentation.sections.flatMap(s=>createChapterDiagramData(s,view.plan,view.numbering).specs).find(s=>s.attachmentTask);
    assert.match(spec.guidance.instruction,/one at a time/);assert.doesNotMatch(spec.guidance.instruction,/completed assembly/);
    assert.equal(spec.parts.reduce((n,p)=>n+p.count,0),2);
    assert.equal(bookletViewerOptions(spec,{}).attachmentTask,task.attachmentTask);
    assert.equal(createAssemblyJoinPreview({model:{...r.brickModel,bricks:after.instructionPlan.bricks},highlightIds:new Set(task.highlightBrickIds),joinContext:task.joinContext}).active,false,'separate pieces must never move as one disconnected assembly');
    assert.deepEqual(after.guide.sections.flatMap(s=>s.stepIds),after.instructionPlan.steps.map(s=>s.id));
  }
});

test('dependent, failed, differently scoped or unproven placements retain separate diagrams',()=>{
  for(const mutate of [
    r=>{joins(r)[1].issues.push({code:'blocked-insertion'});},
    r=>{joins(r)[1].insertionDirection='down';},
    r=>{joins(r)[1].nestedRecipePath=[{id:'other-parent'},joins(r)[1].nestedRecipe];},
    r=>{joins(r)[1].joinContext.supportGroups[0].contacts[0].supportBrickId=joins(r)[0].newBrickIds[0];},
    r=>{joins(r)[1].visibleBrickIds.pop();},
    r=>{joins(r)[0].orderedOperations=[];},
    r=>{r.semanticGuide={sections:[]};},
    r=>{r.guide.sections.forEach(s=>{s.semanticLabel="Named assembly";s.semanticConfidence="high";});},
    r=>{joins(r)[1].joinContext.supportGroups[0].contacts[0].studs=99;},
    r=>{r.instructionPlan.graph={...r.instructionPlan.graph,edges:[]};joins(r)[0].joinContext.supportGroups[0].brickIds.push(r.instructionPlan.bricks[0].id);},
  ]) {
    const r=fixture();mutate(r);assert.equal(consolidateUnderAttachmentTasks(r),r);
  }
});


test('preserving a combined attachment does not give it one constituent child scope',()=>{
 const before=consolidateUnderAttachmentTasks(fixture());
 const after=retainUnchangedDiagrams(before,fixture());
 const expected=before.instructionPlan.steps.find(s=>s.attachmentTask),actual=after.instructionPlan.steps.find(s=>s.attachmentTask);
 assert.ok(actual);assert.equal(actual.nestedRecipe,undefined);assert.equal(actual.nestedRecipePath,undefined);
 assert.deepEqual(actual.attachmentTask,expected.attachmentTask);assert.deepEqual(actual.joinContext,expected.joinContext);
 assert.deepEqual(actual.newBrickIds,expected.newBrickIds);
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
});


test('an inline child attachment retains its final join scope rather than its inner build scope',()=>{
 const before=fixture(),diagram=before.instructionPlan.steps.find(s=>s.kind==='join'&&s.nestedRecipe?.separate&&s.newBrickIds.length);
 const build=before.assemblyPlan.steps.find(s=>s.id===diagram.sourceStepIds[0]);
 build.nestedRecipePath=[build.nestedRecipe,{...build.nestedRecipe,id:build.nestedRecipe.id+'/inner',separate:false}];
 build.nestedRecipe=build.nestedRecipePath.at(-1);
 const after=retainUnchangedDiagrams(before,structuredClone(before));
 const actual=after.instructionPlan.steps.find(s=>s.newBrickIds[0]===diagram.newBrickIds[0]);
 assert.deepEqual(actual.nestedRecipe,diagram.nestedRecipe);assert.deepEqual(actual.nestedRecipePath,diagram.nestedRecipePath);
});
