import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {recipeWorkingFrame} from '../src/recipe-working-frame.js';
import {recipeReplay} from '../src/capture-recipes.js';
import {replayNestedRecipes} from '../src/replay-nested-recipes.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {createBookletPresentation,createChapterDiagramData} from '../src/assembly-booklet-presentation.js';
import {bookletViewerOptions} from '../src/assembly-booklet-renderer.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
import {discoverInvertedCore} from '../src/inverted-component-recipes.js';

function fixture(turn=0,blocked=false){
 const move=b=>rotateRecipeBrick({...b,color:turn%2?'blue':b.color},turn);
 const core=[{x:1,y:1,z:0,w:2,d:2,color:'red'},{x:0,y:2,z:0,w:4,d:2,color:'red'},
  {x:0,y:3,z:0,w:2,d:2,color:'red'},{x:2,y:3,z:0,w:2,d:2,color:'red'}].map(move);
 const main=[{x:0,y:0,z:0,w:4,d:2,color:'black'}];
 if(blocked){for(let y=0;y<4;y++)main.push({x:4,y,z:0,w:1,d:2,color:'black'});main.push({x:1,y:4,z:0,w:4,d:2,color:'black'});}
 const base=main.map(move),frame=recipeWorkingFrame({orientation:'inverted'},core,1),local=core.map(b=>({...frame.toLocal(b)})),groups=[0,1,2].map(y=>local.filter(b=>b.y===y).map(recipeBrickId)),ids=groups.flat();
 return {brickModel:{version:1,kind:'bricks',bricks:[...base,...core]},moduleReplay:[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(recipeBrickId),brickOrder:base.map(recipeBrickId)},
 {id:'core',label:'Section',kind:'detail',groupType:'work-surface',brickIds:core.map(recipeBrickId),brickOrder:core.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:1}}],moduleRecipes:{core:{orientation:'inverted',allowUnderAttachments:false,
 moduleReplay:[{id:'layers',label:'Layers',kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:ids.map(id=>[id])}],diagramGroups:groups}},allowUnderAttachments:false};
}
for(let turn=0;turn<4;turn++)test(`inverted core maps support, diagrams and exact serialized replay (${turn})`,()=>{
 const input=fixture(turn),snapshot=structuredClone(input),plan=createAssemblyPlan(input),builds=plan.steps.filter(s=>s.moduleId==='core'&&s.kind==='build');
 assert.deepEqual(input,snapshot);assert.equal(plan.stats.unresolvedBrickCount,0);assert(builds.every(s=>s.insertionDirection==='up'&&s.workingOrientation.surfaceY===4));
 const compacted=compactAssemblyPlan(plan),steps=compacted.plan.steps.filter(s=>s.moduleId==='core'&&s.kind==='build');assert.equal(steps.length,3);
 assert.equal(steps[0].newBrickIds.length,2);assert.deepEqual(compacted.plan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id));
 assert(compacted.plan.steps.flatMap(s=>s.orderedOperations).filter(s=>s.workingOrientation).every(s=>s.workingOrientation.kind==='inverted'));
 const data=JSON.parse(JSON.stringify(plan)),again=createAssemblyPlan({...input,moduleReplay:recipeReplay(data,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(data)});
 const signature=s=>[s.kind,s.newBrickIds,s.visibleBrickIds,s.insertionDirection??'down',s.workingOrientation??null,s.joinContext??null];assert.deepEqual(again.steps.map(signature),plan.steps.map(signature));
 const views=chooseInstructionSequence(compacted.plan);assert(steps.every(s=>views.get(s.id).passes&&!views.get(s.id).truncated));
});
test('the real external attachment still rejects an obstruction',()=>{
 const plan=createAssemblyPlan(fixture(0,true)),join=plan.steps.find(s=>s.moduleId==='core'&&!s.nestedRecipe);
 assert.equal(join.kind,'unresolved');assert(join.issues.some(i=>i.code==='blocked-module-insertion'));assert(plan.steps.filter(s=>s.nestedRecipe).every(s=>s.kind==='build'));
});
test('orientation cannot admit invalid recipes or mismatched coordinates',()=>{
 for(const mutate of [r=>r.orientation='sideways',r=>r.moduleReplay[0].kind='floating',r=>r.moduleRecipes={unexpected:{}},r=>r.moduleReplay[0].brickIds[0]='missing']){
  const input=fixture();mutate(input.moduleRecipes.core);assert.throws(()=>createAssemblyPlan(input));
 }
});
test('reader specs retain the real pose and give one turn-over cue',()=>{
 const assemblyPlan=createAssemblyPlan(fixture()),instructionPlan=compactAssemblyPlan(assemblyPlan).plan,guide=createGuideSections(instructionPlan),book=createBookletPresentation({assemblyPlan,instructionPlan,guide});
 const specs=book.presentation.sections.flatMap(s=>createChapterDiagramData(s,instructionPlan,book.numbering).specs),up=specs.filter(s=>s.workingOrientation);
 assert.equal(up.length,3);assert.match(up[0].guidance.instruction,/upside down/);assert(!up[1].guidance.instruction.includes('upside down'));
 const join=specs.find(s=>s.joinContext);assert.match(join.guidance.instruction,/Turn the completed section upright/);
 assert.equal(bookletViewerOptions(up[0],{}).workingOrientation.kind,'inverted');assert.equal(bookletViewerOptions(join,{}).workingOrientation,undefined);
});
test('stored diagrams do not mix poses or suppress error evidence',()=>{
 const original=createAssemblyPlan(fixture()),first=original.steps.find(s=>s.workingOrientation);
 for(const mutate of [s=>s.workingOrientation.surfaceY++,s=>s.issues.push({severity:'error',code:'unsupported-addition',brickIds:s.newBrickIds})]){
  const bad=structuredClone(original);mutate(bad.steps.find(s=>s.id===first.id));assert(!compactAssemblyPlan(bad).report.recipeDiagrams.some(r=>r.merged));
 }
});
test('bounded orientation discovery rejects a disconnected body and invalid search budgets',()=>{
 const bricks=Array.from({length:12},(_,i)=>({x:i%2*6,y:Math.floor(i/2),z:0,w:2,d:2,color:'blue'}));assert.equal(discoverInvertedCore(bricks).candidate,null);
 for(const maxChecks of [-1,5,Infinity])assert.throws(()=>discoverInvertedCore(bricks,{maxChecks}),/four/);
});

