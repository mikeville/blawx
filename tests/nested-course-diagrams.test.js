import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {completeNestedCourseDiagrams} from '../src/nested-course-diagrams.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';

function fixture(turn=0,{pattern=false}={}) {
 const transform=b=>rotateRecipeBrick(b,turn);
 const floor=Array.from({length:16},(_,x)=>({x,y:0,z:0,w:1,d:2,color:pattern&&x%2?'white':'blue'}));
 const layer=[0,4,8,12].map(x=>({x,y:1,z:0,w:4,d:2,color:'blue'}));
 const bond=[{x:0,y:2,z:0,w:2,d:2,color:'blue'},...[2,6,10].map(x=>({x,y:2,z:0,w:4,d:2,color:'blue'})),{x:14,y:2,z:0,w:2,d:2,color:'blue'}];
 const local=[...floor,...layer,...bond].map(transform),base=Array.from({length:4},(_,x)=>transform({x:x*4,y:0,z:0,w:4,d:2,color:'tan'})),parent=local.map(b=>({...b,y:b.y+1}));
 const ids=local.map(recipeBrickId),brickModel={version:1,kind:'bricks',bricks:[...base,...parent]},groups=ids.map(id=>[id]);
 const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(recipeBrickId),brickOrder:base.map(recipeBrickId)},
 {id:'parent',label:'Parent',kind:'detail',groupType:'work-surface',brickIds:parent.map(recipeBrickId),brickOrder:parent.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:1}}];
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,moduleRecipes:{parent:{moduleReplay:[{id:'body',label:'Body',kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:groups}]}},integratedBuild:true});
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues}]}))};
 return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('complete nested courses preserve every physical operation, attachment and rotation',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=completeNestedCourseDiagrams(before);
  assert(after.completeNestedCourseDiagrams);assert.deepEqual(before,snapshot);
  assert.equal(after.assemblyPlan,before.assemblyPlan);assert.equal(after.brickModel,before.brickModel);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),before.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.orderedOperations),before.instructionPlan.steps.flatMap(s=>s.orderedOperations));
  assert.deepEqual(after.instructionPlan.steps.filter(s=>s.kind==='join'),before.instructionPlan.steps.filter(s=>s.kind==='join'));
  const merged=after.instructionPlan.steps.filter(s=>s.completedCourse);assert.deepEqual(merged.map(s=>s.newBrickIds.length),[16,4,5]);
  const views=chooseInstructionSequence(after.instructionPlan);assert(merged.every(s=>views.get(s.id)?.passes));
  assert.equal(completeNestedCourseDiagrams(after),after);
 }
});

test('semantic and deliberately annotated tasks keep their existing boundaries',()=>{
 const named=fixture();named.semanticGuide=named.guide;assert.equal(completeNestedCourseDiagrams(named),named);
 for(const key of ['instructionAction','tableRecipe','placementTask','groundLayout','buildRegion']){
  const before=fixture();for(const s of before.instructionPlan.steps.filter(s=>s.nestedRecipe))s[key]={kind:'deliberate'};
  assert.equal(completeNestedCourseDiagrams(before),before);
 }
 const ordinary=fixture();for(const s of ordinary.instructionPlan.steps){delete s.nestedRecipe;delete s.nestedRecipePath;}
 assert.equal(completeNestedCourseDiagrams(ordinary),ordinary);
});

test('warnings interrupt a course and prevent partial completion claims',()=>{
 const before=fixture(),floor=before.instructionPlan.steps.filter(s=>s.nestedRecipe&&s.newBrickIds.some(id=>before.instructionPlan.bricks.find(b=>b.id===id).y===1));
 floor[7].issues=[{code:'limited-support',severity:'warning',brickIds:floor[7].newBrickIds}];
 const after=completeNestedCourseDiagrams(before);assert(after.completeNestedCourseDiagrams);
 assert(!after.instructionPlan.steps.some(s=>s.completedCourse?.course===1));
 assert.deepEqual(after.instructionPlan.steps.find(s=>s.id===floor[7].id),floor[7]);
});

test('many contrasting islands do not become one visually simple course',()=>{
 const before=fixture(0,{pattern:true}),after=completeNestedCourseDiagrams(before);
 assert(!after.instructionPlan.steps.some(s=>s.completedCourse?.course===1));
});

test('complete layers retain explicit table setup and a full placement map',async()=>{
 const {createStepGuidance}=await import('../src/guide-step-guidance.js');
 const {createBookletPresentation}=await import('../src/assembly-booklet-presentation.js');
 const result=completeNestedCourseDiagrams(fixture()),book=createBookletPresentation(result),step=result.instructionPlan.steps.find(s=>s.completedCourse);
 const guidance=createStepGuidance(result.instructionPlan,step,book.numbering);
 assert.match(guidance.instruction,/flat table/);assert.match(guidance.instruction,/Complete this layer/);
 assert.equal(guidance.map.bricks.filter(b=>b.added).length,step.newBrickIds.length);
 assert.equal(guidance.mapLabel,'Layer layout');
});
