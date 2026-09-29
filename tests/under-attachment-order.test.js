import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {deriveGuidePresentation} from '../src/guide-presentation.js';
import {scheduleUnderAttachments} from '../src/under-attachment-order.js';

function fixture({turn=0,blocked=false}={}) {
  const b=(x,y,w=1,color='tan')=>({x,y,z:0,w,d:1,color});
  const bricks=[b(0,0),b(0,1),b(0,2),b(1,2,1,'red'),b(0,3,2),b(0,4,2),...(blocked?[b(1,0)]:[])].map(b=>{
    for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+10,z:b.z+10,color:turn?(b.color==='red'?'blue':'white'):b.color};
  });
  const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel});
  const under=identified.bricks.filter(b=>['red','blue'].includes(b.color)).map(b=>b.id);
  const top=identified.bricks.filter(b=>b.y>=3).map(b=>b.id);
  const base=identified.bricks.filter(b=>!under.includes(b.id)&&!top.includes(b.id)).map(b=>b.id);
  const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:[...base,...under]},
    {id:'platform',label:'Platform',kind:'detail',groupType:'work-surface',brickIds:top,
      buildContext:{kind:'work-surface',floorY:3,orderPolicy:'course-first'}}].map(m=>({...m,brickOrder:m.brickIds}));
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,integratedBuild:true});
  // The support-recipe pass separates unresolved residue from completed bases.
  const baseModule=assemblyPlan.modules[0];
  assemblyPlan.modules=[{...baseModule,brickIds:base,status:'ready'},
    {id:'early',label:'Unresolved support detail',kind:'floating',status:'unresolved',brickIds:under,componentIds:baseModule.componentIds},assemblyPlan.modules[1]];
  assemblyPlan.steps=assemblyPlan.steps.map(s=>s.newBrickIds.length&&s.newBrickIds.every(id=>under.includes(id))?{...s,moduleId:'early'}:s);
  assemblyPlan.stats.moduleCount=3;
  const compacted=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan),assemblyEvaluation:{compaction:compacted.report}};
}
const payload=s=>({id:s.id,moduleId:s.moduleId,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection});

test('a premature hanging detail moves after its upper assembly joins without rewriting other recipes',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture({turn}),snapshot=structuredClone(before),after=scheduleUnderAttachments(before);
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,1);
    assert.equal(after.underAttachmentOrdering?.selected,true);
    assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.equal(after.assemblyPlan.stats.upwardInsertionBrickCount,1);
    const presentation=deriveGuidePresentation({plan:after.instructionPlan,guide:after.guide});
    assert.ok(presentation.sections.some(section=>section.label==='Underside'));
    assert.equal(after.brickModel,before.brickModel);
    const steps=after.assemblyPlan.steps,up=steps.find(s=>s.insertionDirection==='up');
    assert.equal(steps[steps.indexOf(up)-1].kind,'join');
    assert.ok(up.visibleBrickIds.includes(up.newBrickIds[0]));
    for(const key of ['assemblyPlan','instructionPlan']){
      const old=before[key].steps.filter(s=>s.moduleId!=='early');
      const ids=new Set(old.map(s=>s.id));
      assert.deepEqual(after[key].steps.filter(s=>ids.has(s.id)).map(payload),old.map(payload));
      assert.equal(after[key].steps.length,before[key].steps.length);
    }
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),steps.map(s=>s.id));
    assert.equal(new Set(steps.flatMap(s=>s.newBrickIds)).size,before.brickModel.bricks.length);
    assert.deepEqual(before,snapshot);
    assert.equal(scheduleUnderAttachments(after),after);
  }
});

test('a lower sweep obstruction or failed receiving join remains unresolved',()=>{
  for(const options of [{blocked:true},{failedJoin:true}]){
    const before=fixture(options);
    if(options.failedJoin)before.assemblyPlan.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion',severity:'error'});
    const snapshot=structuredClone(before),after=scheduleUnderAttachments(before);
    assert.equal(after,before);assert.deepEqual(before,snapshot);
  }
});
