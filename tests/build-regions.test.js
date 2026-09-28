import test from 'node:test';
import assert from 'node:assert/strict';
import {scheduleBuildRegions, scheduleSupportedBuildRegions} from '../src/build-regions.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';

function towers({bridge=false,levels=3,transform=b=>b}={}){
  const brick=(id,x,y,w=1)=>transform({id,x,y,z:0,w,d:2,color:y%2?'blue':'yellow'});
  const base=[brick('a0',0,0),brick('b0',3,0)];
  const batches=[base];
  for(let y=1;y<=levels;y++)for(const [name,x]of [['a',0],['b',3]])batches.push([brick(`${name}${y}`,x,y)]);
  if(bridge)batches.push([brick('bridge',0,4,4)]);
  const bricks=batches.flat(),visible=[],canonical=[],steps=[];
  for(const [i,added]of batches.entries()){
    const newBrickIds=added.map(b=>b.id);visible.push(...newBrickIds);
    const source={id:`source-${i}`,moduleId:'towers',label:'Build area',kind:'build',newBrickIds,highlightBrickIds:[...newBrickIds],
      visibleBrickIds:[...visible],issues:[],instructionAction:{id:`action-${i}`,kind:i?'course':'layout-layer'}};
    canonical.push(source);
    steps.push({...structuredClone(source),id:`diagram-${i}`,sourceStepIds:[source.id],orderedOperations:[{
      id:source.id,kind:'build',newBrickIds:[...newBrickIds],highlightBrickIds:[...newBrickIds],issues:[],insertionDirection:'down'}]});
  }
  const modules=[{id:'towers',label:'Build area',kind:'grounded',brickIds:bricks.map(b=>b.id)}];
  const stats={stepCount:steps.length,brickCount:bricks.length,coverageComplete:true,unresolvedBrickCount:0};
  const assemblyPlan={version:1,bricks,modules,steps:canonical,stats},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>b)},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

const diagrams=result=>result.instructionPlan.steps.map(s=>s.newBrickIds);

test('completes each area across heights while preserving whole diagrams and physical support',()=>{
  for(const transform of [b=>b,b=>({...b,x:10-b.z-b.d,z:b.x,w:b.d,d:b.w}),b=>({...b,x:8-b.x-b.w,color:b.color==='blue'?'red':'green'})]){
    const before=towers({transform}),frozen=structuredClone(before),after=scheduleBuildRegions(before);
    assert.equal(after.regionScheduling.selected,true);
    assert.equal(after.regionScheduling.returnsBefore,4);assert.equal(after.regionScheduling.returnsAfter,0);
    assert.deepEqual(diagrams(after),[['a0','b0'],['a1'],['a2'],['a3'],['b1'],['b2'],['b3']]);
    assert.deepEqual(before,frozen);assert.equal(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const old=new Map(before.assemblyPlan.steps.map(s=>[s.id,s]));
    for(const s of after.assemblyPlan.steps){const {visibleBrickIds,...a}=s,{visibleBrickIds:unused,...b}=old.get(s.id);assert.deepEqual(a,b);}
    const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b])),placed=[];
    for(const s of after.assemblyPlan.steps){
      for(const id of s.newBrickIds){const b=byId.get(id),overlap=p=>p.x<b.x+b.w&&b.x<p.x+p.w&&p.z<b.z+b.d&&b.z<p.z+p.d;
        assert.ok(b.y===0||placed.some(p=>p.y===b.y-1&&overlap(p)));
        assert.ok(!placed.some(p=>p.y>b.y&&overlap(p)));placed.push(b);
      }
      assert.deepEqual(new Set(s.visibleBrickIds),new Set(placed.map(b=>b.id)));
    }
    assert.equal(scheduleBuildRegions(after),after);
  }
});

test('completes independent uprights before a shared bridge without moving the bridge early',()=>{
  const before=towers({bridge:true}),after=scheduleBuildRegions(before);
  assert.equal(after.regionScheduling.selected,true);
  assert.deepEqual(diagrams(after),[['a0','b0'],['a1'],['a2'],['a3'],['b1'],['b2'],['b3'],['bridge']]);
  assert.deepEqual(after.instructionPlan.steps.at(-1),before.instructionPlan.steps.at(-1));
});

