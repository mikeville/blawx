import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeGroundLayout} from '../src/ground-layout.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';

function fixture(turn=0,gap=false) {
  const bricks=[];
  for(let z=0;z<4;z+=2)for(let x=0;x<16;x++)bricks.push({x:x+(gap&&x>=8?5:0),y:0,z,w:1,d:2,color:turn?'green':'tan'});
  bricks.push({x:0,y:1,z:0,w:4,d:2,color:'blue'});
  const rotated=bricks.map(b=>{for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};return {...b,x:b.x+12,z:b.z+12};});
  const brickModel={version:1,kind:'bricks',bricks:rotated},assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true});
  const steps=assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id],orderedOperations:[{id:s.id,kind:s.kind,
    newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}));
  const instructionPlan={...assemblyPlan,steps};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),assemblyEvaluation:{compaction:{sourceStepCoverageComplete:true,brickCoverageComplete:true}}};
}

test('initial base is laid out as balanced whole regions without changing subsequent construction',()=>{
  for(let turn=0;turn<4;turn++) {
    const before=fixture(turn),snapshot=structuredClone(before),after=completeGroundLayout(before);
    assert.ok(after.groundLayoutPlanning);
    assert.equal(after.groundLayoutPlanning.parts,32);
    assert.equal(after.groundLayoutPlanning.afterDiagrams,2);
    const old=before.assemblyPlan.steps.filter(s=>s.newBrickIds.some(id=>before.assemblyPlan.bricks.find(b=>b.id===id).y>0));
    assert.deepEqual(after.assemblyPlan.steps.filter(s=>!s.groundLayout),old);
    const diagrams=after.instructionPlan.steps.filter(s=>s.groundLayout);
    assert.deepEqual(diagrams.map(s=>s.newBrickIds.length),[16,16]);
    assert.deepEqual(after.instructionPlan.steps.filter(s=>!s.groundLayout),before.instructionPlan.steps.filter(s=>old.some(o=>o.id===s.id)));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const added=after.assemblyPlan.steps.flatMap(s=>s.newBrickIds);
    assert.equal(added.length,after.assemblyPlan.bricks.length);assert.equal(new Set(added).size,added.length);
    assert.deepEqual(after.brickModel,before.brickModel);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,before.assemblyPlan.stats.unresolvedBrickCount);
    assert.deepEqual(before,snapshot);assert.equal(completeGroundLayout(after),after);
    const guidance=createStepGuidance(after.instructionPlan,diagrams.at(-1),{byStepId:new Map()});
    assert.match(guidance.instruction,/Complete the base outline/);
  }
});

test('separate footprints and established assembly actions retain their original layout',()=>{
  const separate=fixture(0,true);
  const separated=completeGroundLayout(separate),first=separate.assemblyPlan.modules[0];
  assert.ok(separated.assemblyPlan.steps.filter(s=>s.groundLayout).every(s=>s.newBrickIds.every(id=>first.brickIds.includes(id))));
  assert.deepEqual(separated.assemblyPlan.steps.filter(s=>s.moduleId!==first.id),separate.assemblyPlan.steps.filter(s=>s.moduleId!==first.id));
  const planned=fixture();planned.assemblyPlan.steps[0].instructionAction={kind:'foundation',id:'planned-foundation'};
  assert.equal(completeGroundLayout(planned),planned);
  const raised=fixture();raised.assemblyPlan.steps[0].visibleBrickIds.push('preexisting-scene');
  assert.equal(completeGroundLayout(raised),raised);
});
