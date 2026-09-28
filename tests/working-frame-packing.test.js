import test from'node:test';import assert from'node:assert/strict';
import{createAssemblyPlan}from'../src/assembly.js';import{recipeBrickId,rotateRecipeBrick}from'../src/assembly-recipes.js';import{discoverInvertedCore}from'../src/inverted-component-recipes.js';import{prepareAssemblyGuide}from'../src/prepare-assembly-guide.js';import{completeNestedDetachedComponents}from'../src/nested-detached-components.js';
function fixture(turn=0){
 const color=turn%2?'green':'blue',parts=[];
 for(let y=0;y<=1;y++)for(const z of[0,2])for(const x of[0,2,4,6])parts.push({owner:y?'body':'base',x,y,z,w:2,d:2,color:y?color:'black'});
 for(const z of[0,2])for(const[x,w]of[[0,2],[2,4],[6,2]])parts.push({owner:'body',x,y:2,z,w,d:2,color});
 for(const[x,w]of[[0,1],[1,2],[3,2],[5,2],[7,1]])parts.push({owner:'body',x,y:3,z:0,w,d:4,color});
 parts.push({owner:'detached',x:8,y:1,z:0,w:2,d:2,color},{owner:'detached',x:8,y:2,z:0,w:1,d:2,color:'white'});
 const moved=parts.map(({owner,...b})=>({...rotateRecipeBrick(b,turn),owner})).map(b=>({...b,x:b.x+20,z:b.z+20}));
 const brickModel={version:1,kind:'bricks',bricks:moved.map(({owner,...b})=>b)},byOwner=k=>moved.filter(b=>b.owner===k).map(({owner,...b})=>b),ids=k=>byOwner(k).map(recipeBrickId);
 const discovered=discoverInvertedCore(byOwner('body'));assert(discovered.candidate,JSON.stringify(discovered.attempts));
 const replay=['base','body','detached'].map(id=>({id,label:id,kind:id==='body'?'detail':id==='detached'?'floating':'grounded',brickIds:ids(id),brickOrder:ids(id),...(id==='body'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1}}:{})}));
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay,moduleRecipes:{body:discovered.candidate.recipe},allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
 const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),floating=new Set(ids('detached')),parent=before.assemblyPlan.modules.find(m=>m.id==='body');
 return before;
}
const cells=r=>r.brickModel.bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
for(let turn=0;turn<4;turn++)test(`repair respects inverted construction and upright finishing (${turn})`,()=>{
 const before=fixture(turn),snapshot=structuredClone(before),after=completeNestedDetachedComponents(before,{workingOrientation:true});
 assert(after.workingDetachedCompletion?.selected);assert.deepEqual(before,snapshot);
 assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,2);
 assert.deepEqual(cells(after),cells(before));
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 assert(after.assemblyPlan.steps.some(s=>s.nestedRecipe?.id==='body/finish'&&s.newBrickIds.length));
 assert.equal(completeNestedDetachedComponents(after,{workingOrientation:true}),after);
});
test('working repair preserves protected receivers and unsupported inputs',()=>{
 for(const field of ['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly']){
  const before=fixture();before.assemblyPlan.modules.find(m=>m.id==='body')[field]={id:'repeat'};
  assert.equal(completeNestedDetachedComponents(before,{workingOrientation:true}),before);
 }
 const before=fixture();delete before.assemblyPlan.moduleRecipes;
 assert.equal(completeNestedDetachedComponents(before,{workingOrientation:true}),before);
});
