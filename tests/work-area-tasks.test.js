import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverWorkAreaTasks,replanWorkAreaTasks} from '../src/work-area-tasks.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
function fixture(turn=0){
  const bricks=[];
  for(let x=0;x<12;x+=2)for(let z=0;z<4;z+=2)bricks.push({x,y:0,z,w:2,d:2,color:'darkGray'});
  for(let y=1;y<=4;y++)for(const x of [0,8])for(const dx of [0,2])for(const z of [0,2])
    bricks.push({x:x+dx,y,z,w:2,d:2,color:dx===0&&z===0?'blue':'white'});
  const moved=bricks.map(b=>rotateRecipeBrick(b,turn)),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const brickModel={kind:'bricks',version:1,bricks:moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ,color:turn%2&&b.color==='blue'?'orange':b.color}))};
  const raw=createAssemblyPlan({brickModel,integratedBuild:true});assert.equal(raw.stats.unresolvedBrickCount,0);
  const visible=[],steps=[];let n=0;
  for(let y=0;y<=4;y++)for(const color of [...new Set(raw.bricks.filter(b=>b.y===y).map(b=>b.color))]){
    const ids=raw.bricks.filter(b=>b.y===y&&b.color===color).map(b=>b.id);visible.push(...ids);
    steps.push({id:`source-${++n}`,moduleId:raw.modules[0].id,kind:'build',label:'Build',issues:[],
      newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:[...visible],insertionDirection:'down',
      ...(y?{instructionAction:{id:`old-action-${n}`,kind:'feature'},buildRegion:{id:'old-shared-area'}}:{groundLayout:{ordinal:1,total:1}})});
  }
  const assemblyPlan={...raw,steps,stats:{...raw.stats,stepCount:steps.length}};
  const instructionPlan={...assemblyPlan,steps:steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[s]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('reconsiders color actions and shared region labels to finish complete multicolor sections',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),saved=structuredClone(before),after=replanWorkAreaTasks(before);
    assert.equal(after.workAreaTaskPlanning?.selected,true);
    assert.deepEqual(before,saved);assert.deepEqual(after.brickModel,before.brickModel);
    const by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
    const tasks=after.workAreaTaskPlanning.changes[0].tasks;
    assert.equal(tasks.length,2);
    assert.ok(tasks.every(t=>t.length===16&&new Set(t.map(id=>by.get(id).color)).size===2));
    for(const task of tasks){const indexes=after.instructionPlan.steps.flatMap((s,i)=>s.newBrickIds.some(id=>task.includes(id))?[i]:[]);assert.equal(indexes.at(-1)-indexes[0]+1,indexes.length);}
    const supportMap=plan=>new Map(plan.steps.flatMap(s=>s.newBrickIds.map(id=>[id,s.visibleBrickIds.filter(other=>!s.newBrickIds.includes(other)&&by.get(other).y===by.get(id).y-1&&overlap(by.get(other),by.get(id))).sort()])));
    assert.deepEqual(supportMap(after.assemblyPlan),supportMap(before.assemblyPlan));
    const placed=[];for(const s of after.assemblyPlan.steps)for(const id of s.newBrickIds){const b=by.get(id);assert.ok(!placed.some(p=>p.y>b.y&&overlap(p,b)));placed.push(b);}
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(placed.map(b=>b.id).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0]);
    assert.deepEqual(replanWorkAreaTasks(after),after);
  }
});

test('same-height side contact does not require finishing separate uprights together',()=>{
  const bricks=[];
  for(let y=1;y<=5;y++)for(const x of [0,4])bricks.push({id:`${x}-${y}`,x,y,z:0,w:y>=3?4:2,d:2,color:y%2?'red':'blue'});
  const result=discoverWorkAreaTasks(bricks);
  assert.equal(result.tasks.length,2);
  assert.ok(result.tasks.every(t=>new Set(t.map(b=>b.x)).size===1));
});

