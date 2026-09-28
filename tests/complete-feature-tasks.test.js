import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeFeatureTasks,foundationAreas} from '../src/complete-feature-tasks.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';

function scatteredGuide(bricks){
 const brickModel={version:1,kind:'bricks',bricks};
 const base=createAssemblyPlan({brickModel,integratedBuild:true});
 assert.equal(base.stats.unresolvedBrickCount,0);
 const ids=[...base.bricks].sort((a,b)=>a.y-b.y||a.x-b.x||a.z-b.z).map(b=>b.id);
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[{id:'original',kind:'grounded',label:'Build',brickIds:ids,brickOrder:ids,placementGroups:ids.map(id=>[id]),actionOrder:true}],integratedBuild:true});
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}))};
 return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
function check(before,after){
 assert.equal(after.completeFeatureTasks?.selected,true);
 assert.deepEqual(after.brickModel,before.brickModel);
 assert.deepEqual(after.assemblyPlan.bricks,before.assemblyPlan.bricks);
 assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
 assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
 assert.deepEqual(completeFeatureTasks(after),after);
}
test('finish separate grounded components instead of batching their unrelated bottom layers',()=>{
 for(let turns=0;turns<4;turns++){
  const bricks=[];
  for(const x of [0,8,16])for(let y=0;y<4;y++)for(let z=0;z<4;z+=2)bricks.push({x,y,z,w:2,d:2,color:['tan','blue','red','green'][turns]});
  const before=scatteredGuide(bricks.map(b=>rotateRecipeBrick(b,turns))),snapshot=structuredClone(before),after=completeFeatureTasks(before);check(before,after);assert.deepEqual(before,snapshot);
  assert.equal(after.completeFeatureTasks.foundationAreas,3);
  const owner=new Map(after.assemblyPlan.bricks.map(b=>[b.id,turns%2?Math.floor(b.z/8):Math.floor(b.x/8)]));
  const visits=after.instructionPlan.steps.map(s=>new Set(s.newBrickIds.map(id=>owner.get(id))));
  assert.ok(visits.every(s=>s.size===1));
  const sequence=visits.map(s=>[...s][0]).filter((v,i,a)=>!i||v!==a[i-1]);assert.equal(new Set(sequence).size,sequence.length);
 }
});
test('keep contrasting insets with their supported feature and finish the common base first',()=>{
 const bricks=[];
 for(let x=0;x<12;x+=2)for(let z=0;z<4;z+=2)bricks.push({x,y:0,z,w:2,d:2,color:'tan'});
 for(let y=1;y<=4;y++)for(const x of [0,2,4,8,10])for(let z=0;z<4;z+=2)bricks.push({x,y,z,w:2,d:2,color:x===2&&z===0?'white':x<6?'blue':'red'});
 const before=scatteredGuide(bricks),after=completeFeatureTasks(before);check(before,after);
 const by=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
 const mixed=after.assemblyPlan.modules.find(m=>m.brickIds.some(id=>by.get(id).color==='white'));
 assert.deepEqual([...new Set(mixed.brickIds.map(id=>by.get(id).color))].sort(),['blue','white']);
 const first=after.assemblyPlan.modules[0];assert.ok(first.brickIds.every(id=>by.get(id).y===0));
});
test('work-area contact joins side-adjacent ground and stud-connected courses, but excludes distant islands',()=>{
 const a={x:0,y:0,z:0,w:2,d:2},b={...a,x:2},c={...a,y:1},d={...a,x:10};
 assert.deepEqual(foundationAreas([a,b,c,d]).map(x=>x.length),[3,1]);
 assert.equal(foundationAreas([a,{...a,y:2}]).length,2);
});
test('leave a guide without a low foundation or separate starting areas untouched',()=>{
 const bricks=Array.from({length:8},(_,y)=>({x:0,y,z:0,w:2,d:2,color:'red'}));
 const before=scatteredGuide(bricks);assert.equal(completeFeatureTasks(before),before);
});
