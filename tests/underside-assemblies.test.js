import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {createAssemblyJoinPreview} from '../src/assembly-join-preview.js';
import {planUndersideAssemblies} from '../src/underside-assemblies.js';
import {planAssemblyRecipes} from '../src/assembly-recipe-planning.js';

function fixture({turn=0,blocked=false}={}){
 const receiver=[...Array.from({length:4},(_,y)=>({x:0,y,z:0,w:2,d:2,color:'black'})),{x:0,y:4,z:0,w:4,d:2,color:'black'},
  ...(blocked?[{x:2,y:0,z:0,w:2,d:2,color:'black'}]:[])];
 const hanging=Array.from({length:3},(_,i)=>({x:2,y:i+1,z:0,w:2,d:2,color:'green'}));
 const transform=b=>{for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};return {...b,x:b.x+10,z:b.z+20,color:turn?(b.color==='black'?'blue':'yellow'):b.color};};
 const brickModel={version:1,kind:'bricks',bricks:[...receiver,...hanging].map(transform)};
 const seed=createAssemblyPlan({brickModel});
 const receiverIds=seed.bricks.filter(b=>b.color===(turn?'blue':'black')).map(b=>b.id);
 const ids=seed.bricks.filter(b=>!receiverIds.includes(b.id)).map(b=>b.id);
 const beam=seed.bricks.filter(b=>receiverIds.includes(b.id)&&b.y===4).map(b=>b.id);
 const columns=receiverIds.filter(id=>!beam.includes(id));
 const moduleReplay=[{id:'receiver',kind:'grounded',label:'Receiver',brickIds:columns,brickOrder:columns},
  {id:'beam',kind:'detail',label:'Beam',groupType:'work-surface',brickIds:beam,brickOrder:beam,buildContext:{kind:'work-surface',floorY:4}},
  {id:'hanging',kind:'grounded',groupType:'continuation',label:'Hanging region',brickIds:ids,brickOrder:ids}];
 return {brickModel,moduleReplay,ids};
}
function build(f,{separate=false,direction='up'}={}){
 const moduleReplay=f.moduleReplay.map(m=>m.id==='hanging'&&separate?{...m,kind:'detail',groupType:'work-surface',
  buildContext:{kind:'work-surface',floorY:1,orderPolicy:'course-first',joinDirection:direction}}:m);
 const assemblyPlan=createAssemblyPlan({brickModel:f.brickModel,moduleReplay});
 const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
 return {brickModel:f.brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0,stageTiming:{}}};
}

