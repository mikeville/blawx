import test from 'node:test';
import assert from 'node:assert/strict';
import {refineSupportedInstructionRuns, refineSupportedInstructionAreas, refineNestedInstructionRuns, refineNestedInstructionAreas} from '../src/supported-instruction-runs.js';
import {createGuideSections} from '../src/guide-sections.js';

// A short wall built as alternating two-course strips. A separate unresolved
// piece represents a global planning failure that must not veto this local fix.
function stripedWall({columns=4,transform=b=>b}={}){
  const brick=(id,x,y,color)=>transform({id,x,y,z:0,w:1,d:2,color});
  const batches=[Array.from({length:columns},(_,x)=>brick(`base-${x}`,x,0,'gray'))];
  for(let x=0;x<columns;x++)batches.push([brick(`lower-${x}`,x,1,'blue'),brick(`upper-${x}`,x,2,'yellow')]);
  batches.push([brick('unresolved',12,4,'red')]);
  const bricks=batches.flat(),visible=[],canonical=[],steps=[];
  for(const [i,batch]of batches.entries()){
    const issues=i===batches.length-1?[{code:'unsupported',brickIds:['unresolved']}]:[];
    const moduleId=issues.length?'loose':'wall',operations=[];
    for(const b of batch){
      visible.push(b.id);
      const s={id:`source-${b.id}`,moduleId,label:'Wall',kind:'build',newBrickIds:[b.id],highlightBrickIds:[b.id],
        visibleBrickIds:[...visible],insertionDirection:'down',issues};
      canonical.push(s);operations.push({...s});
    }
    steps.push({...operations.at(-1),id:`diagram-${i}`,newBrickIds:batch.map(b=>b.id),highlightBrickIds:batch.map(b=>b.id),
      sourceStepIds:operations.map(s=>s.id),orderedOperations:operations});
  }
  const modules=[{id:'wall',label:'Wall',kind:'grounded',brickIds:bricks.filter(b=>b.id!=='unresolved').map(b=>b.id)},
    {id:'loose',label:'Loose piece',kind:'floating',brickIds:['unresolved']}];
  const stats={stepCount:canonical.length,brickCount:bricks.length,coverageComplete:true,unresolvedBrickCount:1,rootFailureCount:1};
  const assemblyPlan={version:1,bricks,modules,steps:canonical,stats},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>b)},assemblyPlan,instructionPlan,
    guide:createGuideSections(instructionPlan),sequenceRefinement:{selected:false,rejectionReasons:['Unresolved assembly']}};
}
const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;

function verify(before,after){
  assert.equal(after.brickModel,before.brickModel);
  assert.deepEqual(after.assemblyPlan.steps.at(-1),before.assemblyPlan.steps.at(-1));
  assert.deepEqual(after.instructionPlan.steps.at(-1),before.instructionPlan.steps.at(-1));
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,1);
  assert.deepEqual(after.sequenceRefinement,before.sequenceRefinement);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),before.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort());
  const byId=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b])),placed=[],old=new Map(before.assemblyPlan.steps.map(s=>[s.id,s]));
  for(const step of after.assemblyPlan.steps){
    const original=old.get(step.sourceOperationId??step.id);assert.ok(original);
    for(const id of step.newBrickIds){
      assert.ok(original.newBrickIds.includes(id));
      const b=byId.get(id);
      if(!step.issues.length&&b.y){
        const supports=placed.filter(p=>p.y===b.y-1&&overlap(p,b));assert.ok(supports.length);
        const expected=original.visibleBrickIds.filter(id=>!original.newBrickIds.includes(id)).map(id=>byId.get(id))
          .filter(p=>p.y===b.y-1&&overlap(p,b));
        assert.ok(expected.every(p=>supports.some(s=>s.id===p.id)));
        assert.ok(!placed.some(p=>p.y>b.y&&overlap(p,b)));
      }
      placed.push(b);
    }
    assert.deepEqual(new Set(step.visibleBrickIds),new Set(placed.map(b=>b.id)));
  }
}

test('repairs alternating strips despite global rejection, across rotation and palette changes',()=>{
  for(const transform of [b=>b,b=>({...b,x:10-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'red':'green'})]){
    const before=stripedWall({transform}),frozen=structuredClone(before),after=refineSupportedInstructionRuns(before);
    assert.equal(after.supportedRunRefinement.selected,true);
    assert.equal(after.supportedRunRefinement.diagramsRemoved,2);
    assert.deepEqual(after.instructionPlan.steps.slice(1,3).map(s=>s.newBrickIds),[
      ['lower-0','lower-1','lower-2','lower-3'],['upper-0','upper-1','upper-2','upper-3']]);
    assert.deepEqual(before,frozen);verify(before,after);
    assert.equal(refineSupportedInstructionRuns(after),after);
  }
});

test('does not reinterpret completed actions or offline component recipes',()=>{
  for(const protect of [r=>{r.assemblyPlan.modules[0].buildContext='offline';},r=>{
    for(const p of [r.assemblyPlan,r.instructionPlan])for(const s of p.steps)s.instructionAction={id:s.id,kind:'feature'};
  }]){
    const before=stripedWall();protect(before);assert.equal(refineSupportedInstructionRuns(before),before);
  }
});

test('warnings, joins, and upward operations are hard local boundaries',()=>{
  for(const change of [s=>{s.issues=[{code:'temporary-hold'}];},s=>{s.kind='join';},s=>{s.insertionDirection='up';}]){
    const before=stripedWall({columns:2});change(before.instructionPlan.steps[2]);
    assert.equal(refineSupportedInstructionRuns(before),before);
  }
});

