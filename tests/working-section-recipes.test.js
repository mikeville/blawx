import test from 'node:test';
import assert from 'node:assert/strict';
import {splitWorkingComponents} from '../src/working-component-cuts.js';
import {discoverWorkingSections} from '../src/working-section-recipes.js';
import {completeWorkingSections} from '../src/complete-working-sections.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';

function joinedChains(){
 const ids=Array.from({length:18},(_,i)=>String(i));
 const edges=[];
 for(const offset of[0,9])for(let i=0;i<8;i++)edges.push({a:ids[offset+i],b:ids[offset+i+1],studs:4});
 edges.push({a:'8',b:'9',studs:1});
 return{bricks:ids.map((id,i)=>({id,color:i<9?'blue':'yellow'})),graph:{edges},
  steps:[{insertionDirection:'up',visibleBrickIds:[...ids.slice(0,8),...ids.slice(10)]}]};
}
test('working cut keeps already connected seeds whole and separates the weak interface',()=>{
 const plan=joinedChains(),snapshot=structuredClone(plan);
 for(const sameMaterialWeight of[1,100]){
  const found=splitWorkingComponents(plan,{sameMaterialWeight});
  assert(found);assert.equal(found.cutStuds,1);assert.deepEqual(found.groups.map(g=>g.length),[9,9]);
  assert.deepEqual(found.groups.flat().sort(),plan.bricks.map(b=>b.id).sort());
 }
 assert.deepEqual(plan,snapshot);
});
test('a working cut requires two substantial separate seeds',()=>{
 const plan=joinedChains();plan.steps[0].visibleBrickIds=plan.bricks.map(b=>b.id);
 assert.equal(splitWorkingComponents(plan),null);
 plan.steps[0].visibleBrickIds=['0','17'];assert.equal(splitWorkingComponents(plan),null);
});
test('whole-section exploration stays bounded and leaves completed guides alone',()=>{
 for(const bricks of[[],Array(513).fill({x:0,y:0,z:0,w:2,d:2,color:'blue'})])
  assert.deepEqual(discoverWorkingSections(bricks),{attempts:[],candidates:[]});
 const brickModel={version:1,kind:'bricks',bricks:[{x:0,y:0,z:0,w:2,d:4,color:'blue'}]};
 const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel}),metrics:{conversionMs:0}});
 assert.equal(completeWorkingSections(before),before);
});
