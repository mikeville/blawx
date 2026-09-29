import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverWorkAreaTasks,discoverIndependentWorkAreaTasks,replanWorkAreaTasks} from '../src/work-area-tasks.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
function volumes(turn=0){
  const bricks=[];
  for(let side=0;side<2;side++)for(let y=1;y<=8;y++)for(let i=0;i<3;i++){
    const brick={id:`${side}-${y}-${i}`,x:side*6+(y%2?i*2:0),y,z:y%2?0:i*2,w:y%2?2:6,d:y%2?6:2,
      color:turn%2?'red':i===1?'white':'blue'};
    bricks.push({...rotateRecipeBrick(brick,turn),id:brick.id});
  }
  const minX=Math.min(...bricks.map(b=>b.x)),minZ=Math.min(...bricks.map(b=>b.z));
  return bricks.map(b=>({...b,x:b.x-minX,z:b.z-minZ}));
}
function fixture(turn){
  const upper=volumes(turn),bricks=[...upper],maxX=Math.max(...upper.map(b=>b.x+b.w)),maxZ=Math.max(...upper.map(b=>b.z+b.d));
  for(let x=0;x<maxX;x+=2)for(let z=0;z<maxZ;z+=2)bricks.push({x,y:0,z,w:2,d:2,color:'darkGray'});
  const brickModel={kind:'bricks',version:1,bricks},raw=createAssemblyPlan({brickModel,integratedBuild:true});
  assert.equal(raw.stats.unresolvedBrickCount,0);
  const ground=raw.bricks.filter(b=>b.y===0).map(b=>b.id),visible=[...ground];
  const steps=[{id:'ground',moduleId:raw.modules[0].id,kind:'build',newBrickIds:ground,highlightBrickIds:ground,visibleBrickIds:[...ground],issues:[],groundLayout:{ordinal:1,total:1}}];
  for(const b of raw.bricks.filter(b=>b.y>0).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x)){
    visible.push(b.id);steps.push({id:`source-${steps.length}`,moduleId:raw.modules[0].id,kind:'build',newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[...visible],issues:[],insertionDirection:'down'});
  }
  const assemblyPlan={...raw,steps},instructionPlan={...assemblyPlan,steps:steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[s]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('side-touching independent volumes complete separately across rotations and palettes',()=>{
  for(let turn=0;turn<4;turn++){
    const bricks=volumes(turn),before=discoverWorkAreaTasks(bricks),after=discoverIndependentWorkAreaTasks(bricks);
    assert.equal(before.tasks.length,1);assert.equal(after.tasks.length,2);
    assert.ok(after.tasks.every(task=>task.length===24&&new Set(task.map(b=>b.id.split('-')[0])).size===1));
    assert.deepEqual(after.tasks.flat().map(b=>b.id).sort(),bricks.map(b=>b.id).sort());
  }
});

test('independent-volume replay preserves the foundation, every support and exact placement coverage',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),saved=structuredClone(before),after=replanWorkAreaTasks(before,{consolidateCourses:true});
    assert.deepEqual(before,saved);assert.deepEqual(before.brickModel,after.brickModel);
    assert.equal(after.workAreaTaskPlanning.changes[0].tasks.length,2);
    const by=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
    const supports=p=>new Map(p.steps.flatMap(s=>s.newBrickIds.map(id=>[id,s.visibleBrickIds.filter(other=>!s.newBrickIds.includes(other)&&by.get(other).y===by.get(id).y-1&&overlap(by.get(other),by.get(id))).sort()])));
    assert.deepEqual(supports(after.assemblyPlan),supports(before.assemblyPlan));
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0]);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    const taskIds=after.instructionPlan.steps.slice(1).map(s=>s.componentTask.id);
    assert.equal(taskIds.filter((id,i)=>i===0||id!==taskIds[i-1]).length,2);
    assert.deepEqual(replanWorkAreaTasks(after,{consolidateCourses:true}),after);
  }
});

test('real bridges and overlapping footprints retain the dependency-based interpretation',()=>{
  const connected=[...volumes(),{id:'bridge',x:0,y:9,z:0,w:12,d:2,color:'yellow'}];
  const stacked=volumes().map(b=>b.id.startsWith('1-')?{...b,x:b.x-6,y:b.y+10}:b);
  for(const bricks of [connected,stacked])assert.deepEqual(discoverIndependentWorkAreaTasks(bricks),discoverWorkAreaTasks(bricks));
});

test('small regions and many aligned columns do not become separate component tasks',()=>{
  const short=volumes().filter(b=>b.y<=2),columns=[];
  for(let x=0;x<8;x++)for(let y=1;y<=8;y++)columns.push({id:`${x}-${y}`,x,y,z:0,w:1,d:1,color:'green'});
  for(const bricks of [short,columns])assert.deepEqual(discoverIndependentWorkAreaTasks(bricks),discoverWorkAreaTasks(bricks));
});
