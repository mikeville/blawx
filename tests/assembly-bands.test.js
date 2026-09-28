import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeAssemblyBands, refineAssemblyBands} from '../src/assembly-bands.js';
import {recipeBrickId} from '../src/assembly-recipes.js';
import {annotateActions, actionCompletionRejections} from '../src/assembly-actions.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';

const brick = (x,y,z,w,d,color='blue') => ({x,y,z,w,d,color});
const cells = bs => bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
const overlap = (a,b) => a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
function slab(length=14) {
  const result=[];
  for(let z=0;z<length;z+=4)for(let x=0;x<8;x+=2)result.push(brick(x,1,z,2,Math.min(4,length-z),'black'));
  for(let z=0;z<length;) {
    const d=z===0?1:Math.min(2,length-z);
    for(let x=0;x<8;x+=4)result.push(brick(x,2,z,4,d));
    z+=d;
  }
  for(let z=0;z<length;z+=2)for(const [x,w]of [[0,2],[2,4],[6,2]])result.push(brick(x,3,z,w,Math.min(2,length-z)));
  return result;
}
function replayProposal(proposal) {
  const supports=[brick(0,0,0,2,2,'red'),brick(6,0,0,2,2,'red'),brick(0,0,12,2,2,'red'),brick(6,0,12,2,2,'red')];
  const source={version:1,kind:'bricks',bricks:[...supports,...proposal.bricks.map(({id,...b})=>b)]};
  const all=source.bricks.map(b=>({...b,id:recipeBrickId(b)}));
  const base={id:'base',label:'Base',kind:'grounded',brickIds:all.filter(b=>b.y===0).map(b=>b.id)};
  base.brickOrder=[...base.brickIds];
  const ids=proposal.bricks.map(b=>b.id);
  const module={id:'surface',label:'Surface',kind:'detail',groupType:'work-surface',brickIds:ids,
    buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'},actions:proposal.actions,actionOrder:true,
    brickOrder:proposal.actions.flatMap(a=>a.brickIds),placementGroups:proposal.actions.map(a=>a.brickIds)};
  return {source,plan:annotateActions(createAssemblyPlan({brickModel:source,moduleReplay:[base,module]}),[base,module])};
}

test('completed bands preserve colored occupancy and advance without holes across transformed surfaces',()=>{
  for(const length of [13,14,18])for(const transform of [b=>b,b=>({...b,x:24-b.z-b.d,z:b.x,w:b.d,d:b.w}),b=>({...b,x:20-b.x-b.w})]) {
    const original=slab(length).map(transform), frozen=structuredClone(original);
    const proposal=proposeAssemblyBands(original);
    assert.ok(proposal);
    assert.deepEqual(original,frozen);
    assert.deepEqual(cells(proposal.bricks),cells(original));
    assert.deepEqual(proposal.actions.flatMap(a=>a.brickIds).sort(),proposal.bricks.map(b=>b.id).sort());
    const byId=new Map(proposal.bricks.map(b=>[b.id,b]));
    let priorEnd;
    for(const action of proposal.actions.filter(a=>a.kind==='complete-band')) {
      const {axis,start,end}=action.destination;
      if(priorEnd!==undefined)assert.equal(start,priorEnd,'every completed band starts at the previous boundary');
      priorEnd=end;
      assert.ok(end-start>=2,'no one-stud cleanup remainder');
      const added=action.brickIds.map(id=>byId.get(id));
      const occupied=cells(added);
      assert.equal(occupied.length,8*(end-start),'a completed band covers its whole cross-section');
      assert.ok(added.every(b=>b[axis]>=start&&b[axis]+(axis==='x'?b.w:b.d)<=end));
    }
  }
});

test('every band has actual prior support, clear insertion, and a connected finished state',()=>{
  const proposal=proposeAssemblyBands(slab());
  const {plan}=replayProposal(proposal);
  assert.equal(plan.stats.unresolvedBrickCount,0);
  assert.equal(plan.stats.blockedJoinCount,0);
  assert.deepEqual(actionCompletionRejections(plan),[]);
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),seen=[];
  for(const step of plan.steps.filter(s=>s.moduleId==='surface'&&s.kind!=='join')) {
    for(const id of step.newBrickIds) {
      const b=byId.get(id);
      assert.ok(b.y===1||seen.some(a=>a.y+1===b.y&&overlap(a,b)),'support exists before placement');
      assert.ok(!seen.some(a=>a.y>b.y&&overlap(a,b)),'previously finished bands leave insertion clear');
      seen.push(b);
    }
    if(step.instructionAction.kind==='complete-band') {
      const connected=new Set([seen[0]]);
      for(const b of connected)for(const a of seen)if(Math.abs(b.y-a.y)===1&&overlap(a,b))connected.add(a);
      assert.equal(connected.size,seen.length,'finished surface can be lifted as one stud-connected section');
    }
  }
  assert.equal(seen.length,proposal.bricks.length);
  const compacted=compactAssemblyPlan(plan).plan;
  assert.equal(compacted.steps.filter(s=>s.instructionAction?.kind==='complete-band').length,proposal.bandCount);
});

