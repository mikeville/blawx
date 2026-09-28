import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidatePlacementTasks} from '../src/placement-task-diagrams.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {chooseInstructionSequence} from '../src/instruction-visibility.js';
import {createGuideSections} from '../src/guide-sections.js';

function columns({courses=4,width=2,depth=1,smallParts=false,transform=b=>b}={}){
  const batches=[];
  const layer=(y,column)=>{
    const out=[];
    for(let x=0;x<width;x+=smallParts?1:width)for(let z=0;z<depth;z+=smallParts?1:depth)
      out.push(transform({id:`b-${column}-${y}-${x}-${z}`,x:column*(width+3)+x,y,z,w:smallParts?1:width,d:smallParts?1:depth,color:y?'blue':'black'}));
    return out;
  };
  batches.push(layer(0,0),layer(0,1));
  for(let y=1;y<=courses;y++)batches.push([...layer(y,0),...layer(y,1)]);
  const bricks=batches.flat(),visible=[],canonical=[],steps=[];
  for(const [i,batch]of batches.entries()){
    const operations=[];
    for(const b of batch){
      visible.push(b.id);
      const s={id:`source-${b.id}`,kind:'build',moduleId:'m',label:'Columns',newBrickIds:[b.id],highlightBrickIds:[b.id],visibleBrickIds:[...visible],issues:[],insertionDirection:'down'};
      canonical.push(s);operations.push({id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,issues:[],insertionDirection:'down'});
    }
    steps.push({...canonical.at(-1),id:`s-${i}`,newBrickIds:batch.map(b=>b.id),highlightBrickIds:batch.map(b=>b.id),
      sourceStepIds:operations.map(o=>o.id),orderedOperations:operations,
      ...(i>=2?{instructionAction:{id:`action-${i}`,kind:'feature',destination:{kind:'pattern'}}}:{})});
  }
  const modules=[{id:'m',kind:'grounded',label:'Columns',brickIds:bricks.map(b=>b.id)}];
  const assemblyPlan={version:1,bricks,modules,steps:canonical,stats:{stepCount:canonical.length}},instructionPlan={...assemblyPlan,steps};
  return {brickModel:{bricks},assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

function unchangedConstruction(before,after){
  assert.equal(after.assemblyPlan,before.assemblyPlan);assert.equal(after.brickModel,before.brickModel);
  for(const key of ['newBrickIds','sourceStepIds','orderedOperations'])assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s[key]),before.instructionPlan.steps.flatMap(s=>s[key]));
  const views=chooseInstructionSequence(after.instructionPlan);
  for(const s of after.instructionPlan.steps.filter(s=>s.placementTask)){
    assert.equal(views.get(s.id).passes,true);assert.equal(views.get(s.id).visibleHighlightBrickCount,s.newBrickIds.length);
  }
}

test('combines exact base layouts and balanced upright tasks without reordering construction',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'green':'tan'})]){
    const before=columns({transform}),frozen=structuredClone(before),after=consolidatePlacementTasks(before);
    assert.equal(after.instructionPlan.steps.length,3);
    assert.deepEqual(after.instructionPlan.steps.map(s=>s.placementTask.kind),['ground-layout','upright-layers','upright-layers']);
    assert.deepEqual(after.instructionPlan.steps.slice(1).map(s=>s.placementTask.layerCount),[2,2]);
    unchangedConstruction(before,after);assert.deepEqual(before,frozen);assert.equal(consolidatePlacementTasks(after),after);
    const numbering={byStepId:new Map(after.instructionPlan.steps.map((s,i)=>[s.id,i+1]))};
    const ground=createStepGuidance(after.instructionPlan,after.instructionPlan.steps[0],numbering);
    assert.match(ground.instruction,/flat table/);assert.doesNotMatch(ground.instruction,/connect.*next/);
    assert.equal(ground.map.bricks.length,2);
    assert.match(createStepGuidance(after.instructionPlan,after.instructionPlan.steps[1],numbering).instruction,/2 matching layers.*bottom up/);
  }
});

test('keeps upright courses separate when lower additions would be hidden',()=>{
  const before=columns({courses:2,width:3,depth:2,smallParts:true}),after=consolidatePlacementTasks(before);
  assert.ok(after.placementTaskConsolidation.tasks.every(t=>t.kind==='ground-layout'));
  assert.deepEqual(after.instructionPlan.steps.filter(s=>!s.placementTask),before.instructionPlan.steps.slice(2));
  unchangedConstruction(before,after);
});

test('protects warnings, joins, upward operations, accepted recipes and source coverage',()=>{
  for(const change of [r=>{r.assemblyPlan.modules[0].buildContext={kind:'work-surface'};},
    r=>{for(const s of r.instructionPlan.steps)s.issues=[{code:'temporary-hold'}];},
    r=>{for(const s of r.instructionPlan.steps)s.kind='join';},
    r=>{for(const s of r.instructionPlan.steps)s.insertionDirection='up';},
    r=>{for(const s of r.instructionPlan.steps)s.instructionAction={kind:'complete-layer'};},
    r=>{for(const s of r.instructionPlan.steps)s.sourceStepIds=['missing'];}]){
    const before=columns();change(before);const frozen=structuredClone(before);
    assert.equal(consolidatePlacementTasks(before),before);assert.deepEqual(before,frozen);
  }
});

test('unequal or tapering uprights do not become a repeated-layer task',()=>{
  for(const transform of [b=>b.y===2?{...b,color:'red'}:b,b=>b.y===2?{...b,x:b.x+1}:b]){
    const before=columns({courses:2,transform}),after=consolidatePlacementTasks(before);
    assert.ok(after.placementTaskConsolidation.tasks.every(t=>t.kind==='ground-layout'));
    unchangedConstruction(before,after);
  }
});

