import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {refineRepeatedSupports} from '../src/assembly-supports.js';
import {deriveGuidePresentation} from '../src/guide-presentation.js';

function supports(turn=0){
  const b=(x,y,w,d=2)=>({x,y,z:0,w,d,color:'tan'});
  const bricks=[...[0,1,2,3].flatMap(y=>[b(0,y,2),b(6,y,2)]),b(3,3,2,1),
    b(0,4,4),b(4,4,4),b(0,5,2),b(2,5,4),b(6,5,2)].map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+10,z:b.z+10,color:turn?'blue':'tan'};
  });
  const brickModel={version:1,kind:'bricks',bricks};
  const identified=createAssemblyPlan({brickModel,integratedBuild:true});
  const workSurfaceBrickIds=identified.bricks.filter(b=>b.y>=4).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds,workSurfaceOrder:'connected-patches'});
  return prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}});
}

test('support completion stops below the platform and does not invent a grounded unit for an orphan',()=>{
  const before=supports(),plan=before.assemblyPlan;
  const replay=plan.modules.map(m=>({...m,brickOrder:plan.steps.filter(s=>s.moduleId===m.id).flatMap(s=>s.newBrickIds)}));
  const frozen=structuredClone(before),after=refineRepeatedSupports(before);
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const originalBand=replay.find(m=>m.buildContext),band=after.assemblyPlan.modules.find(m=>m.buildContext);
  assert.deepEqual(band.brickIds,originalBand.brickIds);
  const units=after.assemblyPlan.modules.filter(m=>m.kind==='grounded');
  assert.equal(units.length,2);
  assert.ok(units.every(m=>m.brickIds.length===4&&m.brickIds.some(id=>byId.get(id).y===0)));
  assert.ok(units.every(m=>m.brickIds.every(id=>byId.get(id).y<band.buildContext.floorY)));
  assert.equal(after.assemblyPlan.modules.find(m=>m.groupType==='detached-parts').brickIds.length,1);
  assert.deepEqual(before,frozen);
});

test('exact supports become a repeated recipe while the attachment and orphan warning remain literal',()=>{
  for(let turn=0;turn<4;turn++){
    const before=supports(turn),snapshot=structuredClone(before),after=refineRepeatedSupports(before);
    assert.equal(after.repeatedSupportRefinement?.selected,true);
    assert.equal(after.repeatedSupportRefinement.repeatCount,2);
    assert.equal(after.brickModel,before.brickModel);
    const oldBase=before.assemblyPlan.modules[0].id;
    for(const key of ['assemblyPlan','instructionPlan']){
      assert.deepEqual(after[key].steps.filter(s=>before[key].steps.some(o=>o.id===s.id&&o.moduleId!==oldBase)),before[key].steps.filter(s=>s.moduleId!==oldBase));
      const oldBad=before[key].steps.filter(s=>s.issues.length);
      for(const old of oldBad){const next=after[key].steps.find(s=>s.id===old.id);
        assert.deepEqual(next.issues,old.issues);assert.deepEqual(next.newBrickIds,old.newBrickIds);assert.deepEqual(next.visibleBrickIds,old.visibleBrickIds);
      }
    }
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,before.assemblyPlan.stats.unresolvedBrickCount);
    assert.deepEqual(after.assemblyPlan.graph,before.assemblyPlan.graph);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const p=deriveGuidePresentation({plan:after.instructionPlan,guide:after.guide});
    assert.ok(p.sections.some(s=>s.repeatCount===2));
    assert.deepEqual(before,snapshot);assert.equal(refineRepeatedSupports(after),after);
  }
});

test('a failed attachment cannot justify a shared receiving-support recipe',()=>{
  const before=supports();before.assemblyPlan.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion',severity:'error'});
  assert.equal(refineRepeatedSupports(before),before);
});