test('shared supporting courses stay before dependent sections and lower insertion corridors remain open',()=>{
  const bricks=[{id:'base',x:0,y:1,z:0,w:6,d:2,color:'white'},
    {id:'left',x:0,y:2,z:0,w:2,d:2,color:'red'}, {id:'right',x:4,y:2,z:0,w:2,d:2,color:'blue'},
    {id:'bridge',x:0,y:3,z:0,w:6,d:2,color:'green'}, {id:'top',x:0,y:4,z:0,w:2,d:2,color:'red'}];
  const result=discoverWorkAreaTasks(bricks),owner=new Map(result.tasks.flatMap((t,i)=>t.map(b=>[b.id,i])));
  for(const a of bricks)for(const b of bricks)if(a.y<b.y&&overlap(a,b))assert.ok(owner.get(a.id)<=owner.get(b.id));
});

test('table contexts, nested recipes and unresolved operations are protected',()=>{
  for(const kind of ['table','nested','failed']){
    const before=fixture();
    if(kind==='table')before.assemblyPlan.modules[0].buildContext={kind:'work-surface',floorY:0};
    else for(const plan of [before.assemblyPlan,before.instructionPlan])for(const s of plan.steps){
      if(kind==='nested')s.nestedRecipe={id:'separate',separate:true,floorY:0};
      else s.issues=[{code:'unsupported-addition',severity:'error'}];
    }
    assert.equal(replanWorkAreaTasks(before),before);
    assert.equal(replanWorkAreaTasks(before,{consolidateCourses:true}),before);
  }
});

function fragmentedCourses(turn){
  const result=fixture(turn),base=result.assemblyPlan.steps[0],visible=[...base.newBrickIds],steps=[base];
  const tasks=discoverWorkAreaTasks(result.assemblyPlan.bricks.filter(b=>b.y>0)).tasks;
  for(const task of tasks)for(const brick of task){
    visible.push(brick.id);
    steps.push({id:`fragment-${steps.length}`,moduleId:base.moduleId,kind:'build',label:'Build',issues:[],
      newBrickIds:[brick.id],highlightBrickIds:[brick.id],visibleBrickIds:[...visible],insertionDirection:'down'});
  }
  result.assemblyPlan={...result.assemblyPlan,steps};
  result.instructionPlan={...result.assemblyPlan,steps:steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[s]}))};
  result.guide=createGuideSections(result.instructionPlan);
  return result;
}

test('already ordered sections consolidate fragmented courses without needing task returns',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fragmentedCourses(turn),saved=structuredClone(before);
    assert.equal(replanWorkAreaTasks(before),before);
    const after=replanWorkAreaTasks(before,{consolidateCourses:true});
    assert.deepEqual(before,saved);
    const change=after.workAreaTaskPlanning.changes[0];
    assert.equal(change.beforeTaskReturns,0);assert.equal(change.afterTaskReturns,0);
    assert.ok(change.afterDiagrams<=change.beforeDiagrams-2);
    assert.deepEqual(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0]);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    const by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
    const supports=plan=>new Map(plan.steps.flatMap(s=>s.newBrickIds.map(id=>[id,s.visibleBrickIds.filter(other=>!s.newBrickIds.includes(other)&&by.get(other).y===by.get(id).y-1&&overlap(by.get(other),by.get(id))).sort()])));
    assert.deepEqual(supports(after.assemblyPlan),supports(before.assemblyPlan));
    assert.deepEqual(replanWorkAreaTasks(after,{consolidateCourses:true}),after);
  }
});

test('course consolidation can follow earlier task planning while preserving its evidence',()=>{
  const before=fragmentedCourses(0);
  before.workAreaTaskPlanning={selected:true,changes:[{moduleId:'earlier-section'}]};
  const after=replanWorkAreaTasks(before,{consolidateCourses:true});
  assert.equal(after.workAreaTaskPlanning.changes.length,2);
  assert.deepEqual(after.workAreaTaskPlanning.changes[0],before.workAreaTaskPlanning.changes[0]);
  for(const kind of ['up','tableRecipe','componentTask']){
    const blocked=fragmentedCourses(0);
    for(const plan of [blocked.assemblyPlan,blocked.instructionPlan])for(const step of plan.steps){
      if(kind==='up')step.insertionDirection='up';else step[kind]={id:'protected'};
    }
    assert.equal(replanWorkAreaTasks(blocked,{consolidateCourses:true}),blocked);
  }
});