test('geometry discovery completes widening courses across rotations, colors and elevations',()=>{
 const shape=[... [0,2].map(z=>({x:2,y:0,z,w:2,d:2})),
  ...[0,2,4].map(x=>({x,y:1,z:0,w:2,d:4})),
  ...[0,2].flatMap(z=>[-1,1,3,5].map(x=>({x,y:2,z,w:2,d:2})))];
 for(let turn=0;turn<4;turn++){
  const bricks=shape.map(b=>rotateRecipeBrick({...b,y:b.y+7,color:turn%2?'yellow':'red'},turn));
  const snapshot=structuredClone(bricks),found=discoverInvertedCore(bricks).candidate;
  assert(found);assert.equal(found.floor,7);assert.equal(found.coreParts,13);
  assert.equal(found.finishParts,0);assert.equal(found.coreDiagrams,3);
  assert.equal(found.plan.stats.unresolvedBrickCount,0);assert.equal(found.plan.graph.components.length,1);
  assert.deepEqual(bricks,snapshot);
  const compacted=compactAssemblyPlan(found.plan).plan;
  assert.deepEqual(compacted.steps.map(s=>s.newBrickIds.length),[8,3,2]);
  assert(compacted.steps.every(s=>s.workingOrientation?.kind==='inverted'));
 }
});
