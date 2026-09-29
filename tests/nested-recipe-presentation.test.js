import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {prepareNestedRecipePresentation} from '../src/nested-recipe-presentation.js';
import {createBookletPresentation,createChapterDiagramData} from '../src/assembly-booklet-presentation.js';

function fixture(turn=0){
 const move=b=>rotateRecipeBrick({...b,color:turn%2&&b.color==='blue'?'red':b.color},turn);
 const base=[0,1,2].map(y=>move({x:3,y,z:0,w:2,d:2,color:'black'}));
 const core=[move({x:0,y:3,z:0,w:8,d:2,color:'green'})];
 const children=[0,6].map(x=>[1,2].map(y=>move({x,y,z:0,w:2,d:2,color:'blue'})));
 const parent=[...core,...children.flat()],local=bs=>bs.map(b=>recipeBrickId({...b,y:b.y-1}));
 const descriptor=(id,bricks,extra={})=>({id,label:id,kind:'grounded',brickIds:bricks.map(recipeBrickId),brickOrder:bricks.map(recipeBrickId),...extra});
 const options={brickModel:{version:1,kind:'bricks',bricks:[...base,...parent]},moduleReplay:[descriptor('base',base),descriptor('body',parent,{kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1}})],moduleRecipes:{body:{allowUnderAttachments:false,moduleReplay:[
  {id:'core',label:'Core',kind:'grounded',groupType:'table-root',brickIds:local(core),brickOrder:local(core),buildContext:{kind:'work-surface',floorY:2}},
  ...children.map((bs,i)=>({id:'child-'+i,label:'Child',kind:'detail',groupType:'work-surface',brickIds:local(bs),brickOrder:local(bs),buildContext:{kind:'work-surface',floorY:0,joinDirection:'up'}}))]}},allowUnderAttachments:false};
 const assemblyPlan=createAssemblyPlan(options);assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return {brickModel:options.brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('complete nested copies share one recipe and retain both actual attachments',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=prepareNestedRecipePresentation(before),view=createBookletPresentation(after);
  assert.deepEqual(before,snapshot);assert.equal(after.assemblyPlan,before.assemblyPlan);assert.equal(after.instructionPlan,before.instructionPlan);
  const repeats=view.presentation.sections.filter(s=>s.repeatCount>1);assert.equal(repeats.length,1);const section=repeats[0];assert.equal(section.repeatCount,2);assert.equal(section.brickIds.length,2);
  assert.equal(section.totalInventory.reduce((n,e)=>n+e.count,0),4);assert.ok(section.instances.every(i=>i.transform));
  assert.ok(section.instances.every(i=>view.numbering.byStepId.has(i.attachmentStepId)));
  assert.deepEqual(after.guide.sections.flatMap(s=>s.stepIds),before.instructionPlan.steps.map(s=>s.id));
  assert.deepEqual(JSON.parse(JSON.stringify(after.guide)),after.guide);
  assert.deepEqual(after.guide.sections.flatMap(s=>s.brickIds).sort(),before.instructionPlan.bricks.map(b=>b.id).sort());
  const data=createChapterDiagramData(section,view.plan,view.numbering);assert.match(data.specs[0].guidance.instruction,/Build 2 copies/);assert.match(data.specs[0].guidance.instruction,/Attach them in steps \d+, \d+/);
  assert.equal(view.numbering.diagramCount,createBookletPresentation(before).numbering.diagramCount-2);assert.equal(prepareNestedRecipePresentation(after),after);
 }
});

test('changed colors, operations, unresolved joins and external context prevent nested repetition',()=>{
 for(const mutate of [
  r=>{const s=r.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='body/child-1');r.instructionPlan.bricks.find(b=>b.id===s.newBrickIds[0]).color='yellow';},
  r=>{r.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='body/child-1').insertionDirection='up';},
  r=>{r.instructionPlan.steps.find(s=>s.kind==='join'&&s.nestedRecipe?.id==='body/child-1').issues.push({code:'blocked-module-insertion',severity:'error',brickIds:[]});},
  r=>{r.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='body/child-1').visibleBrickIds.push(r.instructionPlan.bricks[0].id);},
  r=>{r.instructionPlan.steps.find(s=>s.kind==='join'&&s.nestedRecipe?.id==='body/child-1').joinContext.supportGroups[0].contacts=[];},
 ]){const r=fixture();mutate(r);assert.equal(prepareNestedRecipePresentation(r),r);}
});

test('nested repetition preserves verified semantic boundaries and does not group unfinished children',()=>{
 const named=fixture();named.guide.sections.forEach(s=>{s.semanticConfidence='high';s.semanticLabel='Named component';});assert.equal(prepareNestedRecipePresentation(named),named);
 const absent=fixture();absent.instructionPlan.steps.find(s=>s.kind==='join'&&s.nestedRecipe?.id==='body/child-1').kind='unresolved';assert.equal(prepareNestedRecipePresentation(absent),absent);
});

test('semantic naming retains repeated recipes and their separate attachment references',async()=>{
 const {createSemanticGuideInput,applySemanticGuide}=await import('../src/semantic-guide.js');
 const r=prepareNestedRecipePresentation(fixture()),plan=r.instructionPlan,input=createSemanticGuideInput({plan,guide:r.guide,subject:'abstract frame'});
 assert.equal(input.protectedRanges.length,2);
 const ranges=[],by=new Map(plan.steps.map((s,i)=>[s.id,i]));let start=0;
 for(const protectedRange of input.protectedRanges){const a=by.get(protectedRange.startStepId),b=by.get(protectedRange.endStepId);if(start<a)ranges.push([start,a-1]);ranges.push([a,b]);start=b+1;}
 if(start<plan.steps.length)ranges.push([start,plan.steps.length-1]);
 const annotation={version:1,fingerprint:input.fingerprint,sections:ranges.map(([a,b])=>({startStepId:plan.steps[a].id,endStepId:plan.steps[b].id,label:'Component',confidence:'inferred',evidence:'Matching observed geometry.'}))};
 const semanticGuide=applySemanticGuide({plan,guide:r.guide,subject:'abstract frame',annotation});
 const view=createBookletPresentation({...r,semanticGuide}),repeated=view.presentation.sections.find(s=>s.repeatCount===2);
 assert.ok(repeated);assert.equal(repeated.label,'Component');assert.ok(repeated.instances.every(i=>view.numbering.byStepId.has(i.attachmentStepId)));
 assert.deepEqual(semanticGuide.sections.flatMap(s=>s.stepIds),plan.steps.map(s=>s.id));
 assert.match(createChapterDiagramData(repeated,plan,view.numbering).specs[0].guidance.instruction,/Build 2 copies/);
});
