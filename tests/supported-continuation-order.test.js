import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverSupportedContinuations,scheduleSupportedContinuations} from '../src/supported-continuation-order.js';
import {consolidateThinWallDiagrams} from '../src/thin-wall-diagrams.js';

function fixture(turn=0,{dependent=false}={}){
 const tagged=[{owner:'base',x:0,y:0,z:0,w:4,d:2,color:'black'},
  ...[1,2].map(y=>({owner:'held',x:0,y,z:0,w:2,d:2,color:'red'})),
  ...[1,2,3].map(y=>({owner:'side',x:dependent?0:2,y:dependent?y+2:y,z:0,w:2,d:2,color:turn%2?'green':'blue'}))]
  .map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner}));
 const brickModel={version:1,kind:'bricks',bricks:tagged.map(({owner,...b})=>b)},identified=createAssemblyPlan({brickModel}).bricks;
 const owner=b=>tagged.find(t=>t.x===b.x&&t.y===b.y&&t.z===b.z).owner;
 const moduleReplay=['base','held','side'].map(id=>({id,label:id,kind:id==='held'?'detail':'grounded',brickIds:identified.filter(b=>owner(b)===id).map(b=>b.id),
  ...(id==='held'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1}}:id==='side'?{groupType:'continuation'}:{})}));
 for(const module of moduleReplay)module.brickOrder=[...module.brickIds];
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay}),compacted=compactAssemblyPlan(assemblyPlan);
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 return{brickModel,assemblyPlan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan)};
}
for(let turn=0;turn<4;turn++)test(`finish supported work before an unrelated assembly (${turn})`,()=>{
 const before=fixture(turn),snapshot=structuredClone(before),proposed=discoverSupportedContinuations(before);
 assert.equal(proposed.length,1);assert.deepEqual(proposed[0].dependencies,['base']);
 const after=scheduleSupportedContinuations(before);assert(after.supportedContinuationScheduling?.selected);
 assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
 assert.deepEqual(after.assemblyPlan.modules.map(m=>m.id),['base','side','held']);
 assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 const contacts=r=>r.assemblyPlan.steps.filter(s=>s.kind==='join').map(s=>s.joinContext.supportGroups.flatMap(g=>g.contacts));
 assert.deepEqual(contacts(after),contacts(before));assert.equal(scheduleSupportedContinuations(after),after);
});
test('a continuation that depends on the handled assembly stays after it',()=>{
 const before=fixture(0,{dependent:true});assert.deepEqual(discoverSupportedContinuations(before),[]);
 assert.equal(scheduleSupportedContinuations(before),before);
});
test('warnings, semantic boundaries and repeated assemblies remain protected',()=>{
 for(const type of ['warning','repeat','semantic']){
  const before=fixture();
  if(type==='warning')before.assemblyPlan.steps.find(s=>s.moduleId==='side').issues.push({code:'limited-support',severity:'warning'});
  if(type==='repeat')before.assemblyPlan.modules.find(m=>m.id==='side').recipeFamily='repeat';
  if(type==='semantic')before.semanticGuide={};
  assert.equal(scheduleSupportedContinuations(before),before);
 }
});
function wall(disconnected=false){
 const bricks=Array.from({length:6},(_,y)=>({x:0,y,z:0,w:1,d:4,color:'blue'}));
 if(disconnected)for(let y=0;y<6;y++)bricks.push({x:0,y,z:8,w:1,d:4,color:'blue'});
 const brickModel={version:1,kind:'bricks',bricks},p=createAssemblyPlan({brickModel});
 const order=[...p.bricks].sort((a,b)=>a.y-b.y||a.z-b.z);
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[{id:'wall',label:'Wall',kind:'grounded',brickIds:order.map(b=>b.id),brickOrder:order.map(b=>b.id),actionOrder:true,placementGroups:order.map(b=>[b.id])}]});
 const steps=assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}));
 return{brickModel,assemblyPlan,instructionPlan:{...assemblyPlan,steps},guide:createGuideSections({...assemblyPlan,steps})};
}
test('thin wall consolidation retains literal operations and course order',()=>{
 const before=wall(),snapshot=structuredClone(before),{result,changes}=consolidateThinWallDiagrams(before,'wall');
 assert(changes.length);assert.deepEqual(before,snapshot);assert.equal(result.instructionPlan.steps.length,2);
 for(const field of ['sourceStepIds','orderedOperations','newBrickIds'])assert.deepEqual(result.instructionPlan.steps.flatMap(s=>s[field]),before.instructionPlan.steps.flatMap(s=>s[field]));
 assert.equal(result.assemblyPlan,before.assemblyPlan);
});
test('disconnected strips cannot be combined into a wall task',()=>{
 const before=wall(true),{result,changes}=consolidateThinWallDiagrams(before,'wall');assert.deepEqual(changes,[]);assert.equal(result,before);
});
