import test from 'node:test';import assert from 'node:assert/strict';import {replayNestedRecipes} from '../src/replay-nested-recipes.js';import {recipeBrickId} from '../src/assembly-recipes.js';
function fixture(){
 const bricks=[{x:0,y:4,z:0,w:2,d:2,color:'red'},{x:0,y:5,z:0,w:2,d:2,color:'blue'}].map(b=>({...b,id:recipeBrickId(b)}));
 const local=bricks.map(b=>recipeBrickId({...b,y:b.y-4}));
 return {bricks,modules:[{id:'parent',buildContext:{kind:'work-surface',floorY:4}}],moduleRecipes:{parent:{moduleReplay:[{id:'child',brickIds:local,brickOrder:[...local].reverse(),kind:'grounded'}]}},
  steps:bricks.map(b=>({nestedRecipe:{id:'parent/child'},newBrickIds:[b.id],issues:[]}))};
}
test('nested replay follows executed operation order in the parent table coordinates',()=>{
 const before=fixture(),snapshot=structuredClone(before),recipes=replayNestedRecipes(before),child=recipes.parent.moduleReplay[0];
 assert.deepEqual(before,snapshot);assert.deepEqual(child.brickOrder,child.brickIds);assert.deepEqual(child.placementGroups,child.brickIds.map(id=>[id]));assert.equal(child.actionOrder,true);
});
test('incomplete or failed child operations cannot replace a stored recipe',()=>{
 for(const mutate of [p=>p.steps.pop(),p=>p.steps[0].issues.push({severity:'error'}),p=>p.steps[0].newBrickIds.push(p.steps[0].newBrickIds[0])]){
  const before=fixture();mutate(before);assert.deepEqual(replayNestedRecipes(before),before.moduleRecipes);
 }
});

test('a strength advisory preserves executed order without trusting old placement validity',()=>{
 const before=fixture();before.steps[1].issues=[{code:'limited-support',severity:'warning',brickIds:before.steps[1].newBrickIds}];
 const snapshot=structuredClone(before),recipes=replayNestedRecipes(before),child=recipes.parent.moduleReplay[0];
 assert.deepEqual(before,snapshot);assert.deepEqual(child.brickOrder,child.brickIds);assert.equal(child.actionOrder,true);
 assert.equal(child.issues,undefined);assert.equal(child.valid,undefined);
 for(const issue of [{code:'limited-support',severity:'error'},{code:'temporary-hold',severity:'warning'}]){
  before.steps[1].issues=[issue];assert.deepEqual(replayNestedRecipes(before),before.moduleRecipes);
 }
});
