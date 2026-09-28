import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {replanRecipeFloors,replanSupportedRecipeCourses} from '../src/recipe-tasks.js';
import {regroupSupportedRun} from '../src/component-tasks.js';
import {discoverWorkAreaTasks} from '../src/work-area-tasks.js';

function fixture(turn=0,nested=true) {
  const bs=[{x:0,y:0,z:0,w:2,d:4,color:'black'}];
  for(let x=0;x<8;x+=2)for(let z=0;z<12;z+=2)bs.push({x,y:1,z,w:2,d:2,color:x===0?'blue':'tan'});
  for(const [x,w]of [[0,1],[1,2],[3,2],[5,2],[7,1]])for(let z=0;z<12;z+=2)bs.push({x,y:2,z,w,d:2,color:'tan'});
  for(let x=0;x<8;x+=2)for(const [z,d]of [[0,1],[1,2],[3,2],[5,2],[7,2],[9,2],[11,1]])bs.push({x,y:3,z,w:2,d,color:'red'});
  const moved=bs.map(b=>rotateRecipeBrick(b,turn)),x=Math.min(...moved.map(b=>b.x)),z=Math.min(...moved.map(b=>b.z));
  const brickModel={version:1,kind:'bricks',bricks:moved.map(b=>({...b,x:b.x-x,z:b.z-z,color:turn&&b.color==='blue'?'yellow':b.color}))};
  const identified=createAssemblyPlan({brickModel}).bricks,base=identified.filter(b=>b.y===0),parts=identified.filter(b=>b.y>0).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
  const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(b=>b.id),brickOrder:base.map(b=>b.id)},
    {id:'table',label:'Table',kind:'detail',groupType:'work-surface',brickIds:parts.map(b=>b.id),brickOrder:parts.map(b=>b.id),
      actionOrder:true,placementGroups:parts.map(b=>[b.id]),buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}}];
  let moduleRecipes;
  if(nested){const local=createAssemblyPlan({brickModel:{...brickModel,bricks:parts.map(({id,...b})=>({...b,y:b.y-1}))}}).bricks.sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x),ids=local.map(b=>b.id);
    moduleRecipes={table:{moduleReplay:[{id:'child',label:'Child',kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:ids.map(id=>[id])}]}};}
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,...(moduleRecipes?{moduleRecipes}:{})});
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,id:`diagram-${s.id}`,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
const withoutFirst=step=>step.nestedRecipe?{...step,nestedRecipe:Object.fromEntries(Object.entries(step.nestedRecipe).filter(([k])=>k!=='firstStepId'))}:step;

test('flat nested floors consolidate across rotations and refresh canonical scope anchors',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=replanRecipeFloors(before);
  assert.ok(after.recipeFloorPlanning?.selected);assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  const changes=after.recipeFloorPlanning.changes;assert.equal(changes.length,1);assert.equal(changes[0].tasks.flat().length,24);
  assert.equal(changes[0].beforeDiagrams,24);assert.ok(changes[0].afterDiagrams<=2);
  const first=after.assemblyPlan.steps.find(s=>s.nestedRecipe),oldFirst=before.assemblyPlan.steps.find(s=>s.nestedRecipe);
  assert.notEqual(first.id,oldFirst.id);
  for(const plan of [after.assemblyPlan,after.instructionPlan])for(const s of plan.steps.filter(s=>s.nestedRecipe))assert.equal(s.nestedRecipe.firstStepId,first.id);
  const replaced=new Set(changes[0].oldSourceStepIds);
  for(const s of before.assemblyPlan.steps)if(!replaced.has(s.id))assert.deepEqual(withoutFirst(after.assemblyPlan.steps.find(n=>n.id===s.id)),withoutFirst(s));
  assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.kind==='join'),before.assemblyPlan.steps.filter(s=>s.kind==='join'));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.ok(changes[0].handlingAfter.peakLooseBrickCount<=changes[0].handlingBefore.peakLooseBrickCount);
  assert.equal(changes[0].handlingAfter.firstBondAtAddition,changes[0].handlingBefore.firstBondAtAddition);
  assert.equal(replanRecipeFloors(after),after);
 }
});

test('explicit flat table layers can change while multi-course table recipes remain protected',()=>{
 for(const layerTask of [true,false]){
  const r=fixture(0,false),by=new Map(r.assemblyPlan.bricks.map(b=>[b.id,b]));
  for(const plan of [r.assemblyPlan,r.instructionPlan])for(const s of plan.steps)if(s.newBrickIds.some(id=>by.get(id).y===1))s.tableRecipe={layerTask,ordinal:1,total:3,completionStepId:r.assemblyPlan.steps.at(-2).id};
  const after=replanRecipeFloors(r);
  if(layerTask)assert.ok(after.recipeFloorPlanning?.selected);else assert.equal(after,r);
 }
});

