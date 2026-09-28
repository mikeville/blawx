import test from'node:test';import assert from'node:assert/strict';
import{createAssemblyPlan}from'../src/assembly.js';import{recipeBrickId,rotateRecipeBrick}from'../src/assembly-recipes.js';import{compactAssemblyPlan}from'../src/assembly-diagrams.js';import{createGuideSections}from'../src/guide-sections.js';import{completeFoundationRecipes,discoverFoundationRecipes}from'../src/complete-foundation-recipes.js';import{createBookletPresentation}from'../src/assembly-booklet-presentation.js';
function fixture(turn=0,overhang=false){
 const transform=b=>({...rotateRecipeBrick(b,turn),color:turn%2&&b.color==='blue'?'red':b.color});
 const lower=x=>[{x,y:0,z:0,w:1,d:2,color:'black'},{x:x+7,y:0,z:0,w:2,d:2,color:'black'}].map(transform);
 const core=x=>[...[0,2,4,6].map(dx=>({x:x+dx,y:1,z:0,w:2,d:2,color:'blue'})),...[{x,w:3},{x:x+3,w:2},{x:x+5,w:3}].map(b=>({...b,y:2,z:0,d:2,color:'blue'})),{x:x+(overhang?7:3),y:3,z:0,w:overhang?6:1,d:2,color:'blue'}].map(transform);
 const left=core(0),right=core(15),feet=[...lower(0),...lower(15)],edge=[transform({x:23,y:1,z:0,w:1,d:2,color:'black'})],ids=bs=>bs.map(recipeBrickId);
 const module=(id,bs,kind,groupType,context)=>({id,label:id,kind,groupType,brickIds:ids(bs),brickOrder:ids(bs),...(context?{buildContext:context}:{})});
 const brickModel={version:1,kind:'bricks',bricks:[...feet,...left,...edge,...right]},assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[module('feet',feet,'grounded'),module('left',left,'detail','work-surface',{kind:'work-surface',floorY:1}),module('edge',edge,'grounded','continuation'),module('right',right,'detail','work-surface',{kind:'work-surface',floorY:1})],preferLocalProgress:true,preferLocalFoundations:true});
 const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
for(let turn=0;turn<4;turn++)test(`complete each independent platform with its own underside, rotation ${turn}`,()=>{
 const before=fixture(turn),snapshot=structuredClone(before),proposals=discoverFoundationRecipes(before);assert.equal(proposals.length,2);assert.deepEqual(proposals.map(p=>p.lower.length),[2,2]);assert.deepEqual(proposals.map(p=>p.finish.length),[0,1]);
 const after=completeFoundationRecipes(before);assert.deepEqual(before,snapshot);assert.ok(after.foundationRecipes?.selected,JSON.stringify(after.foundationRecipes));assert.deepEqual(after.brickModel,before.brickModel);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);assert.equal(after.assemblyPlan.modules.length,2);assert.ok(createBookletPresentation(after).numbering.diagramCount<createBookletPresentation(before).numbering.diagramCount);
 const steps=after.assemblyPlan.steps,firstLast=steps.findLastIndex(s=>s.moduleId==='left'),secondFirst=steps.findIndex(s=>s.moduleId==='right');assert.equal(secondFirst,firstLast+1);const by=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));for(const proposal of proposals){const own=steps.filter(s=>s.moduleId===proposal.moduleId),foot=own.findIndex(s=>s.newBrickIds.some(id=>proposal.lower.includes(id))),upper=own.findIndex(s=>s.newBrickIds.some(id=>by.get(id).y===3));assert.ok(foot>=0&&upper>foot,'finish the underside before starting the upper structure');if(proposal.finish.length)assert.ok(own.findIndex(s=>s.newBrickIds.some(id=>proposal.finish.includes(id)))<upper);}assert.equal(completeFoundationRecipes(after),after);
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
});
test('semantic and repeated assemblies retain their protected boundaries',()=>{
 const before=fixture();assert.equal(completeFoundationRecipes({...before,semanticGuide:{}}).foundationRecipes,undefined);
 for(const m of before.assemblyPlan.modules)m.recipeFamily={id:'protected'};
 assert.deepEqual(discoverFoundationRecipes(before),[]);assert.equal(completeFoundationRecipes(before),before);
});

test('completing a foundation preserves existing upper support warnings',()=>{
 const before=fixture(0,true),after=completeFoundationRecipes(before);
 const warnings=r=>r.assemblyPlan.steps.flatMap(s=>s.issues).filter(i=>i.code==='limited-support').map(JSON.stringify).sort();
 assert.equal(warnings(before).length,2);assert.ok(after.foundationRecipes?.selected,JSON.stringify(after.foundationRecipes));assert.deepEqual(warnings(after),warnings(before));assert.deepEqual(after.brickModel,before.brickModel);
});
