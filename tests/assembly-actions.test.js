import test from 'node:test';
import assert from 'node:assert/strict';
import {planAssemblyActions, actionReplay, annotateActions} from '../src/assembly-actions.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {proposeSharedRecipes, mapRecipe, recipeBrickId, shareRecipeActions} from '../src/assembly-recipes.js';

const brick=(x,y,z,w=2,d=2,color='blue')=>({x,y,z,w,d,color});
const identify=bs=>bs.map(b=>({...b,id:recipeBrickId(b)}));
const descriptor=(bs,id)=>({id,label:id,kind:'grounded',brickIds:bs.map(b=>b.id),brickOrder:bs.map(b=>b.id)});

test('a new offset tile foundation is built in bounded layouts followed by connecting courses',()=>{
  const source=Array.from({length:8},(_,x)=>brick(x,1,0,1,4));
  source.push(brick(0,2,0,4,2,'green'),brick(4,2,0,4,2,'green'),
    brick(0,2,2,3,2,'green'),brick(3,2,2,2,2,'green'),brick(5,2,2,3,2,'green'));
  for(const transform of [b=>b,b=>({...b,x:b.z,z:b.x,w:b.d,d:b.w}),b=>({...b,x:-b.x-b.w})]) {
    const pieces=identify(source.map(transform));
    const actions=planAssemblyActions(pieces,{workSurface:true,width:4});
    assert.deepEqual(actions.flatMap(a=>a.brickIds).sort(),pieces.map(b=>b.id).sort());
    const byId=new Map(pieces.map(b=>[b.id,b]));
    for(let i=0;i<actions.length;i++) {
      assert.equal(new Set(actions[i].brickIds.map(id=>byId.get(id).y)).size,1);
      if(actions[i].kind==='foundation') {
        assert.ok(actions[i].brickIds.length<=4);
        assert.equal(actions[i+1].kind,'bond');
      }
    }
  }
});

test('deliberate course actions survive compaction and an unsupported action is rejected',()=>{
  const brickModel={version:1,kind:'bricks',bricks:[brick(0,0,0),brick(0,1,0),brick(0,2,0)]};
  const before=createAssemblyPlan({brickModel});const module=before.modules[0];
  const replay=[actionReplay(module,before.bricks)];
  const plan=annotateActions(createAssemblyPlan({brickModel,moduleReplay:replay}),replay);
  assert.equal(compactAssemblyPlan(plan).plan.steps.length,3);
  const reversed={...replay[0],brickOrder:[...replay[0].brickOrder].reverse()};
  assert.throws(()=>createAssemblyPlan({brickModel,moduleReplay:[reversed]}),/prerequisites/);
});

test('repeated components reuse exact packing and courses across rotated placements',()=>{
  const base=identify([brick(0,0,0),brick(0,1,0,1,2),brick(1,1,0,1,2,'red')]);
  const target=mapRecipe(base,[brick(10,0,8)],1);
  // Same colored occupancy, independently tiled into smaller foundation bricks.
  const split=identify([brick(10,0,8,1,2),brick(11,0,8,1,2),...target.filter(b=>b.y>0)]);
  const brickModel={version:1,kind:'bricks',bricks:[...base,...split]};const frozen=structuredClone(brickModel);
  const proposed=proposeSharedRecipes(brickModel,[descriptor(base,'a'),descriptor(split,'b')]);
  assert.equal(proposed.families.length,1);assert.equal(proposed.changes.length,0);
  assert.equal(proposed.replay[1].brickIds.length,base.length);
  const identified=identify(proposed.brickModel.bricks),byId=new Map(identified.map(b=>[b.id,b]));
  const replay=shareRecipeActions(proposed.replay.map(m=>actionReplay(m,m.brickIds.map(id=>byId.get(id)))),identified);
  assert.deepEqual(replay[0].actions.map(a=>a.brickIds.length),replay[1].actions.map(a=>a.brickIds.length));
  assert.deepEqual(brickModel,frozen);
});

test('small underside differences normalize only with adjustments and explicit repair provenance',()=>{
  const full=identify([brick(0,0,0),...Array.from({length:4},(_,i)=>brick(0,i+1,0))]);
  const smaller=identify([brick(10,0,0,1,2),brick(11,0,0,1,1,'red'),...Array.from({length:4},(_,i)=>brick(10,i+1,0))]);
  const brickModel={version:1,kind:'bricks',bricks:[...full,...smaller]},modules=[descriptor(smaller,'small'),descriptor(full,'full')];
  const options={adjustments:true,rawModel:{cells:[]},repairCells:[{x:11,y:0,z:0}]};
  // Two changed cells need at least 34 cells to fit the repair fraction.
  const tall=bs=>identify([...bs,...Array.from({length:5},(_,i)=>brick(bs[0].x,i+5,0))]);
  const a=tall(full),b=tall(smaller),model={...brickModel,bricks:[...a,...b]},replay=[descriptor(b,'small'),descriptor(a,'full')];
  const yes=proposeSharedRecipes(model,replay,options);
  assert.equal(yes.changes.length,1);
  assert.equal(yes.replay[0].recipe.representativeId,'full','recipe selection is independent of instance order');
  assert.equal(proposeSharedRecipes(model,replay,{...options,adjustments:false}).changes.length,0);
  assert.equal(proposeSharedRecipes(model,replay,{...options,repairCells:[]}).changes.length,0);
  assert.equal(proposeSharedRecipes(model,replay,{...options,rawModel:{cells:[{x:11,y:0,z:0,color:'red'}]}}).changes.length,0);
  assert.equal(proposeSharedRecipes(brickModel,modules,options).changes.length,0,'small shapes do not get disproportionate repairs');
});

test('course planning keeps a complete mixed-color edge together before filling later rows',()=>{
  const front=[brick(1,0,0,2,1,'white'),brick(9,0,0,2,1,'white'),brick(4,0,0,1,3),
    brick(0,0,1,4,2),brick(5,0,1,3,2),brick(8,0,1,4,2)];
  const surface=[...front,...[3,7].flatMap(z=>Array.from({length:6},(_,x)=>brick(x*2,0,z,2,4)))];
  for(const turn of [0,1]) {
    const source=identify(surface.map(b=>turn?{...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w}:b));
    const actions=planAssemblyActions(source),white=source.filter(b=>b.color==='white');
    const edge=actions.find(a=>a.brickIds.includes(white[0].id));
    assert.ok(edge.brickIds.includes(white[1].id),'paired edge details are completed together');
    assert.equal(edge.brickIds.length,front.length);
    assert.deepEqual(actions.map(a=>a.brickIds.length).sort((a,b)=>a-b),[6,6,6]);
  }
});
