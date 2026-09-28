import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {completeGroundedComponents} from '../src/complete-grounded-components.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverGroundedComponentRecipes} from '../src/grounded-component-recipes.js';

function fixture(turn=0) {
 const bricks=[];
 for(const x of [0,12]){
  for(const dx of [0,2,4])for(const z of [0,2])bricks.push({x:x+dx,y:0,z,w:2,d:2,color:'black'});
  for(const dx of [0,2,4])bricks.push({x:x+dx,y:1,z:0,w:2,d:4,color:'black'});
  for(const dx of [0,3])for(const z of [0,2])bricks.push({x:x+dx,y:2,z,w:3,d:2,color:'black'});
  const side=x===0?0:16;
  bricks.push({x:side,y:3,z:0,w:2,d:4,color:'black'},
   {x:x===0?0:14,y:4,z:0,w:4,d:2,color:'black'},
   {x:side,y:5,z:0,w:2,d:2,color:'black'});
 }
 for(const [x,w]of [[2,4],[6,4],[10,3],[13,3]])bricks.push({x,y:3,z:0,w,d:2,color:'lightGray'});
 for(const [x,w]of [[4,4],[8,4],[12,2]])bricks.push({x,y:4,z:0,w,d:2,color:'lightGray'});
 const brickModel={version:1,kind:'bricks',bricks:bricks.map(b=>({...rotateRecipeBrick(b,turn),color:turn%2?(b.color==='black'?'red':'green'):b.color}))};
 const identified=createAssemblyPlan({brickModel}).bricks,ids=identified.map(b=>b.id);
 return createAssemblyPlan({brickModel,moduleReplay:[{id:'lower',label:'Lower assembly',kind:'grounded',brickIds:ids,brickOrder:ids}]});
}

test('grounded recipe ownership captures the entire blocking column across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const plan=fixture(turn),snapshot=structuredClone(plan),proposals=discoverGroundedComponentRecipes(plan);
  assert.equal(proposals.length,1);const p=proposals[0],by=new Map(plan.bricks.map(b=>[b.id,b]));
  assert.deepEqual(p.cores.map(c=>c.length),[14,14]);assert.equal(p.receiver.length,11);
  assert.equal(p.captured.length,4);assert.deepEqual(p.captured.map(id=>by.get(id).y).sort(),[4,4,5,5]);
  assert.deepEqual([...p.cores.flat(),...p.receiver,...p.remaining].sort(),plan.bricks.map(b=>b.id).sort());
  assert.ok(p.cores.every(core=>core.some(id=>by.get(id).y===0)));
  assert.deepEqual(plan,snapshot);
 }
});

test('shared handled work and existing repeated foundations are protected',()=>{
 const plan=fixture(),ids=plan.bricks.filter(b=>b.color==='lightGray').map(b=>b.id),remaining=plan.bricks.filter(b=>!ids.includes(b.id)).map(b=>b.id);
 const protectedPlan={...plan,modules:[{...plan.modules[0],brickIds:remaining},{id:'shared',kind:'detail',brickIds:ids,buildContext:{kind:'work-surface',floorY:3}}]};
 assert.deepEqual(discoverGroundedComponentRecipes(protectedPlan),[]);
 const repeated=structuredClone(plan);repeated.modules[0].recipeFamily='existing';
 assert.deepEqual(discoverGroundedComponentRecipes(repeated),[]);
});

test('discovery remains bounded and cannot claim a single foundation is repeated',()=>{
 const plan=fixture();assert.deepEqual(discoverGroundedComponentRecipes(plan,{maxCandidates:0}),[]);
 assert.deepEqual(discoverGroundedComponentRecipes(plan,{maxParts:10}),[]);
 const brickModel={version:1,kind:'bricks',bricks:plan.bricks.filter(b=>b.x<6).map(({id,...b})=>b)};
 assert.deepEqual(discoverGroundedComponentRecipes(createAssemblyPlan({brickModel})),[]);
 assert.deepEqual(discoverGroundedComponentRecipes(null),[]);
});


test('completion preserves an already compact guide when separate recipes add fragmentation',()=>{
 for(let turn=0;turn<4;turn++){
  const assemblyPlan=fixture(turn),brickModel={version:1,kind:'bricks',bricks:assemblyPlan.bricks.map(({id,...b})=>b)};
  const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),snapshot=structuredClone(before);
  const after=completeGroundedComponents(before);
  assert.equal(after.groundedComponentPlanning?.selected,false);
  assert.deepEqual(after.groundedComponentPlanning.attempts[0].reasons,['Component completion fragments the guide']);
  for(const key of ['brickModel','assemblyPlan','instructionPlan','guide'])assert.deepEqual(after[key],before[key]);
  assert.deepEqual(before,snapshot);
 }
});
