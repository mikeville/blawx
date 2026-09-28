import test from 'node:test';
import assert from 'node:assert/strict';
import {detachedRoofFixture} from './helpers/detached-roof-fixture.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {recipeReplay} from '../src/capture-recipes.js';
import {recipeBrickId} from '../src/assembly-recipes.js';
import {completeNestedDetachedComponents} from '../src/nested-detached-components.js';
import {contactCells} from '../src/local-interface-repair.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
const cells=bs=>bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
function fixture(turn=0,options={}){
 const r=detachedRoofFixture(turn,options),roof=r.assemblyPlan.modules.find(m=>m.id==='roof'),parts=r.assemblyPlan.bricks.filter(b=>roof.brickIds.includes(b.id)),floor=roof.buildContext.floorY;
 const local=parts.map(b=>({...b,y:b.y-floor})),ids=local.map(recipeBrickId);
 const moduleRecipes={roof:{moduleReplay:[{id:'course',label:'Roof',kind:'grounded',brickIds:ids,brickOrder:ids}]}};
 const assemblyPlan=createAssemblyPlan({brickModel:r.brickModel,moduleReplay:recipeReplay(r.assemblyPlan,{preservePlacements:true}),moduleRecipes});
 return prepareAssemblyGuide({...r,assemblyPlan,metrics:{conversionMs:0}});
}
test('complete detached trim inside a nested receiver across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=completeNestedDetachedComponents(before);
  assert(after.nestedDetachedCompletion?.selected,JSON.stringify(after.nestedDetachedCompletion));assert.deepEqual(before,snapshot);
  assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,1);
  assert.deepEqual(cells(after.brickModel.bricks),cells(before.brickModel.bricks));
  const joins=r=>r.assemblyPlan.steps.filter(s=>s.kind==='join'&&s.moduleId==='roof'&&!s.nestedRecipe);
  assert.equal(joins(after).length,1);assert.deepEqual(contactCells(before.assemblyPlan,joins(before)[0]),contactCells(after.assemblyPlan,joins(after)[0]));
  const later=r=>r.instructionPlan.steps.filter(s=>s.moduleId==='later').map(s=>[s.newBrickIds,s.kind,s.issues]);assert.deepEqual(later(after),later(before));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const views=chooseInstructionSequence(after.instructionPlan);assert(after.instructionPlan.steps.filter(s=>s.moduleId==='roof'&&s.kind==='build').every(s=>views.get(s.id).passes));
  assert.equal(completeNestedDetachedComponents(after),after);
 }
});
test('preserve no-op inputs, exact colors and protected repeated receivers',()=>{
 const plain=detachedRoofFixture();assert.equal(completeNestedDetachedComponents(plain),plain);
 const recolored=fixture(0,{recolor:true});assert.equal(completeNestedDetachedComponents(recolored),recolored);
 for(const field of ['sharedHandledRecipe','recipeFamily','repeatContinuation','mirroredAssembly']){
  const r=fixture();r.assemblyPlan.modules.find(m=>m.id==='roof')[field]={id:'protected'};assert.equal(completeNestedDetachedComponents(r),r);
 }
 const complete=fixture();complete.assemblyPlan.stats.unresolvedBrickCount=0;assert.equal(completeNestedDetachedComponents(complete),complete);
});

function nestedFixture(turn){
 const original=detachedRoofFixture(turn),by=new Map(original.assemblyPlan.bricks.map(b=>[b.id,b]));
 const shifted=original.assemblyPlan.bricks.map(b=>({...b,y:b.y+1})),byOriginal=new Map(original.assemblyPlan.bricks.map((b,i)=>[b.id,shifted[i]]));
 const base=original.assemblyPlan.modules.find(m=>m.id==='base').brickIds.map(id=>by.get(id));
 const body=original.assemblyPlan.modules.filter(m=>['base','roof'].includes(m.id)).flatMap(m=>m.brickIds.map(id=>byOriginal.get(id)));
 const brickModel={version:1,kind:'bricks',bricks:[...base,...shifted]};
 const replay=[{id:'foundation',label:'Foundation',kind:'grounded',brickIds:base.map(recipeBrickId),brickOrder:base.map(recipeBrickId)},
  {id:'body',label:'Body',kind:'detail',groupType:'work-surface',brickIds:body.map(recipeBrickId),brickOrder:body.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:1}},
  ...original.assemblyPlan.modules.filter(m=>!['base','roof'].includes(m.id)).map(m=>{const ids=m.brickIds.map(id=>recipeBrickId(byOriginal.get(id)));return {...m,brickIds:ids,brickOrder:ids,actionOrder:false,placementGroups:undefined};})];
 const local=original.assemblyPlan.modules.filter(m=>['base','roof'].includes(m.id)).map(m=>({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,brickIds:m.brickIds,brickOrder:m.brickIds,...(m.buildContext?{buildContext:m.buildContext}:{})}));
 const roof=original.assemblyPlan.modules.find(m=>m.id==='roof').brickIds.map(id=>by.get(id)),roofIds=roof.map(b=>recipeBrickId({...b,y:b.y-1}));
 const moduleRecipes={body:{moduleReplay:local,moduleRecipes:{roof:{moduleReplay:[{id:'course',label:'Surface',kind:'grounded',brickIds:roofIds,brickOrder:roofIds}]}}}};
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes});return prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}});
}
test('repair descends through two recipe levels and preserves the earlier nested foundation',()=>{
 for(let turn=0;turn<4;turn++){
  const before=nestedFixture(turn),after=completeNestedDetachedComponents(before);assert(after.nestedDetachedCompletion?.selected);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,before.assemblyPlan.stats.unresolvedBrickCount-2);
  assert.deepEqual(cells(after.brickModel.bricks),cells(before.brickModel.bricks));
  const base=r=>r.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='body/base').map(s=>[s.kind,s.newBrickIds,s.visibleBrickIds,s.issues]);assert.deepEqual(base(after),base(before));
  assert(after.assemblyPlan.moduleRecipes.body.moduleRecipes.roof);
 }
});
