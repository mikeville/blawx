import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {planElevatedAssemblies} from '../src/elevated-assemblies.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {integrateSmallDetails} from '../src/assembly-ownership.js';

function fixture(turn=0) {
  const b=(x,y,w=1)=>({x,y,z:0,w,d:1,color:turn?'red':'blue'});
  const bricks=[b(0,0),b(0,1),b(0,2),b(2,2),b(0,3,3),b(3,3),b(0,4,2),b(2,4,2),b(0,5,4),b(0,6,4)]
    .map(b=>{for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};return {...b,x:b.x+8,z:b.z+8};});
  const brickModel={version:1,kind:'bricks',bricks};
  return prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,integratedBuild:true}),metrics:{conversionMs:0}});
}

test('a complete elevated section connects on the table before lifting to finish its underside',()=>{
  for(let turn=0;turn<4;turn++) {
    const before=fixture(turn),snapshot=structuredClone(before),after=planElevatedAssemblies(before),plan=after.assemblyPlan;
    assert.ok(before.assemblyPlan.stats.unresolvedBrickCount>0);
    assert.equal(after.elevatedAssemblyPlanning.selected,true);
    assert.equal(plan.stats.unresolvedBrickCount,0);
    assert.equal(after.brickModel,before.brickModel);
    const module=plan.modules.find(m=>m.buildContext),steps=plan.steps.filter(s=>s.moduleId===module.id);
    const up=steps.find(s=>s.insertionDirection==='up');
    assert.ok(up);assert.equal(up.issues.length,0);
    const prior=new Set(steps.slice(0,steps.indexOf(up)).flatMap(s=>s.newBrickIds));
    const connected=new Set([prior.values().next().value]);
    for(const id of connected) for(const e of plan.graph.edges) {
      const next=e.a===id?e.b:e.b===id?e.a:null;
      if(prior.has(next))connected.add(next);
    }
    assert.equal(connected.size,prior.size,'All previously laid-out parts must be connected before lifting');
    const byId=new Map(plan.bricks.map(b=>[b.id,b]));
    assert.equal(Math.max(...[...prior].map(id=>byId.get(id).y)),4,
      'Finish the underside as soon as its connecting course is ready, before climbing higher');
    for(const id of up.newBrickIds) {
      const b=byId.get(id);
      assert.ok(plan.graph.edges.some(e=>e.a===id&&prior.has(e.b)&&byId.get(e.b).y===b.y+1
        ||e.b===id&&prior.has(e.a)&&byId.get(e.a).y===b.y+1));
      assert.ok([...prior].map(id=>byId.get(id)).every(p=>p.y>=b.y||p.x+p.w<=b.x||b.x+b.w<=p.x||p.z+p.d<=b.z||b.z+b.d<=p.z));
    }
    assert.equal(steps.at(-1).kind,'join');assert.equal(steps.at(-1).issues.length,0);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id));
    assert.equal(new Set(plan.steps.flatMap(s=>s.newBrickIds)).size,plan.bricks.length);
    const guidance=createStepGuidance(plan,up,{byStepId:new Map(plan.steps.map((s,i)=>[s.id,i+1]))});
    assert.match(guidance.instruction,/Lift the connected section/);
    assert.deepEqual(before,snapshot);
    assert.equal(planElevatedAssemblies(after),after);
  }
});

test('lifting a work-surface recipe is opt-in; unconnected layouts cannot be lifted',()=>{
  const before=fixture(),after=planElevatedAssemblies(before),plan=after.assemblyPlan;
  const replay=plan.modules.map(m=>({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,brickIds:m.brickIds,
    brickOrder:m.brickIds,...(m.buildContext?{buildContext:m.buildContext}:{})}));
  const without=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,integratedBuild:true,allowUnderAttachments:true});
  assert.ok(without.stats.unresolvedBrickCount>0);
  assert.equal(without.steps.filter(s=>s.moduleId===replay[1].id&&s.insertionDirection==='up').length,0);
  // A separate floor piece connects only through the final roof. The planner
  // cannot lift the earlier layout merely to rescue its hanging corner.
  const b=(x,y,w=1)=>({x,y,z:8,w,d:1,color:'blue'});
  const brickModel={...before.brickModel,bricks:[...before.brickModel.bricks,b(13,2),b(13,3),b(13,4),b(13,5),b(13,6),b(11,7,3)]};
  const identified=createAssemblyPlan({brickModel,integratedBuild:true});
  const selected=identified.bricks.filter(b=>b.y>=2).map(b=>b.id);
  const refused=createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds:selected,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true});
  assert.ok(refused.stats.unresolvedBrickCount>0);
  assert.equal(refused.steps.some(s=>s.insertionDirection==='up'),false);
});

