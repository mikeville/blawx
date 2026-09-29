import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeCourseFeatures,refineCourseFeatures} from '../src/course-features.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {annotateActions} from '../src/assembly-actions.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';

const part=(x,z,w=1,d=1,color='blue',y=1)=>({id:`${x},${y},${z}:${w}x${d}:${color}`,x,y,z,w,d,color});
const floor=items=>items.map(b=>({...b,y:b.y-1,id:`under-${b.id}`,color:'lightGray'}));
const ids=items=>items.map(b=>b.id).sort();
const coverage=(proposal,items)=>assert.deepEqual(proposal.flatMap(g=>g.brickIds).sort(),ids(items));
function rim(){return [part(0,0,1,4),part(0,4,1,4),part(1,7,4,1),part(5,7,2,1),part(7,4,1,4),part(7,0,1,4)];}

test('finishes a complete open border across rotations and palette changes',()=>{
  for(const transform of [b=>b,b=>({...b,x:24-b.z-b.d,z:b.x,w:b.d,d:b.w,color:'yellow'})]){
    const items=rim().map(transform),frozen=structuredClone(items),proposal=proposeCourseFeatures(items,floor(items));
    assert.equal(proposal.length,1);assert.equal(proposal[0].kind,'contour');coverage(proposal,items);assert.deepEqual(items,frozen);
  }
});

test('plans a complete cross-section including its trim rather than leaving small endpoints',()=>{
  const items=[part(1,0,4,2,'black'),part(5,0,2,2,'black'),part(0,2,4,1,'green'),part(4,2,4,1,'green'),
    part(1,3,4,2,'black'),part(5,3,2,2,'black')];
  const proposal=proposeCourseFeatures(items,floor(items));coverage(proposal,items);
  assert.equal(proposal.length,1);assert.equal(proposal[0].kind,'cross-section');
});

test('a complete colored panel is one task while separated unequal patches remain separate',()=>{
  for(const turn of [false,true]){
    const items=Array.from({length:20},(_,i)=>part(i%5*2,Math.floor(i/5)*2,2,2,i===3?'red':'blue'))
      .map(b=>turn?{...b,x:20-b.z-b.d,z:b.x-6,w:b.d,d:b.w,color:b.color==='red'?'yellow':'green'}:b);
    const proposal=proposeCourseFeatures(items,floor(items));
    assert.equal(proposal.length,1);assert.equal(proposal[0].kind,'panel');coverage(proposal,items);
    const scattered=items.map((b,i)=>i===3?{...b,x:b.x+30}:b);
    const split=proposeCourseFeatures(scattered,floor(scattered));
    assert.ok(!split||split.length>1);
  }
});

test('groups exact repeated layouts but does not describe unequal instances as repetition',()=>{
  const items=[0,4,8].flatMap(x=>[part(x,0),part(x+1,0),part(x,2,1,1,'red')]);
  const proposal=proposeCourseFeatures(items,floor(items));coverage(proposal,items);
  assert.equal(proposal.length,1);assert.equal(proposal[0].kind,'pattern');
  const unequal=items.map((b,i)=>i===items.length-1?{...b,color:'yellow'}:b);
  const changed=proposeCourseFeatures(unequal,floor(unequal));
  assert.ok(!changed||changed.length>1);if(changed)coverage(changed,unequal);
});

test('rejects unsupported, blocked, mixed-height, and oversized layouts',()=>{
  const items=rim();
  assert.equal(proposeCourseFeatures(items,[]),null);
  assert.equal(proposeCourseFeatures(items,[...floor(items),{...items[0],id:'obstacle',y:3}]),null);
  const mixed=items.map((b,i)=>i?b:{...b,y:2});assert.equal(proposeCourseFeatures(mixed,floor(mixed)),null);
  const large=Array.from({length:97},(_,i)=>part(i,0));assert.equal(proposeCourseFeatures(large,floor(large)),null);
});

test('partitions a large connected area into complete strips instead of rejecting the entire feature',()=>{
  for(let turn=0;turn<4;turn++){
    const items=Array.from({length:40},(_,i)=>part(i%10*2,Math.floor(i/10)*2,2,2)).map(b=>{
      for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
      return {...b,x:b.x+30,z:b.z+30,color:turn?'green':'blue'};
    });
    const frozen=structuredClone(items),proposal=proposeCourseFeatures(items,floor(items));
    assert.ok(proposal);assert.equal(proposal.length,2);coverage(proposal,items);
    assert.ok(proposal.every(g=>g.kind==='panel'&&g.brickIds.length===20));
    assert.equal(proposeCourseFeatures(items,[]),null);
    assert.deepEqual(items,frozen);
  }
});