test('band refinement preserves external recipes and the full attachment interface',()=>{
  const {source,plan}=replayProposal(proposeAssemblyBands(slab()));
  const compacted=compactAssemblyPlan(plan).plan;
  const before={brickModel:source,assemblyPlan:plan,instructionPlan:compacted,guide:createGuideSections(compacted),metrics:{conversionMs:0}};
  const frozen=structuredClone(before),after=refineAssemblyBands(before);
  assert.equal(after.bandRefinement[0].selected,true);
  assert.ok(after.bandRefinement[0].attempts.some(a=>a.bondOffset===0&&a.rejectionReasons.length),
    'aligned seams are rejected instead of becoming disconnected finished bands');
  assert.equal(after.bandRefinement[0].bondOffset,2,'crossing seams provide a connected alternative');
  assert.deepEqual(before,frozen);
  assert.deepEqual(cells(before.brickModel.bricks),cells(after.brickModel.bricks));
  assert.equal(after.assemblyPlan.stats.joinStudCount,before.assemblyPlan.stats.joinStudCount);
  assert.deepEqual(after.assemblyPlan.steps.filter(s=>s.moduleId==='base').map(s=>s.newBrickIds),before.assemblyPlan.steps.filter(s=>s.moduleId==='base').map(s=>s.newBrickIds));
});

test('irregular roofs and oversized loose foundations do not receive a forced band recipe',()=>{
  const source=slab();
  assert.equal(proposeAssemblyBands(source.filter(b=>!(b.y===3&&b.x===0&&b.z===0))),null);
  const colored=source.map(b=>b.y===3&&b.z===0?{...b,color:'red'}:b);
  assert.equal(proposeAssemblyBands(colored),null);
  const wide=source.map(b=>({...b,x:b.x*2,w:b.w*2}));
  assert.equal(proposeAssemblyBands(wide),null);
  assert.equal(proposeAssemblyBands(source,{bondOffset:-1}),null);
});

test('band guidance distinguishes extending, joining, and completing a surface',()=>{
  const {plan}=replayProposal(proposeAssemblyBands(slab()));
  const numbering={byStepId:new Map(plan.steps.map((s,i)=>[s.id,i+1]))};
  const first=plan.steps.find(s=>s.instructionAction?.destination?.ordinal===1);
  assert.match(createStepGuidance(plan,first,numbering).instruction,/flat table.*first strip/);
  const last=plan.steps.filter(s=>s.instructionAction?.kind==='complete-band').at(-1);
  assert.match(createStepGuidance(plan,last,numbering).instruction,/last strip.*complete this surface/);
});

test('layer-first actions finish each course before the next and retain connected completion',async()=>{
  const {proposeAssemblyLayers}=await import('../src/assembly-bands.js');
  const proposal=proposeAssemblyLayers(slab());
  assert.ok(proposal);assert.deepEqual(cells(proposal.bricks),cells(slab()));
  const byId=new Map(proposal.bricks.map(b=>[b.id,b]));
  const courses=proposal.actions.map(a=>new Set(a.brickIds.map(id=>byId.get(id).y)));
  assert.ok(courses.every(c=>c.size===1));
  const levels=courses.map(c=>[...c][0]);assert.deepEqual(levels,[...levels].sort((a,b)=>a-b));
  const {plan}=replayProposal(proposal);
  assert.deepEqual(actionCompletionRejections(plan),[]);
  const seen=[];
  for(const step of plan.steps.filter(s=>s.moduleId==='surface'&&s.kind==='build'))for(const id of step.newBrickIds) {
    const b=byId.get(id);
    assert.ok(b.y===1||seen.some(a=>a.y+1===b.y&&overlap(a,b)));
    assert.ok(!seen.some(a=>a.y>b.y&&overlap(a,b)));
    seen.push(b);
  }
  const compacted=compactAssemblyPlan(plan).plan;
  assert.equal(compacted.steps.filter(s=>s.moduleId==='surface'&&s.kind==='build').length,proposal.actions.length,
    'complete row layouts survive the ordinary twelve-piece compaction limit');
  assert.ok(compacted.steps.some(s=>s.newBrickIds.length>12));
});

test('layer ordering and exact coverage hold after rotations and palette changes',async()=>{
  const {proposeAssemblyLayers}=await import('../src/assembly-bands.js');
  for(const transform of [b=>({...b,color:b.color==='blue'?'yellow':b.color}),b=>({...b,x:24-b.z-b.d,z:b.x,w:b.d,d:b.w})]) {
    const original=slab(18).map(transform),proposal=proposeAssemblyLayers(original);
    assert.ok(proposal);assert.deepEqual(cells(proposal.bricks),cells(original));
    const courses=proposal.actions.map(a=>a.destination.course);
    assert.deepEqual(courses,[...courses].sort((a,b)=>a-b));
    assert.ok(proposal.actions.every(a=>a.brickIds.length<=18));
    assert.deepEqual(proposal.actions.flatMap(a=>a.brickIds).sort(),proposal.bricks.map(b=>b.id).sort());
  }
});