test('warnings and insertion-direction boundaries retain the established sequence',()=>{
  for(const change of [s=>{s.issues=[{code:'limited-support'}];},s=>{s.insertionDirection='up';}]){
    const before=towers();change(before.instructionPlan.steps[3]);change(before.assemblyPlan.steps[3]);
    assert.equal(scheduleBuildRegions(before),before);
  }
});

test('missing prior support rejects a proposed permutation without altering the input',()=>{
  const before=towers({levels:2});before.instructionPlan.steps[1].visibleBrickIds=before.instructionPlan.steps[1].visibleBrickIds.filter(id=>id!=='a0');
  const frozen=structuredClone(before),after=scheduleBuildRegions(before);
  assert.equal(after.regionScheduling.selected,false);
  assert.ok(after.regionScheduling.rejectionReasons.includes('Region placement changes stud support'));
  assert.equal(after.instructionPlan,before.instructionPlan);assert.deepEqual(before,frozen);
});

test('section boundaries and guidance retain the complete work-area run after numbering changes',()=>{
  const after=scheduleBuildRegions(towers()),plan=after.instructionPlan;
  const numbering={byStepId:new Map(plan.steps.map((s,i)=>[s.id,i+11]))};
  const first=plan.steps[1];
  assert.equal(createStepGuidance(plan,first,numbering).instruction,'Build up this area through step 14.');
  const regionSteps=plan.steps.filter(s=>s.buildRegion?.id===first.buildRegion.id).map(s=>s.id);
  assert.ok(after.guide.sections.some(s=>JSON.stringify(s.stepIds)===JSON.stringify(regionSteps)));
  assert.equal(createStepGuidance(plan,plan.steps[2],numbering).instruction,'');
});

function ordinaryTowers(transform=b=>b){
  const result=towers({levels:4,transform}),old=new Map(result.assemblyPlan.steps.map(s=>[s.newBrickIds[0],s]));
  const batches=[['a0'],['a1','a2'],['b1','b2'],['a3','a4'],['b3','b4']],visible=[],canonical=[],diagrams=[];
  for(const [i,ids]of batches.entries()){
    const sources=ids.map(id=>{
      const {instructionAction,...source}=old.get(id);
      visible.push(...source.newBrickIds);
      const next={...source,visibleBrickIds:[...visible]};canonical.push(next);return next;
    });
    const added=sources.flatMap(s=>s.newBrickIds);
    diagrams.push({...sources.at(-1),id:`ordinary-${i}`,newBrickIds:added,highlightBrickIds:[...added],
      sourceStepIds:sources.map(s=>s.id),orderedOperations:sources.map(s=>({id:s.id,kind:s.kind,
        newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:[],insertionDirection:'down'}))});
  }
  result.assemblyPlan={...result.assemblyPlan,steps:canonical};
  result.instructionPlan={...result.instructionPlan,steps:diagrams};result.guide=createGuideSections(result.instructionPlan);
  return result;
}