function fragmentedTray(){
  const base=Array.from({length:16},(_,i)=>part(i%4*2,Math.floor(i/4)*2,2,2,'lightGray',0));
  const lower=base.map(b=>({...b,id:`platform-${b.id}`,y:1,color:'lightGray'}));
  const border=rim().map(b=>({...b,id:`border-${b.id}`,y:2}));
  const all=[...base,...lower,...border];
  const brickModel={version:1,kind:'bricks',bricks:all.map(({id,...b})=>b)};
  // Use the planner's coordinate-based IDs, then build a deliberately fragmented
  // border from otherwise validated operations.
  const original=createAssemblyPlan({brickModel,integratedBuild:true});
  const m=original.modules[0];
  const actions=[0,1,2].flatMap(y=>original.bricks.filter(b=>b.y===y).map(b=>({kind:'course',brickIds:[b.id]})));
  const replay=[{...m,actions,actionOrder:true,brickOrder:actions.flatMap(a=>a.brickIds),placementGroups:actions.map(a=>a.brickIds)}];
  const plan=annotateActions(createAssemblyPlan({brickModel,moduleReplay:replay,integratedBuild:true}),replay);
  const instructionPlan=compactAssemblyPlan(plan).plan;
  return {brickModel,assemblyPlan:plan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('replays complete features with exact coverage, valid source references, and immutable geometry',()=>{
  const before=fragmentedTray(),frozen=structuredClone(before),after=refineCourseFeatures(before);
  assert.equal(after.featureRefinement.selected,true);assert.deepEqual(before,frozen);assert.equal(after.brickModel,before.brickModel);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);assert.equal(after.assemblyPlan.stats.blockedJoinCount,0);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.newBrickIds).sort(),ids(before.assemblyPlan.bricks));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
  const borderSteps=after.instructionPlan.steps.filter(s=>s.newBrickIds.some(id=>byId.get(id).y===2));
  assert.equal(borderSteps.length,1);assert.equal(borderSteps[0].newBrickIds.length,6);
  assert.equal(refineCourseFeatures(after),after);
});

test('ordinary unannotated placements receive the same complete-feature planning',()=>{
  const source=fragmentedTray();
  const ordinary=plan=>({...plan,steps:plan.steps.map(({instructionAction,...step})=>step)});
  const before={...source,assemblyPlan:ordinary(source.assemblyPlan),instructionPlan:ordinary(source.instructionPlan)};
  const after=refineCourseFeatures(before);
  assert.equal(after.featureRefinement.selected,true);
  const byId=new Map(after.instructionPlan.bricks.map(b=>[b.id,b]));
  const border=after.instructionPlan.steps.filter(s=>s.newBrickIds.some(id=>byId.get(id).y===2));
  assert.equal(border.length,1);assert.equal(border[0].newBrickIds.length,6);
  assert.deepEqual(after.brickModel,before.brickModel);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
});

test('replaying a feature does not introduce task boundaries into ordinary placements',()=>{
  const source=fragmentedTray();
  const assemblyPlan={...source.assemblyPlan,steps:source.assemblyPlan.steps.map(({instructionAction,...step})=>step)};
  const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  const before={...source,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
  const after=refineCourseFeatures(before);
  assert.equal(after.featureRefinement.selected,true);
  const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
  const ground=plan=>plan.steps.filter(s=>s.newBrickIds.length&&s.newBrickIds.every(id=>byId.get(id).y===0));
  assert.deepEqual(ground(after.instructionPlan).map(s=>s.newBrickIds),ground(before.instructionPlan).map(s=>s.newBrickIds));
  assert.ok(ground(after.assemblyPlan).every(s=>!s.instructionAction));
  assert.ok(after.instructionPlan.steps.length<before.instructionPlan.steps.length);
});

test('feature replay retains previously validated whole-layer diagrams outside the changed range',()=>{
  const before=fragmentedTray(),byId=new Map(before.assemblyPlan.bricks.map(b=>[b.id,b]));
  const at=y=>before.instructionPlan.steps.filter(s=>s.newBrickIds.every(id=>byId.get(id).y===y));
  const merge=steps=>({...steps.at(-1),sourceStepIds:steps.flatMap(s=>s.sourceStepIds),orderedOperations:steps.flatMap(s=>s.orderedOperations),
    newBrickIds:steps.flatMap(s=>s.newBrickIds),highlightBrickIds:steps.flatMap(s=>s.highlightBrickIds)});
  const border=at(2);
  before.instructionPlan={...before.instructionPlan,steps:[merge(at(0)),merge(at(1)),merge(border.slice(0,3)),merge(border.slice(3))]
    .map((s,i)=>({...s,id:`instruction-step-${i+1}`}))};
  before.guide=createGuideSections(before.instructionPlan);
  const after=refineCourseFeatures(before);
  assert.equal(after.featureRefinement.selected,true,JSON.stringify(after.featureRefinement));
  assert.equal(after.instructionPlan.steps.length,3);
  assert.deepEqual(after.instructionPlan.steps.slice(0,2).map(s=>s.newBrickIds),before.instructionPlan.steps.slice(0,2).map(s=>s.newBrickIds));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.orderedOperations.map(o=>o.id)),after.assemblyPlan.steps.map(s=>s.id));
});