test('a flat-table override cannot waive a real floor, mixed heights or child scope',()=>{
 const r=fixture(),by=new Map(r.assemblyPlan.bricks.map(b=>[b.id,b]));
 const first=r.instructionPlan.steps.findIndex(s=>s.newBrickIds.some(id=>by.get(id).y===1)),end=r.instructionPlan.steps.findIndex(s=>s.newBrickIds.some(id=>by.get(id).y===2));
 const options={flatTableCourse:true,minimumTaskReturns:0,preserveNestedContext:true,tableFloor:1};
 assert.equal(regroupSupportedRun(r,first,end,discoverWorkAreaTasks,()=>true,{...options,tableFloor:0}),null);
 assert.equal(regroupSupportedRun(r,first,end+1,discoverWorkAreaTasks,()=>true,options),null);
 const mixed=structuredClone(r);mixed.instructionPlan.steps[first+1].nestedRecipe.id='another-child';
 assert.equal(regroupSupportedRun(mixed,first,end,discoverWorkAreaTasks,()=>true,options),null);
});

test('warning-bearing or upward floor tasks are never reclassified as table layout',()=>{
 for(const patch of [{issues:[{severity:'warning',code:'hold-required'}]},{insertionDirection:'up'}]){
  const r=fixture(),by=new Map(r.assemblyPlan.bricks.map(b=>[b.id,b]));
  for(const plan of [r.assemblyPlan,r.instructionPlan])for(const s of plan.steps)if(s.newBrickIds.some(id=>by.get(id).y===1))Object.assign(s,patch);
  assert.equal(replanRecipeFloors(r),r);
 }
});

test('changed module scopes can refresh stale grouping receipts without reconsidering other scopes',()=>{
 const before=fixture();before.recipeFloorPlanning={selected:true,changes:[]};
 const snapshot=structuredClone(before);
 assert.equal(replanRecipeFloors(before),before);
 assert.equal(replanRecipeFloors(before,{moduleIds:new Set()}),before);
 assert.equal(replanRecipeFloors(before,{moduleIds:new Set(['base'])}),before);
 const after=replanRecipeFloors(before,{moduleIds:new Set(['table'])});
 assert.ok(after.recipeFloorPlanning.changes.length);
 assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
 assert.deepEqual(after.instructionPlan.steps.filter(s=>s.moduleId!=='table'),before.instructionPlan.steps.filter(s=>s.moduleId!=='table'));
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 assert.deepEqual(before,snapshot);
});

test('regrouped nested floors retain and refresh every enclosing recipe scope',()=>{
 const before=fixture(),oldFirst=before.assemblyPlan.steps.find(s=>s.nestedRecipe).id;
 for(const plan of [before.assemblyPlan,before.instructionPlan])for(const step of plan.steps)if(step.nestedRecipe){
  step.nestedRecipePath=[{...step.nestedRecipe,id:'enclosing/table',separate:true},step.nestedRecipe];
 }
 const after=replanRecipeFloors(before);
 assert.ok(after.recipeFloorPlanning?.selected);
 const first=after.assemblyPlan.steps.find(s=>s.nestedRecipe).id;assert.notEqual(first,oldFirst);
 for(const plan of [after.assemblyPlan,after.instructionPlan])for(const step of plan.steps)if(step.nestedRecipe){
  assert.equal(step.nestedRecipePath.length,2);
  assert.ok(step.nestedRecipePath.every(scope=>scope.firstStepId===first));
  assert.equal(step.nestedRecipePath[0].id,'enclosing/table');
 }
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
});

function smallFloor(turn,separated){
 const parts=[{x:0,y:0,z:0,w:2,d:4,color:'black'}];
 for(const x of separated?[0,2,6,8]:[0,2,4,6])for(const z of [0,2])parts.push({x,y:1,z,w:2,d:2,color:x%4?'blue':'red'});
 if(separated){
  for(const [x,w]of [[0,3],[3,4],[7,3]])for(const z of [0,2])parts.push({x,y:2,z,w,d:2,color:'green'});
  for(const x of [0,2,4,6,8])parts.push({x,y:3,z:0,w:2,d:4,color:'green'});
 }else{
  for(const x of [0,2,4,6])parts.push({x,y:2,z:0,w:2,d:4,color:'green'});
  for(const [x,w]of [[0,1],[1,2],[3,2],[5,2],[7,1]])for(const z of [0,2])parts.push({x,y:3,z,w,d:2,color:'green'});
 }
 const brickModel={version:1,kind:'bricks',bricks:parts.map(b=>({...rotateRecipeBrick(b,turn),color:turn%2&&b.color==='red'?'yellow':b.color}))};
 const identified=createAssemblyPlan({brickModel}).bricks,base=identified.filter(b=>b.y===0).map(b=>b.id),table=identified.filter(b=>b.y>0).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x).map(b=>b.id);
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[
  {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'table',label:'Table',kind:'detail',groupType:'work-surface',brickIds:table,brickOrder:table,actionOrder:true,
   placementGroups:table.map(id=>[id]),buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}},
 ]});
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('small flat courses consolidate within each connected region without merging separated layouts',()=>{
 for(let turn=0;turn<4;turn++)for(const separated of [false,true]){
  const before=smallFloor(turn,separated),snapshot=structuredClone(before),after=replanRecipeFloors(before);
  assert.ok(after.recipeFloorPlanning?.selected);
  const [change]=after.recipeFloorPlanning.changes;
  assert.equal(change.beforeDiagrams,8);assert.equal(change.afterDiagrams,separated?2:1);
  assert.deepEqual(change.tasks.map(t=>t.length),separated?[4,4]:[8]);
  assert.equal(change.handlingAfter.peakLooseBrickCount,change.handlingBefore.peakLooseBrickCount);
  assert.equal(change.handlingAfter.firstBondAtAddition,change.handlingBefore.firstBondAtAddition);
  assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.kind==='join'),before.assemblyPlan.steps.filter(s=>s.kind==='join'));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.deepEqual(before,snapshot);
 }
});