test('a complete hanging assembly builds on the table and joins upward across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const f=fixture({turn}),before=build(f),after=build(f,{separate:true});
  assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const steps=after.assemblyPlan.steps.filter(s=>s.moduleId==='hanging'),join=steps.at(-1);
  assert.equal(join.kind,'join');assert.equal(join.insertionDirection,'up');assert.equal(join.joinContext.direction,'up');
  assert.equal(join.joinContext.supportGroups.length,1);
  assert.deepEqual(steps.flatMap(s=>s.newBrickIds).sort(),[...f.ids].sort());
  assert.ok(steps.slice(0,-1).every(s=>s.kind==='build'&&!s.issues.length));
  assert.ok(build(f,{separate:true,direction:'down'}).assemblyPlan.steps.at(-1).issues.some(i=>i.code==='blocked-module-insertion'));
  const snapshot=structuredClone(before),discovered=planUndersideAssemblies(before);
  assert.equal(discovered.undersideAssemblyPlanning.selected,true);assert.equal(discovered.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.deepEqual(before,snapshot);assert.deepEqual(discovered.brickModel,before.brickModel);
  assert.deepEqual(discovered.instructionPlan.steps.flatMap(s=>s.sourceStepIds),discovered.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(discovered.instructionPlan.steps.flatMap(s=>s.newBrickIds).sort(),discovered.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.equal(planAssemblyRecipes(discovered),discovered);
 }
});

test('upward joins reject an obstructed lower insertion path and invalid direction',()=>{
 const f=fixture({blocked:true}),blocked=build(f,{separate:true});
 assert.equal(blocked.assemblyPlan.steps.at(-1).kind,'unresolved');
 assert.ok(blocked.assemblyPlan.steps.at(-1).issues.some(i=>i.code==='blocked-module-insertion'));
 assert.equal(planUndersideAssemblies(build(f)).undersideAssemblyPlanning.selected,false);
 assert.throws(()=>build(f,{separate:true,direction:'sideways'}),/invalid join direction/);
});

test('an upward attachment cannot ask the builder to lift independent receiving structures together',()=>{
 const brickModel={version:1,kind:'bricks',bricks:[
  {x:0,y:0,z:0,w:2,d:2,color:'black'},{x:0,y:1,z:0,w:2,d:2,color:'black'},{x:0,y:2,z:0,w:4,d:2,color:'black'},
  {x:6,y:0,z:0,w:2,d:2,color:'black'},{x:6,y:1,z:0,w:2,d:2,color:'black'},{x:4,y:2,z:0,w:4,d:2,color:'black'},
  {x:2,y:1,z:0,w:2,d:2,color:'green'},{x:4,y:1,z:0,w:2,d:2,color:'green'},
  {x:2,y:0,z:0,w:4,d:2,color:'green'}]};
 // Translate the connected moving assembly above ground so its own table
 // floor remains distinct; extend the receivers down to their real floor.
 brickModel.bricks=brickModel.bricks.map(b=>({...b,y:b.y+1}));
 brickModel.bricks.push({x:0,y:0,z:0,w:2,d:2,color:'black'},{x:6,y:0,z:0,w:2,d:2,color:'black'});
 const seed=createAssemblyPlan({brickModel});const ids=color=>seed.bricks.filter(b=>b.color===color).map(b=>b.id);
 const plan=createAssemblyPlan({brickModel,moduleReplay:[{id:'receiver',kind:'grounded',label:'Receiver',brickIds:ids('black'),brickOrder:ids('black')},
  {id:'bridge',kind:'detail',label:'Bridge',groupType:'work-surface',brickIds:ids('green'),brickOrder:ids('green'),buildContext:{kind:'work-surface',floorY:1,joinDirection:'up'}}]});
 assert.ok(plan.steps.at(-1).issues.some(i=>i.code==='disconnected-receiver'));assert.equal(plan.steps.at(-1).kind,'unresolved');
});

test('upward attachment diagram and wording show the complete assembly below its receiver',()=>{
 const r=build(fixture(),{separate:true}),join=r.assemblyPlan.steps.at(-1),model={kind:'bricks',bricks:r.assemblyPlan.bricks};
 const snapshot=structuredClone(model),highlightIds=new Set(join.highlightBrickIds);
 const preview=createAssemblyJoinPreview({model,highlightIds,joinContext:join.joinContext});
 assert.equal(preview.active,true);assert.ok(preview.arrows.every(a=>a.start.y<a.end.y));
 for(const b of preview.model.bricks){const original=model.bricks.find(p=>p.id===b.id);assert.equal(b.y,original.y-(highlightIds.has(b.id)?preview.liftCourses:0));}
 assert.deepEqual(model,snapshot);
 const malformed=structuredClone(join.joinContext);malformed.supportGroups[0].contacts[0].studs++;
 assert.equal(createAssemblyJoinPreview({model,highlightIds,joinContext:malformed}).active,false);
 const numbering={byStepId:new Map(r.assemblyPlan.steps.map((s,i)=>[s.id,i+1]))};
 assert.match(createStepGuidance(r.assemblyPlan,join,numbering).instruction,/completed assembly underneath/);
 const first=r.assemblyPlan.steps.find(s=>s.moduleId==='hanging');
 assert.match(createStepGuidance(r.assemblyPlan,first,numbering).instruction,new RegExp(`Attach it in step ${numbering.byStepId.get(join.id)}`));
});
