import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlacementGroups, spatialRegions, placementFootprint, groupPlacementOperations} from '../src/placement-groups.js';
const brick=(id,x,z,w=2,d=4)=>({id,x,y:1,z,w,d,color:'blue'});

test('broad tiled surfaces become compact adjacent patches under rotation and reflection',()=>{
  const tiles=Array.from({length:16},(_,i)=>brick(`b${i}`,(i%8)*2,Math.floor(i/8)*4));
  for(const transform of [b=>b,b=>({...b,x:b.z,z:b.x,w:b.d,d:b.w}),b=>({...b,x:-b.x-b.w,color:'red'})]){
    const bricks=tiles.map(transform),byId=new Map(bricks.map(b=>[b.id,b]));
    const groups=createPlacementGroups(bricks);
    assert.deepEqual([...groups.flat()].sort(),bricks.map(b=>b.id).sort());
    for(const ids of groups){const patch=ids.map(id=>byId.get(id));assert.equal(spatialRegions(patch).length,1);assert.equal(placementFootprint(patch).fill,1);}
  }
});

test('existing underlying geometry cannot turn separate additions into a placement patch',()=>{
  const pieces=[brick('a',0,0),brick('b',2,0),brick('c',10,0),brick('d',10,4)];
  const groups=createPlacementGroups(pieces);
  assert.equal(groups.length,2);
  assert.deepEqual(groups,[['a','b'],['c','d']]);
});

test('presentation fallback splits only independent clean placements and preserves warning operations',()=>{
  const bricks=[brick('old',0,0),brick('a',0,0),brick('b',10,0)];bricks[0].y=0;
  const clean={id:'s1',moduleId:'m',kind:'build',newBrickIds:['a','b'],highlightBrickIds:['a','b'],visibleBrickIds:['old','a','b'],issues:[]};
  const warning={...clean,id:'s2',kind:'unresolved',issues:[{code:'unsupported-addition',severity:'error',brickIds:['a']}]};
  const plan={bricks,steps:[clean,warning],stats:{}};const frozen=structuredClone(plan);
  const grouped=groupPlacementOperations(plan);
  assert.deepEqual(plan,frozen);assert.equal(grouped.steps.length,3);
  assert.deepEqual(grouped.steps[0].visibleBrickIds,['old','a']);
  assert.deepEqual(grouped.steps[1].visibleBrickIds,['old','a','b']);
  assert.deepEqual(grouped.steps[2].issues,warning.issues);
  assert.deepEqual(grouped.steps[2].newBrickIds,warning.newBrickIds);
});
