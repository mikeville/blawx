import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {createAssemblyJoinPreview} from '../src/assembly-join-preview.js';
import {recipeReplay} from '../src/capture-recipes.js';
import {replayNestedRecipes} from '../src/replay-nested-recipes.js';

function fixture(turn=0,blocked=false){
 const move=b=>({...rotateRecipeBrick(b,turn),color:turn%2&&b.color==='green'?'orange':b.color});
 const main=[{x:0,y:0,z:0,w:2,d:2,color:'black'},{x:0,y:1,z:0,w:2,d:2,color:'black'}];
 if(blocked)main.push({x:0,y:2,z:0,w:2,d:2,color:'black'},{x:0,y:3,z:0,w:2,d:2,color:'black'});
 if(!blocked)main.push({x:0,y:2,z:0,w:2,d:2,color:'black'});
 const parent=[{x:0,y:blocked?4:3,z:0,w:4,d:2,color:'green'},{x:2,y:blocked?3:2,z:0,w:2,d:2,color:'blue'},{x:2,y:blocked?2:1,z:0,w:2,d:2,color:'blue'}].map(move),floor=Math.min(...parent.map(b=>b.y));
 // A later overhang blocks downward insertion without intersecting final cells.
 if(blocked)main.push({x:0,y:4,z:2,w:2,d:2,color:'black'},{x:0,y:3,z:2,w:2,d:2,color:'black'},{x:0,y:2,z:2,w:2,d:2,color:'black'},{x:0,y:1,z:2,w:2,d:2,color:'black'},{x:0,y:0,z:2,w:2,d:2,color:'black'},{x:0,y:5,z:0,w:2,d:4,color:'black'});
 const core=[recipeBrickId({...parent[0],y:parent[0].y-floor})],hanging=parent.slice(1).map(b=>recipeBrickId({...b,y:b.y-floor}));
 const base=main.map(move),all=parent.map(recipeBrickId),ids=base.map(recipeBrickId);
 return {brickModel:{version:1,kind:'bricks',bricks:[...base,...parent]},moduleReplay:[{id:'main',label:'Main',kind:'grounded',brickIds:ids,brickOrder:ids},{id:'parent',label:'Complete body',kind:'detail',groupType:'work-surface',brickIds:all,brickOrder:all,buildContext:{kind:'work-surface',floorY:floor}}],moduleRecipes:{parent:{allowUnderAttachments:false,moduleReplay:[{id:'core',label:'Core',kind:'grounded',groupType:'table-root',brickIds:core,brickOrder:core,buildContext:{kind:'work-surface',floorY:2}},{id:'hanging',label:'Hanging component',kind:'detail',groupType:'work-surface',brickIds:hanging,brickOrder:hanging,buildContext:{kind:'work-surface',floorY:0,joinDirection:'up'}}]}},allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false};
}

test('a nested recipe builds its raised core before a complete zero-floor hanging component',()=>{
 for(let turn=0;turn<4;turn++){
  const options=fixture(turn),snapshot=structuredClone(options),p=createAssemblyPlan(options);
  assert.deepEqual(options,snapshot);assert.equal(p.stats.unresolvedBrickCount,0);assert.equal(p.stats.coverageComplete,true);
  const joins=p.steps.filter(s=>s.kind==='join');assert.equal(joins.length,2);assert.equal(joins[0].insertionDirection,'up');assert.equal(joins[0].joinContext.supportFloorY,3);
  assert.equal(joins[1].nestedRecipe,undefined);assert.ok(p.steps.every(s=>s.kind!=='build'||s.insertionDirection!=='up'));
  const by=new Map(p.bricks.map(b=>[b.id,b]));assert.equal(createAssemblyJoinPreview({model:{kind:'bricks',bricks:joins[0].visibleBrickIds.map(id=>by.get(id))},highlightIds:new Set(joins[0].highlightBrickIds),joinContext:joins[0].joinContext}).active,true);
  const replay=createAssemblyPlan({...options,moduleReplay:recipeReplay(p,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(p)});
  assert.deepEqual(replay.steps.map(s=>[s.kind,s.newBrickIds,s.joinContext]),p.steps.map(s=>[s.kind,s.newBrickIds,s.joinContext]));
 }
});

test('a raised table root cannot bypass an obstructed final model attachment',()=>{
 const p=createAssemblyPlan(fixture(0,true)),outer=p.steps.find(s=>s.moduleId==='parent'&&!s.nestedRecipe);
 assert.equal(outer.kind,'unresolved');assert.ok(outer.issues.some(i=>i.code==='blocked-module-insertion'));
 assert.ok(p.steps.filter(s=>s.nestedRecipe).every(s=>!s.issues.some(i=>i.severity==='error')));
});

test('table roots and zero-floor children are confined to a valid nested starting context',()=>{
 const opts=fixture(),inner=opts.moduleRecipes.parent,parts=opts.brickModel.bricks.filter(b=>b.color!=='black').map(b=>({...b,y:b.y-1}));
 assert.throws(()=>createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:parts},moduleReplay:inner.moduleReplay}),/table root/);
 for(const mutate of [r=>r.moduleReplay.reverse(),r=>r.moduleReplay[0].buildContext.floorY=0,r=>r.moduleReplay[1].buildContext.joinDirection='down']){
  const bad=structuredClone(opts);mutate(bad.moduleRecipes.parent);assert.throws(()=>createAssemblyPlan(bad),/table root|build context|ground-course/);
 }
});

test('a hanging component cannot lift two still-loose pieces of its table root',()=>{
 const bs=[{x:0,y:1,z:0,w:1,d:2,color:'green'},{x:3,y:1,z:0,w:1,d:2,color:'green'},{x:0,y:0,z:0,w:4,d:2,color:'blue'}];
 const core=bs.slice(0,2).map(recipeBrickId),child=[recipeBrickId(bs[2])];
 const p=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:bs},nestedRecipeDepth:1,moduleReplay:[{id:'core',label:'Core',kind:'grounded',groupType:'table-root',brickIds:core,brickOrder:core,buildContext:{kind:'work-surface',floorY:1}},{id:'child',label:'Child',kind:'detail',groupType:'work-surface',brickIds:child,brickOrder:child,buildContext:{kind:'work-surface',floorY:0,joinDirection:'up'}}]});
 assert.ok(p.steps.at(-1).issues.some(i=>i.code==='disconnected-receiver'));assert.ok(p.stats.unresolvedBrickCount>0);
});
