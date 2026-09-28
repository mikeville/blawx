import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeComponentTasks,discoverComponentTasks} from '../src/component-tasks.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';

function example(turns=0){
  const bricks=[];
  for(let x=0;x<12;x+=2)for(let z=0;z<10;z+=4)bricks.push({x,y:0,z,w:2,d:4,color:'lightGray'});
  for(let y=1;y<=4;y++)for(const [i,[x,z]]of [[0,0],[6,0],[0,6]].entries())for(let dx=0;dx<4;dx+=2)
    bricks.push({x:x+dx,y,z,w:2,d:2,color:['red','blue','green'][(i+turns)%3]});
  const rotated=bricks.map(b=>rotateRecipeBrick(b,turns));const minX=Math.min(...rotated.map(b=>b.x)),minZ=Math.min(...rotated.map(b=>b.z));
  const brickModel={version:1,kind:'bricks',bricks:rotated.map(b=>({...b,x:b.x-minX,z:b.z-minZ}))};
  const raw=createAssemblyPlan({brickModel,integratedBuild:true});
  assert.equal(raw.stats.unresolvedBrickCount,0);
  // Explicitly model the observed layer-by-layer interleaving: each diagram
  // adds a course of one tower, then moves to the next tower at that height.
  const ground=raw.bricks.filter(b=>b.y===0).map(b=>b.id),base=[],visible=[];
  for(let i=0;i<ground.length;i+=12){const ids=ground.slice(i,i+12);visible.push(...ids);base.push({id:`step-base-${i}`,moduleId:raw.modules[0].id,label:'Base',kind:'build',newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:[...visible],issues:[]});}
  const steps=[...base];let n=0;
  for(let y=1;y<=4;y++)for(const color of ['red','blue','green']){
    const ids=raw.bricks.filter(b=>b.y===y&&b.color===color).map(b=>b.id);visible.push(...ids);
    steps.push({id:`feature-${++n}`,moduleId:raw.modules[0].id,label:'Continue',kind:'build',newBrickIds:ids,
      visibleBrickIds:[...visible],highlightBrickIds:[...ids],issues:[],insertionDirection:'down'});
  }
  const assemblyPlan={...raw,steps,stats:{...raw.stats,stepCount:steps.length}};
  const instructionPlan={...assemblyPlan,steps:steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:'down'}]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),assemblyEvaluation:{compaction:compactAssemblyPlan(assemblyPlan).report}};
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;

test('complete compact features across courses without changing support, geometry or outside steps',()=>{
  for(let turns=0;turns<4;turns++){
    const before=example(turns),snapshot=structuredClone(before),after=completeComponentTasks(before);
    assert.equal(after.componentTaskPlanning?.selected,true);
    assert.ok(after.componentTaskPlanning.beforeTaskReturns>=2);
    assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
    assert.deepEqual(after.brickModel,before.brickModel);
    assert.deepEqual(before,snapshot);
    assert.deepEqual(completeComponentTasks(after),after);
    const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b])),scene=[];
    for(const step of after.assemblyPlan.steps){
      for(const id of step.newBrickIds){const b=byId.get(id);if(b.y){assert.ok(scene.some(p=>p.y===b.y-1&&overlap(p,b)));assert.ok(!scene.some(p=>p.y>b.y&&overlap(p,b)));}scene.push(b);}
    }
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual([...scene.map(b=>b.id)].sort(),before.assemblyPlan.bricks.map(b=>b.id).sort());
    for(const s of before.assemblyPlan.steps.filter(s=>s.id.startsWith('step-')))assert.deepEqual(after.assemblyPlan.steps.find(n=>n.id===s.id),s);
    const tasks=after.componentTaskPlanning.tasks.map(t=>t.map(id=>byId.get(id)));
    assert.equal(tasks.length,3);assert.ok(tasks.every(t=>new Set(t.map(b=>b.color)).size===1&&new Set(t.map(b=>b.y)).size===4));
  }
});

test('task contraction preserves a required intervening external structure',()=>{
  const bricks=[
    {id:'a',x:0,y:1,z:0,w:2,d:2,color:'red'},
    {id:'side',x:1,y:2,z:0,w:2,d:2,color:'red'},
    {id:'bridge',x:0,y:2,z:0,w:1,d:4,color:'blue'},
    {id:'cap',x:0,y:3,z:0,w:3,d:2,color:'red'},
  ];
  const {tasks}=discoverComponentTasks(bricks),owner=new Map(tasks.flatMap((t,i)=>t.map(b=>[b.id,i])));
  assert.ok(owner.get('a')<owner.get('bridge'));assert.ok(owner.get('bridge')<owner.get('cap'));
});

test('an inset belongs to its actual footprint, not a distant same-color part',()=>{
  const bricks=[];let n=0;
  for(const x of [0,8])for(let y=1;y<=3;y++)for(const dx of [0,2])bricks.push({id:`b${n++}`,x:x+dx,y,z:0,w:2,d:2,color:'green'});
  bricks.push({id:'cap',x:1,y:4,z:0,w:2,d:2,color:'yellow'});
  const {tasks}=discoverComponentTasks(bricks),capped=tasks.find(t=>t.some(b=>b.id==='cap'));
  assert.equal(capped.length,7);assert.ok(capped.every(b=>b.x<4));assert.equal(tasks.length,2);
});

test('a cap extending into an empty bounding corner stays a separate task',()=>{
  const bricks=[];let n=0;
  for(let y=1;y<=3;y++)for(const [x,z]of [[0,0],[2,0],[0,2]])bricks.push({id:`l${n++}`,x,y,z,w:2,d:2,color:'green'});
  bricks.push({id:'overhang',x:1,y:4,z:1,w:2,d:2,color:'yellow'});
  const {tasks}=discoverComponentTasks(bricks);
  assert.deepEqual(tasks.find(t=>t.some(b=>b.id==='overhang')).map(b=>b.id),['overhang']);
});

test('protected recipes and unresolved ranges are unchanged',()=>{
  for(const patch of [{instructionAction:{id:'recipe',kind:'course'}},{issues:[{severity:'error',code:'unsupported-addition'}],kind:'unresolved'}]){
    const before=example();before.instructionPlan.steps=before.instructionPlan.steps.map(s=>({...s,...patch}));assert.equal(completeComponentTasks(before),before);
  }
});
