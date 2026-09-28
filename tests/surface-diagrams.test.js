import test from 'node:test';
import assert from 'node:assert/strict';
import {consolidateSurfaceDiagrams} from '../src/surface-diagrams.js';

function surface(transform=b=>b) {
  const bricks=[];
  for(let y=0;y<2;y++)for(let z=0;z<8;z+=2)for(let x=0;x<8;x+=2) {
    bricks.push(transform({id:`b-${x}-${y}-${z}`,x,y,z,w:2,d:2,color:y?'green':'black'}));
  }
  const base=bricks.slice(0,16).map(b=>b.id),top=bricks.slice(16).map(b=>b.id);
  // Deliberately ragged intermediate endpoints: only the completed layer is a rectangle.
  const batches=[base,top.slice(0,5),top.slice(5,11),top.slice(11)];
  const visible=[];
  const steps=batches.map((ids,i)=>{
    visible.push(...ids);
    return {id:`s${i}`,moduleId:'m',kind:'build',label:'Surface',issues:[],
      newBrickIds:ids,highlightBrickIds:[...ids],visibleBrickIds:[...visible],
      instructionAction:{id:`a${i}`,kind:i?'course':'layout-layer'},
      sourceStepIds:[`source-${i}`],orderedOperations:[{id:`source-${i}`,kind:'build',newBrickIds:[...ids]}]};
  });
  return {brickModel:{bricks},assemblyPlan:{bricks,steps},instructionPlan:{bricks,steps,
    modules:[{id:'m',label:'Surface',kind:'grounded',brickIds:bricks.map(b=>b.id)}],stats:{}}};
}

test('consolidates a whole supported surface across ragged source batches without changing operations',()=>{
  for(const transform of [b=>b,b=>({...b,x:20-b.z-b.d,z:b.x,w:b.d,d:b.w,color:b.color==='green'?'yellow':b.color})]) {
    const before=surface(transform),frozen=structuredClone(before),after=consolidateSurfaceDiagrams(before);
    assert.equal(after.instructionPlan.steps.length,2);
    assert.equal(after.instructionPlan.steps[1].newBrickIds.length,16);
    for(const key of ['newBrickIds','sourceStepIds','orderedOperations']) {
      assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s[key]),before.instructionPlan.steps.flatMap(s=>s[key]));
    }
    assert.deepEqual(before,frozen);
    assert.equal(after.assemblyPlan,before.assemblyPlan);
    assert.equal(after.brickModel,before.brickModel);
    assert.equal(consolidateSurfaceDiagrams(after),after);
  }
});

test('retains separate steps for stacked work, missing support, holes, and mixed colors',()=>{
  for(const transform of [
    b=>b.y?{...b,y:b.z<4?1:2}:b,
    b=>b.y===0?{...b,x:b.x+1}:b,
    b=>b.y&&b.x===0&&b.z===0?{...b,x:-2}:b,
    b=>b.y?{...b,color:b.x===0?'red':'green'}:b,
  ]) {
    const before=surface(transform);
    assert.equal(consolidateSurfaceDiagrams(before),before);
  }
});

test('does not merge across attachments, warnings, modules, or planned layer boundaries',()=>{
  for(const change of [
    s=>{s.kind='join';},s=>{s.issues=['check connection'];},
    s=>{s.moduleId='other';},s=>{s.instructionAction.kind='complete-layer';},
    s=>{s.insertionDirection='up';},
  ]) {
    const before=surface();change(before.instructionPlan.steps[2]);
    assert.equal(consolidateSurfaceDiagrams(before),before);
  }
});

test('rejects a surface with an existing obstacle above its insertion path',()=>{
  const before=surface();
  const obstacle={id:'obstacle',x:0,y:3,z:0,w:2,d:2,color:'black'};
  before.instructionPlan.bricks.push(obstacle);
  before.instructionPlan.modules[0].brickIds.push(obstacle.id);
  before.instructionPlan.steps[0].newBrickIds.push(obstacle.id);
  for(const s of before.instructionPlan.steps)s.visibleBrickIds.push(obstacle.id);
  assert.equal(consolidateSurfaceDiagrams(before),before);
});