test('supported finishing details belong to the separate assembly before its attachment',()=>{
  const source=planElevatedAssemblies(fixture()),p=source.assemblyPlan;
  const module=p.modules.find(m=>m.buildContext),top=p.bricks.find(b=>b.y===6);
  const replay=p.modules.map(m=>({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,
    brickIds:m.brickIds.filter(id=>id!==top.id),brickOrder:m.brickIds.filter(id=>id!==top.id),
    ...(m.buildContext?{buildContext:m.buildContext}:{})}));
  replay.push({id:'decoration',label:'Small decoration',kind:'detail',groupType:'color',brickIds:[top.id],brickOrder:[top.id]});
  const assemblyPlan=createAssemblyPlan({brickModel:source.brickModel,moduleReplay:replay,integratedBuild:true,
    allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true});
  const before=prepareAssemblyGuide({...source,assemblyPlan},{moduleReplay:replay}),after=integrateSmallDetails(before);
  assert.equal(after.detailOwnership.selected,true);
  assert.equal(after.assemblyPlan.modules.some(m=>m.id==='decoration'),false);
  assert.ok(after.assemblyPlan.modules.find(m=>m.id===module.id).brickIds.includes(top.id));
  const steps=after.assemblyPlan.steps,placement=steps.findIndex(s=>s.newBrickIds.includes(top.id));
  assert.ok(placement<steps.findIndex(s=>s.moduleId===module.id&&s.kind==='join'));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.assemblyPlan.stats.upwardInsertionBrickCount,1);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),steps.map(s=>s.id));
  assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
});

test('matching underside details share one connecting step and one lift across rotations',()=>{
  for(let turn=0;turn<4;turn++) {
    const b=(x,y,w=1)=>({x,y,z:0,w,d:1,color:turn?'green':'blue'});
    const bricks=[b(0,0),b(0,1),b(0,2),b(2,2),b(0,3,3),b(-1,3),b(3,3),
      b(-1,4,2),b(2,4,2),b(-1,5,4),b(3,5),b(-1,6,4),b(3,6)]
      .map(b=>{for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};return {...b,x:b.x+8,z:b.z+8};});
    const brickModel={version:1,kind:'bricks',bricks};
    const before=prepareAssemblyGuide({brickModel,assemblyPlan:createAssemblyPlan({brickModel,integratedBuild:true}),metrics:{conversionMs:0}});
    const after=planElevatedAssemblies(before),p=after.assemblyPlan;
    assert.equal(p.stats.unresolvedBrickCount,0);
    assert.equal(p.stats.upwardInsertionBrickCount,2);
    const up=p.steps.filter(s=>s.insertionDirection==='up');
    assert.equal(up.length,1,'Complete equivalent placements in one lift');
    assert.equal(up[0].newBrickIds.length,2);
    const byId=new Map(p.bricks.map(b=>[b.id,b])),previous=p.steps[p.steps.indexOf(up[0])-1];
    assert.equal(previous.newBrickIds.length,2);
    assert.ok(previous.newBrickIds.every(id=>byId.get(id).y===4));
    for(const id of up[0].newBrickIds) assert.ok(p.graph.edges.some(e=>
      e.a===id&&previous.newBrickIds.includes(e.b)||e.b===id&&previous.newBrickIds.includes(e.a)));
    assert.equal(p.steps.filter(s=>s.kind==='join').at(-1).issues.length,0);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),p.steps.map(s=>s.id));
    assert.equal(new Set(p.steps.flatMap(s=>s.newBrickIds)).size,bricks.length);
    assert.deepEqual(after.brickModel,brickModel);
  }
});
