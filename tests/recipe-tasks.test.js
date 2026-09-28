import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {replanRecipeTasks} from '../src/recipe-tasks.js';
import {regroupSupportedRun} from '../src/component-tasks.js';
import {discoverWorkAreaTasks} from '../src/work-area-tasks.js';

function fixture(turn=0,nested=false){
  const bs=[{x:0,y:0,z:0,w:2,d:4,color:'black'}];
  for(let x=0;x<6;x+=2)for(let z=0;z<8;z+=2)bs.push({x,y:1,z,w:2,d:2,color:'tan'});
  for(const [x,w]of [[0,1],[1,2],[3,2],[5,1]])for(let z=0;z<8;z+=2)bs.push({x,y:2,z,w,d:2,color:z===0?'blue':'tan'});
  for(let x=0;x<6;x+=2)for(const [z,d]of [[0,1],[1,2],[3,2],[5,2],[7,1]])bs.push({x,y:3,z,w:2,d,color:'red'});
  const moved=bs.map(b=>rotateRecipeBrick(b,turn)),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const brickModel={version:1,kind:'bricks',bricks:moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ,color:turn%2&&b.color==='blue'?'yellow':b.color}))};
  const identified=createAssemblyPlan({brickModel}).bricks,base=identified.filter(b=>b.y===0),parts=identified.filter(b=>b.y>0).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
  const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(b=>b.id),brickOrder:base.map(b=>b.id)},
    {id:'recipe',label:'Recipe',kind:'detail',groupType:'work-surface',brickIds:parts.map(b=>b.id),brickOrder:parts.map(b=>b.id),
      actionOrder:true,placementGroups:parts.map(b=>[b.id]),buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}}];
  let moduleRecipes;
  if(nested){
    const localModel={...brickModel,bricks:parts.map(({id,...b})=>({...b,y:b.y-1}))};
    const local=createAssemblyPlan({brickModel:localModel}).bricks.sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x),ids=local.map(b=>b.id);
    moduleRecipes={recipe:{moduleReplay:[{id:'child-body',label:'Body',kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:ids.map(id=>[id])}]}};
  }
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,...(moduleRecipes?{moduleRecipes}:{})});
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,id:`diagram-${s.id}`,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;

test('complete table courses preserve exact attachment and physical support across rotations',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=replanRecipeTasks(before);
  assert.ok(after.recipeTaskPlanning?.selected);assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length-10);
  assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.kind==='join'),before.assemblyPlan.steps.filter(s=>s.kind==='join'));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const by=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
  for(const s of after.assemblyPlan.steps.filter(s=>s.moduleId==='recipe'&&s.kind==='build')){
   const prior=s.visibleBrickIds.filter(id=>!s.newBrickIds.includes(id)).map(id=>by.get(id));
   for(const id of s.newBrickIds){const b=by.get(id);assert.ok(b.y===1||prior.some(p=>p.y===b.y-1&&overlap(p,b)));assert.ok(!prior.some(p=>p.y>b.y&&overlap(p,b)));}
  }
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
  const c=after.recipeTaskPlanning.changes[0];assert.ok(c.handlingAfter.peakLooseBrickCount<=c.handlingBefore.peakLooseBrickCount);assert.equal(c.handlingAfter.finalComponentCount,1);
  assert.deepEqual(replanRecipeTasks(after),after);
  const first=after.instructionPlan.steps.find(s=>s.moduleId==='recipe'&&s.kind==='build'),join=after.instructionPlan.steps.find(s=>s.moduleId==='recipe'&&s.kind==='join');
  assert.match(createStepGuidance(after.instructionPlan,first,{byStepId:new Map([[join.id,99]])}).instruction,/flat table.*step 99/);
 }
});

test('nested supported tasks retain floor anchors, exact child scope and final parent join',()=>{
 const before=fixture(1,true),after=replanRecipeTasks(before),by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
 assert.ok(after.recipeTaskPlanning?.selected);
 const floor=before.assemblyPlan.steps.filter(s=>s.nestedRecipe&&s.newBrickIds.some(id=>by.get(id).y===s.nestedRecipe.floorY));
 for(const s of floor)assert.deepEqual(after.assemblyPlan.steps.find(n=>n.id===s.id),s);
 const context=floor[0].nestedRecipe;
 assert.ok(after.assemblyPlan.steps.filter(s=>s.moduleId==='recipe'&&s.kind==='build').every(s=>JSON.stringify(s.nestedRecipe)===JSON.stringify(context)));
 assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.kind==='join'),before.assemblyPlan.steps.filter(s=>s.kind==='join'));
 assert.ok(after.assemblyPlan.steps.some(s=>s.id===context.firstStepId));
});

test('warning and upward operations do not become downward recipe tasks',()=>{
 for(const patch of [{issues:[{code:'temporary-hold',severity:'warning'}]},{insertionDirection:'up'}]){
  const r=fixture();for(const p of [r.assemblyPlan,r.instructionPlan])for(const s of p.steps)if(s.moduleId==='recipe'&&s.kind==='build')Object.assign(s,patch);
  assert.equal(replanRecipeTasks(r),r);
 }
});

test('caller cannot invent a table floor or erase mixed nested contexts',()=>{
 const r=fixture(),start=1,end=r.instructionPlan.steps.length-1;
 assert.equal(regroupSupportedRun(r,start,end,discoverWorkAreaTasks,()=>true,{tableFloor:0,minimumTaskReturns:0}),null);
 const nested=fixture(0,true);nested.instructionPlan.steps[15].nestedRecipe={...nested.instructionPlan.steps[15].nestedRecipe,id:'different-child'};
 assert.equal(regroupSupportedRun(nested,13,nested.instructionPlan.steps.length-1,discoverWorkAreaTasks,()=>true,{tableFloor:1,minimumTaskReturns:0,preserveNestedContext:true}),null);
});

test('changed module scopes can refresh stale grouping receipts without reconsidering other scopes',()=>{
 const before=fixture();before.recipeTaskPlanning={selected:true,changes:[]};
 const snapshot=structuredClone(before);
 assert.equal(replanRecipeTasks(before),before);
 assert.equal(replanRecipeTasks(before,{moduleIds:new Set()}),before);
 assert.equal(replanRecipeTasks(before,{moduleIds:new Set(['base'])}),before);
 const after=replanRecipeTasks(before,{moduleIds:new Set(['recipe'])});
 assert.ok(after.recipeTaskPlanning.changes.length);
 assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
 assert.deepEqual(after.instructionPlan.steps.filter(s=>s.moduleId!=='recipe'),before.instructionPlan.steps.filter(s=>s.moduleId!=='recipe'));
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 assert.deepEqual(before,snapshot);
});

test('component pacing never replaces the instruction to start separately and attach later',()=>{
 const r=fixture(),first=r.instructionPlan.steps.find(s=>s.moduleId==='recipe'),join=r.instructionPlan.steps.find(s=>s.kind==='join');
 first.componentTask={index:1,total:2,lastStepId:r.instructionPlan.steps[2].id};
 const numbering={byStepId:new Map([[first.componentTask.lastStepId,3],[join.id,99]])};
 const guidance=createStepGuidance(r.instructionPlan,first,numbering);
 assert.match(guidance.instruction,/Build this section separately on a flat table.*Attach it in step 99/);
 assert.doesNotMatch(guidance.instruction,/next area/);
});