test('supported recipe courses finish spatial layers across colors, rotations and nested scopes',()=>{
 for(let turn=0;turn<4;turn++)for(const nested of [false,true]){
  const before=fixture(turn,nested),snapshot=structuredClone(before),after=replanSupportedRecipeCourses(before);
  assert.ok(after.supportedRecipeCoursePlanning?.selected);
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  const changes=after.supportedRecipeCoursePlanning.changes;
  assert.deepEqual(changes.map(c=>c.course),[2,3]);
  assert.ok(changes.every(c=>c.afterDiagrams<c.beforeDiagrams));
  assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.kind==='join'),before.assemblyPlan.steps.filter(s=>s.kind==='join'));
  const replaced=new Set(changes.flatMap(c=>c.oldSourceStepIds));
  for(const s of before.assemblyPlan.steps)if(!replaced.has(s.id))assert.deepEqual(after.assemblyPlan.steps.find(n=>n.id===s.id),s);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  const by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
  const supportMap=plan=>plan.steps.flatMap(s=>s.newBrickIds.map(id=>{
   const b=by.get(id);return [id,s.visibleBrickIds.filter(p=>!s.newBrickIds.includes(p)).map(p=>by.get(p))
    .filter(p=>p.y===b.y-1&&p.x<b.x+b.w&&b.x<p.x+p.w&&p.z<b.z+b.d&&b.z<p.z+p.d).map(p=>p.id).sort()];
  })).sort((a,b)=>a[0].localeCompare(b[0]));
  assert.deepEqual(supportMap(after.assemblyPlan),supportMap(before.assemblyPlan));
  assert.equal(replanSupportedRecipeCourses(after),after);
  assert.equal(replanSupportedRecipeCourses(before,{moduleIds:new Set(['base'])}),before);
 }
});

test('supported course grouping does not cross warnings, mixed heights, missing supports or nested scope',()=>{
 const before=fixture(),by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
 const start=before.instructionPlan.steps.findIndex(s=>s.newBrickIds.some(id=>by.get(id).y===2));
 const end=before.instructionPlan.steps.findIndex(s=>s.newBrickIds.some(id=>by.get(id).y===3));
 const options={supportedCourse:true,minimumTaskReturns:0,preserveNestedContext:true,tableFloor:1};
 assert.equal(regroupSupportedRun(before,start,end+1,discoverWorkAreaTasks,()=>true,options),null);
 assert.equal(regroupSupportedRun(before,start,end,discoverWorkAreaTasks,()=>true,{...options,tableFloor:2}),null);
 const mixed=structuredClone(before);mixed.instructionPlan.steps[start+1].nestedRecipe.id='another-child';
 assert.equal(regroupSupportedRun(mixed,start,end,discoverWorkAreaTasks,()=>true,options),null);
 const missing=structuredClone(before);
 for(const plan of [missing.assemblyPlan,missing.instructionPlan])for(const s of plan.steps)s.visibleBrickIds=s.visibleBrickIds.filter(id=>by.get(id).y!==1);
 assert.equal(regroupSupportedRun(missing,start,end,discoverWorkAreaTasks,()=>true,options),null);
 for(const patch of [{issues:[{severity:'warning',code:'hold-required'}]},{insertionDirection:'up'},{tableRecipe:{ordinal:1,total:2}},{instructionAction:{kind:'extend-layer',destination:{kind:'layer',ordinal:1,total:3}}}]){
  const r=structuredClone(before);
  for(const plan of [r.assemblyPlan,r.instructionPlan])for(const s of plan.steps)if(s.newBrickIds.some(id=>by.get(id).y>1))Object.assign(s,patch);
  assert.equal(replanSupportedRecipeCourses(r),r);
 }
});
