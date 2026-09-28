import test from 'node:test';import assert from 'node:assert/strict';
import {handledPanelFixture as fixture} from './helpers/handled-panel-fixture.js';
import {discoverSharedHandledRecipes,shareHandledRecipes} from '../src/shared-handled-recipes.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';
const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();

test('identical handled shapes reuse one recipe while retaining both attachments across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),saved=structuredClone(before);assert.equal(discoverSharedHandledRecipes(before).length,2);
  const after=shareHandledRecipes(before);assert.ok(after.sharedHandledRecipes?.selected,JSON.stringify(after.sharedHandledRecipes?.attempts.map(a=>a.reasons)));
  assert.deepEqual(before,saved);assert.deepEqual(cells(after.brickModel.bricks),cells(before.brickModel.bricks));assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const family=new Set(['panel-0','panel-1']),steps=after.assemblyPlan.steps,firstJoin=steps.findIndex(s=>s.kind==='join');
  assert.ok(steps.every((s,i)=>!family.has(s.moduleId)||s.kind!=='build'||i<firstJoin));
  assert.equal(steps.filter(s=>s.kind==='join').length,2);assert.ok(steps.filter(s=>s.kind==='join').every(s=>!s.issues.length));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),steps.map(s=>s.id));
  assert.deepEqual(steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  for(const id of family)assert.ok(steps.some(s=>s.moduleId===id&&s.issues.some(i=>i.code==='temporary-hold')));
  const p=createBookletPresentation(after),repeat=p.presentation.sections.find(s=>s.repeatCount===2);
  assert.ok(repeat);
  const first=after.instructionPlan.steps.find(s=>s.id===repeat.stepIds[0]),intro=createStepGuidance(after.instructionPlan,first,p.numbering);assert.match(intro.instruction,/Build 2 copies.*Attach them in steps/);assert.match(intro.warning,/stability has not been verified/);
  const attachments=after.instructionPlan.steps.filter(s=>s.kind==='join');assert.match(createStepGuidance(after.instructionPlan,attachments[0],p.numbering).instruction,/one of/);assert.match(createStepGuidance(after.instructionPlan,attachments[1],p.numbering).instruction,/remaining/);
  assert.equal(repeat.totalInventory.reduce((n,v)=>n+v.count,0),repeat.brickIds.length*2);
  const by=new Map(after.instructionPlan.steps.map(s=>[s.id,s]));assert.ok(repeat.stepIds.every(id=>by.get(id).kind==='build'));
  assert.equal(p.presentation.sections.flatMap(s=>s.stepIds).filter(id=>by.get(id).kind==='join').length,2);
  assert.ok(p.presentation.sections.filter(s=>s.brickIds.length===0).every(s=>s.label==='Attach assemblies'));
  assert.deepEqual(shareHandledRecipes(after),after);
 }
});

test('different geometry, invalid attachment, nested context and intervening work cannot declare a shared recipe',()=>{
 for(const variant of ['color','failed-join','nested','intervening']){
  const r=fixture();
  if(variant==='color')r.assemblyPlan.bricks.find(b=>r.assemblyPlan.modules[2].brickIds.includes(b.id)).color='red';
  if(variant==='failed-join')r.assemblyPlan.steps.find(s=>s.kind==='join').issues=[{code:'blocked-module-insertion',severity:'error',brickIds:[]}];
  if(variant==='nested')r.assemblyPlan.steps.find(s=>s.moduleId==='panel-0').nestedRecipe={id:'child'};
  if(variant==='intervening')r.assemblyPlan.modules.splice(2,0,{id:'other',kind:'grounded',brickIds:[]});
  assert.deepEqual(discoverSharedHandledRecipes(r),[]);
  assert.equal(shareHandledRecipes(r),r);
 }
});

test('repeat projection refuses attachments hidden in a recipe or dependencies on assembled context',()=>{
 const accepted=shareHandledRecipes(fixture());assert.ok(accepted.sharedHandledRecipes?.selected);
 for(const variant of ['late-build','external-context','failed-join','missing-marker']){
  const r=structuredClone(accepted),steps=r.instructionPlan.steps;
  if(variant==='late-build'){const join=steps.findIndex(s=>s.kind==='join'),second=steps.findIndex(s=>s.moduleId==='panel-1');const [moved]=steps.splice(join,1);steps.splice(second,0,moved);}
  if(variant==='external-context')steps.find(s=>s.moduleId==='panel-0').visibleBrickIds.push(r.assemblyPlan.modules[0].brickIds[0]);
  if(variant==='failed-join')steps.find(s=>s.kind==='join').issues=[{code:'blocked-module-insertion',severity:'error',brickIds:[]}];
  if(variant==='missing-marker')delete r.instructionPlan.modules.find(m=>m.id==='panel-1').sharedHandledRecipe;
  r.guide=createGuideSections(r.instructionPlan);
  const p=createBookletPresentation(r);assert.ok(!p.presentation.sections.some(s=>s.repeatCount>1&&s.moduleIds.includes('panel-0')),variant);
 }
});

test('sharing a later recipe preserves the completion reference of an earlier table diagram',()=>{
 const before=fixture(),first=before.instructionPlan.steps[0];
 first.id='earlier-table-recipe';
 first.tableRecipe={ordinal:1,total:1,completionStepId:first.id};
 before.guide=createGuideSections(before.instructionPlan);
 const after=shareHandledRecipes(before);assert.ok(after.sharedHandledRecipes?.selected);
 const retained=after.instructionPlan.steps.find(s=>s.tableRecipe);
 assert.deepEqual(retained.newBrickIds,first.newBrickIds);
 assert.equal(retained.tableRecipe.completionStepId,retained.id);
 assert.notEqual(retained.id,first.id);
});