test('rejects unavailable support, blocked insertion, and incorrect canonical coverage',()=>{
  for(const change of [r=>{r.instructionPlan.steps[1].visibleBrickIds=r.instructionPlan.steps[1].visibleBrickIds.filter(id=>!id.startsWith('base-'));},
    r=>{r.assemblyPlan.bricks.find(b=>b.id==='base-0').y=3;},
    r=>{r.instructionPlan.steps[1].sourceStepIds.pop();}]){
    const before=stripedWall({columns:2});change(before);const frozen=structuredClone(before);
    assert.equal(refineSupportedInstructionRuns(before),before);assert.deepEqual(before,frozen);
  }
});

test('plans an entire supported contour instead of stopping at short strip windows',()=>{
  const outline=[];
  for(let x=0;x<6;x++)for(let z=0;z<4;z++)if(x===0||x===5||z===0||z===3)outline.push({x,z});
  for(const rotate of [false,true]){
    const before=stripedWall({columns:outline.length,transform:b=>{
      if(b.id==='unresolved')return b;
      const {x,z}=outline[b.x];
      return {...b,x:rotate?20-z:x,z:rotate?x:z,w:1,d:1,color:b.color==='blue'?'green':'tan'};
    }}),frozen=structuredClone(before),after=refineSupportedInstructionAreas(before);
    assert.equal(after.supportedAreaRefinement.selected,true);
    assert.equal(after.supportedAreaRefinement.diagramsRemoved,14);
    assert.deepEqual(after.instructionPlan.steps.slice(1,-1).map(s=>s.newBrickIds.length),[16,16]);
    assert.ok(after.instructionPlan.steps.slice(1,-1).every(s=>s.instructionAction.destination.kind==='contour'));
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0]);
    assert.deepEqual(after.assemblyPlan.modules,before.assemblyPlan.modules);
    assert.deepEqual(before,frozen);verify(before,after);
    assert.equal(refineSupportedInstructionAreas(after),after);
  }
});

test('whole-area planning retains accepted actions and treats warnings and joins as boundaries',()=>{
  for(const change of [r=>{r.assemblyPlan.modules[0].buildContext={kind:'work-surface'};},
    r=>{r.instructionPlan.steps[5].instructionAction={id:'accepted',kind:'feature'};},
    r=>{r.instructionPlan.steps[5].issues=[{code:'temporary-hold'}];},
    r=>{r.instructionPlan.steps[5].kind='join';}]){
    const before=stripedWall({columns:10});change(before);
    assert.equal(refineSupportedInstructionAreas(before),before);
  }
});

test('whole-area proposals retain support and insertion checks and reject excessive work areas',()=>{
  for(const change of [r=>{r.instructionPlan.steps[1].visibleBrickIds=r.instructionPlan.steps[1].visibleBrickIds.filter(id=>!id.startsWith('base-'));},
    r=>{r.assemblyPlan.bricks.find(b=>b.id==='base-0').y=3;},
    r=>{r.instructionPlan.steps[1].sourceStepIds.pop();}]){
    const before=stripedWall({columns:10});change(before);const frozen=structuredClone(before);
    assert.equal(refineSupportedInstructionAreas(before),before);assert.deepEqual(before,frozen);
  }
  const oversized=stripedWall({columns:129});
  assert.equal(refineSupportedInstructionAreas(oversized),oversized);
});

function nestedWall(options){
  const result=stripedWall(options);
  result.assemblyPlan.modules[0].buildContext={kind:'work-surface',floorY:0};
  for(const plan of [result.assemblyPlan,result.instructionPlan])for(const step of plan.steps.filter(s=>s.moduleId==='wall')){
    step.nestedRecipe={id:'parent/wall',parentModuleId:'wall',separate:false,floorY:0,firstStepId:'source-base-0'};
  }
  return result;
}

test('nested task planning completes courses inside the parent scene without changing the table layout',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'red':'green'})]){
    const before=nestedWall({transform}),snapshot=structuredClone(before),after=refineNestedInstructionRuns(before);
    assert.equal(refineSupportedInstructionRuns(before),before,'ordinary passes still protect offline parents');
    assert.equal(after.supportedRunRefinement.diagramsRemoved,2);
    assert.deepEqual(after.instructionPlan.steps[0],before.instructionPlan.steps[0],'the table-supported floor is unchanged');
    assert.ok(after.instructionPlan.steps.slice(1,-1).every(s=>s.nestedRecipe.id==='parent/wall'));
    assert.deepEqual(before,snapshot);verify(before,after);
  }
});

test('nested task planning keeps child recipes, separate contexts and floor changes as hard boundaries',()=>{
  for(const change of [s=>{s.nestedRecipe={...s.nestedRecipe,separate:true};},
    s=>{s.nestedRecipe={...s.nestedRecipe,id:'parent/other'};},
    s=>{s.nestedRecipe={...s.nestedRecipe,floorY:1};}]){
    const before=nestedWall({columns:2});change(before.instructionPlan.steps[2]);
    assert.equal(refineNestedInstructionRuns(before),before);
  }
  const ordinary=stripedWall();assert.equal(refineNestedInstructionRuns(ordinary),ordinary);
});

test('nested whole-area planning preserves warnings and actual outside operations',()=>{
  const before=nestedWall({columns:10}),after=refineNestedInstructionAreas(before);
  assert.equal(after.supportedAreaRefinement.diagramsRemoved,8);verify(before,after);
  for(const change of [r=>{r.instructionPlan.steps[1].visibleBrickIds=[];},
    r=>{r.instructionPlan.steps[5].issues=[{code:'temporary-hold'}];},
    r=>{r.instructionPlan.steps[5].kind='join';}]){
    const blocked=nestedWall({columns:10});change(blocked);
    assert.equal(refineNestedInstructionAreas(blocked),blocked);
  }
});