function fragmentedCourse({planned=true,transform=b=>b}={}){
  const r=columns({courses:1,width:3,depth:2,smallParts:true,transform});
  const top=r.instructionPlan.steps.pop(),sources=new Map(r.assemblyPlan.steps.map(s=>[s.id,s]));
  const pieces=top.orderedOperations,groups=[pieces.slice(0,5),pieces.slice(5,11),pieces.slice(11)];
  for(const [i,operations]of groups.entries()){
    const last=sources.get(operations.at(-1).id),ids=operations.flatMap(o=>o.newBrickIds);
    r.instructionPlan.steps.push({...last,id:`fragment-${i}`,newBrickIds:ids,highlightBrickIds:[...ids],
      sourceStepIds:operations.map(o=>o.id),orderedOperations:operations,
      ...(planned?{instructionAction:{kind:'course',id:`course-${i}`}}:{})});
  }
  r.guide=createGuideSections(r.instructionPlan);return r;
}

test('completes fragmented supported courses with or without generic course annotations',()=>{
  for(const planned of [true,false])for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='blue'?'yellow':'tan'})]){
    const before=fragmentedCourse({planned,transform}),frozen=structuredClone(before),after=consolidatePlacementTasks(before);
    const merged=after.instructionPlan.steps.filter(s=>s.placementTask?.kind==='supported-course');
    assert.equal(merged.length,1);assert.equal(merged[0].newBrickIds.length,12);
    unchangedConstruction(before,after);assert.deepEqual(before,frozen);assert.equal(consolidatePlacementTasks(after),after);
  }
});

test('supported-course consolidation preserves meaningful action boundaries and needs preexisting support',()=>{
  for(const alter of [r=>{for(const s of r.instructionPlan.steps.slice(2))s.instructionAction={kind:'feature',destination:{kind:'panel'}};},
    r=>{for(const s of r.instructionPlan.steps.slice(2))s.instructionAction.destination={kind:'layer'};},
    r=>{for(const s of r.instructionPlan.steps.slice(2))s.visibleBrickIds=s.visibleBrickIds.filter(id=>!id.includes('-0-'));},
    r=>{for(const b of r.instructionPlan.bricks)if(b.y===0)b.y=2;}]){
    const before=fragmentedCourse();alter(before);const after=consolidatePlacementTasks(before);
    assert.ok(!after.placementTaskConsolidation?.tasks.some(t=>t.kind==='supported-course'));
    assert.deepEqual(after.instructionPlan.steps.filter(s=>s.id.startsWith('fragment-')),before.instructionPlan.steps.slice(2));
    assert.equal(after.assemblyPlan,before.assemblyPlan);
  }
});

test('generic ground courses can complete a layout without overriding an explicit foundation recipe',()=>{
  for(const kind of ['course','foundation']){
    const before=columns({courses:0});for(const s of before.instructionPlan.steps)s.instructionAction={kind,id:s.id};
    const after=consolidatePlacementTasks(before);
    if(kind==='foundation')assert.equal(after,before);
    else {assert.equal(after.instructionPlan.steps.length,1);unchangedConstruction(before,after);}
  }
});

test('recognizes matching upright courses without a prior feature annotation',()=>{
  for(const annotated of [false,true])for(const transform of [b=>b,b=>({...b,x:30-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.y?'yellow':'tan'})]){
    const before=columns({courses:7,transform});
    for(const s of before.instructionPlan.steps.slice(2)){
      if(annotated)s.instructionAction={kind:'course',id:s.id};
      else delete s.instructionAction;
    }
    const frozen=structuredClone(before),after=consolidatePlacementTasks(before);
    const tasks=after.instructionPlan.steps.filter(s=>s.placementTask?.kind==='upright-layers');
    assert.equal(tasks.length,3);
    assert.deepEqual(tasks.map(s=>s.placementTask.layerCount).sort(),[2,2,3]);
    unchangedConstruction(before,after);assert.deepEqual(before,frozen);
    assert.equal(consolidatePlacementTasks(after),after);
  }
});

test('ordinary upright recognition retains visibility, shape, support and intentional boundaries',()=>{
  const changes=[
    r=>{for(const b of r.instructionPlan.bricks)if(b.y===2)b.color='red';},
    r=>{for(const b of r.instructionPlan.bricks)if(b.y===2)b.x++;},
    r=>{for(const s of r.instructionPlan.steps.slice(2))s.instructionAction={kind:'feature',destination:{kind:'panel'}};},
    r=>{r.instructionPlan.steps[2].issues=[{code:'temporary-hold'}];},
    r=>{for(const s of r.instructionPlan.steps.slice(2))s.visibleBrickIds=s.visibleBrickIds.filter(id=>!id.includes('-0-'));},
    r=>{for(const s of r.instructionPlan.steps.slice(2))s.buildRegion={id:'deliberate-area'};},
  ];
  for(const alter of changes){
    const before=columns({courses:2});for(const s of before.instructionPlan.steps.slice(2))delete s.instructionAction;
    alter(before);const after=consolidatePlacementTasks(before);
    assert.ok(!after.placementTaskConsolidation?.tasks.some(t=>t.kind==='upright-layers'));
    assert.deepEqual(after.instructionPlan.steps.filter(s=>!s.placementTask),before.instructionPlan.steps.slice(2));
    unchangedConstruction(before,after);
  }
  const hidden=columns({courses:2,width:3,depth:2,smallParts:true});
  for(const s of hidden.instructionPlan.steps.slice(2))delete s.instructionAction;
  const after=consolidatePlacementTasks(hidden);
  assert.ok(!after.placementTaskConsolidation?.tasks.some(t=>t.kind==='upright-layers'));
  unchangedConstruction(hidden,after);
});
