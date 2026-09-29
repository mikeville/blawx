import test from 'node:test';import assert from 'node:assert/strict';import {markMirroredAssemblies} from '../src/mirrored-assemblies.js';import {mapRecipe,rotateRecipeBrick} from '../src/assembly-recipes.js';import {createStepGuidance} from '../src/guide-step-guidance.js';
function fixture(turn=0,mirror=true){
 const source=[{id:'a',x:0,y:0,z:0,w:2,d:1,color:'blue'},{id:'b',x:0,y:0,z:1,w:1,d:1,color:'green'},{id:'c',x:1,y:0,z:1,w:1,d:1,color:'red'}];
 const target=source.map((b,i)=>({...rotateRecipeBrick(mirror?{...b,x:-b.x-b.w}:b,turn),id:'target-'+i})).map(b=>({...b,x:b.x+10}));
 const modules=[{id:'first',kind:'grounded',brickIds:source.map(b=>b.id)},{id:'second',kind:'grounded',brickIds:target.map(b=>b.id)}];
 const steps=modules.map((m,i)=>({id:'step-'+i,moduleId:m.id,kind:'build',newBrickIds:m.brickIds,highlightBrickIds:m.brickIds,visibleBrickIds:m.brickIds,issues:[]}));
 const plan={bricks:[...source,...target],modules,steps};return{assemblyPlan:plan,instructionPlan:plan};
}
test('mirrors retain their diagrams and receive an explicit introduction with displayed references',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=markMirroredAssemblies(before,new Set(['first','second']));
  assert.deepEqual(before,snapshot);assert.equal(after.assemblyPlan.modules[1].mirroredAssembly.sourceModuleId,'first');
  assert.deepEqual(after.instructionPlan.steps,before.instructionPlan.steps);
  const text=createStepGuidance(after.instructionPlan,after.instructionPlan.steps[1],{byStepId:new Map([['step-0',3],['step-1',4]])}).instruction;
  assert.match(text,/separate mirrored version.*step 3/);assert.match(text,/orientation shown here/);
 }
});
test('rotated copies and near-mirrors are not mislabeled as mirrored assemblies',()=>{
 const rotated=fixture(2,false);assert.equal(markMirroredAssemblies(rotated,new Set(['first','second'])),rotated);
 const different=fixture();different.assemblyPlan.bricks.at(-1).color='yellow';assert.equal(markMirroredAssemblies(different,new Set(['first','second'])),different);
});