test('ordinary multi-height diagrams finish independent supported areas without splitting their actions',()=>{
  for(const transform of [b=>b,b=>({...b,x:10-b.z-b.d,z:b.x,w:b.d,d:b.w,color:'green'})]){
    const before=ordinaryTowers(transform),frozen=structuredClone(before),after=scheduleSupportedBuildRegions(before);
    assert.equal(after.supportedRegionScheduling.selected,true);
    assert.equal(after.supportedRegionScheduling.returnsBefore,2);
    assert.equal(after.supportedRegionScheduling.returnsAfter,0);
    assert.deepEqual(diagrams(after),[['a0','b0'],['a1','a2'],['a3','a4'],['b1','b2'],['b3','b4']]);
    assert.deepEqual(before,frozen);assert.equal(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const old=new Map(before.instructionPlan.steps.map(s=>[s.id,s]));
    for(const s of after.instructionPlan.steps){
      const {visibleBrickIds,buildRegion,...unchanged}=s,{visibleBrickIds:previous,...original}=old.get(s.id);
      assert.deepEqual(unchanged,original);
    }
    assert.equal(scheduleSupportedBuildRegions(after),after);
  }
});

test('ordinary region fallback preserves established regions, recipes, warnings and action boundaries',()=>{
  for(const change of [s=>{s.buildRegion={id:'accepted'};},s=>{s.tableRecipe={id:'accepted'};},
    s=>{s.instructionAction={kind:'foundation'};},s=>{s.issues=[{code:'limited-support'}];},s=>{s.insertionDirection='up';}]){
    const before=ordinaryTowers();change(before.instructionPlan.steps[2]);
    assert.equal(scheduleSupportedBuildRegions(before),before);
  }
  const offline=ordinaryTowers();offline.instructionPlan.modules[0].buildContext='table';
  assert.equal(scheduleSupportedBuildRegions(offline),offline);
});

test('ordinary fallback leaves a deliberately planned complete-course sequence intact',()=>{
  const before=towers();assert.equal(scheduleSupportedBuildRegions(before),before);
});

function cornerColumn(transform=b=>b){
  const seed=towers(),batches=[[{id:'floor',x:0,y:0,z:0,w:6,d:4,color:'gray'}]];
  for(let y=1;y<=3;y++)batches.push(
    [{id:`wall-${y}`,x:0,y,z:0,w:1,d:4,color:'brown'},{id:`corner-${y}`,x:1,y,z:3,w:3,d:1,color:'brown'}],
    [{id:`column-${y}`,x:2,y,z:1,w:1,d:1,color:'white'}],
    [{id:`wing-${y}`,x:4,y,z:3,w:2,d:1,color:'brown'}]);
  const bricks=batches.flat().map(transform),visible=[],sources=[];
  const steps=batches.map((batch,i)=>{
    const ids=batch.map(b=>b.id);visible.push(...ids);
    const source={id:`source-${i}`,moduleId:'structure',kind:'build',newBrickIds:ids,highlightBrickIds:[...ids],
      visibleBrickIds:[...visible],issues:[],instructionAction:{id:`action-${i}`,kind:i?'course':'layout-layer'}};
    sources.push(source);
    return {...structuredClone(source),id:`diagram-${i}`,sourceStepIds:[source.id],orderedOperations:[{
      id:source.id,kind:'build',newBrickIds:ids,highlightBrickIds:[...ids],issues:[],insertionDirection:'down'}]};
  });
  const modules=[{id:'structure',label:'Structure',kind:'grounded',brickIds:bricks.map(b=>b.id)}];
  const assemblyPlan={...seed.assemblyPlan,bricks,modules,steps:sources};
  const instructionPlan={...assemblyPlan,steps};
  return {brickModel:{version:1,kind:'bricks',bricks},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('actual contacts keep a whole wall together and an independent corner column separate',()=>{
  for(const transform of [b=>b,b=>({...b,x:12-b.z-b.d,z:b.x,w:b.d,d:b.w}),
    b=>({...b,x:10-b.x-b.w,color:b.color==='brown'?'green':'blue'})]){
    const before=cornerColumn(transform),snapshot=structuredClone(before),after=scheduleBuildRegions(before);
    assert.equal(after.regionScheduling?.selected,true);
    const run=after.instructionPlan.steps.slice(1),labels=run.map(s=>s.newBrickIds[0].startsWith('column')?'column':'wall');
    assert.equal(labels.filter((v,i)=>!i||v!==labels[i-1]).length,2);
    assert.deepEqual(run.filter(s=>!s.newBrickIds[0].startsWith('column')).map(s=>s.newBrickIds),
      [['wall-1','corner-1'],['wing-1'],['wall-2','corner-2'],['wing-2'],['wall-3','corner-3'],['wing-3']]);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(before,snapshot);assert.equal(after.brickModel,before.brickModel);
    const byId=new Map(before.assemblyPlan.steps.map(s=>[s.id,s]));
    for(const step of after.assemblyPlan.steps){
      const {visibleBrickIds,...current}=step,{visibleBrickIds:oldVisible,...original}=byId.get(step.id);
      assert.deepEqual(current,original);
    }
  }
});

test('a contrasting inset stays with the surrounding rim it actually touches',()=>{
  const before=cornerColumn(b=>b.id.startsWith('column')?{...b,x:1,z:1,w:2,d:2}:b);
  assert.equal(scheduleBuildRegions(before),before);
});
