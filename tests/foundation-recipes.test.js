import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {recipeReplay} from '../src/capture-recipes.js';
import {replayNestedRecipes} from '../src/replay-nested-recipes.js';

function fixture(turn=0){
 const bricks=[{x:0,y:1,z:0,w:2,d:2,color:'blue'}, {x:2,y:1,z:0,w:2,d:2,color:'blue'},
  {x:0,y:2,z:0,w:4,d:2,color:'blue'}, {x:0,y:0,z:0,w:1,d:2,color:'black'}, {x:3,y:0,z:0,w:1,d:2,color:'black'}]
  .map(b=>({...rotateRecipeBrick(b,turn),color:turn%2&&b.color==='blue'?'red':b.color}));
 const ids=bricks.map(recipeBrickId),core=ids.slice(0,3),lower=ids.slice(3);
 return{brickModel:{version:1,kind:'bricks',bricks},moduleReplay:[{id:'foundation',label:'Foundation',kind:'grounded',brickIds:ids,brickOrder:ids}],
  moduleRecipes:{foundation:{kind:'foundation',moduleReplay:[{id:'platform',label:'Platform',kind:'grounded',groupType:'table-root',brickIds:core,brickOrder:core,buildContext:{kind:'work-surface',floorY:1}},
   {id:'underside',label:'Underside',kind:'grounded',groupType:'continuation',brickIds:lower,brickOrder:lower}]}},
  allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true};
}
for(let turn=0;turn<4;turn++)test(`a connected foundation precedes its underside, rotation ${turn}`,()=>{
 const options=fixture(turn),snapshot=structuredClone(options),p=createAssemblyPlan(options);
 assert.deepEqual(options,snapshot);assert.equal(p.stats.unresolvedBrickCount,0);assert.equal(p.stats.coverageComplete,true);
 assert.equal(p.steps.filter(s=>s.kind==='join').length,0);
 const firstUp=p.steps.findIndex(s=>s.insertionDirection==='up');
 assert.equal(p.steps.slice(0,firstUp).flatMap(s=>s.newBrickIds).length,3);
 assert.equal(p.steps.slice(firstUp).flatMap(s=>s.newBrickIds).length,2);
 assert.ok(p.steps.slice(firstUp).every(s=>s.insertionDirection==='up'&&!s.issues.length));
 const replay=createAssemblyPlan({...options,moduleReplay:recipeReplay(p,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(p)});
 const physical=steps=>steps.map(({placementGroupId,...s})=>s);
 assert.deepEqual(physical(replay.steps),physical(p.steps));
});

test('a foundation cannot be lifted while its platform is still loose',()=>{
 const o=fixture();o.brickModel.bricks.splice(2,1);
 const missing=o.moduleReplay[0].brickIds[2];
 for(const m of [o.moduleReplay[0],o.moduleRecipes.foundation.moduleReplay[0]]){
  m.brickIds=m.brickIds.filter(id=>id!==missing);m.brickOrder=m.brickOrder.filter(id=>id!==missing);
 }
 assert.throws(()=>createAssemblyPlan(o),/connected|loose/);
});

test('a grounded recipe requires clear ground columns and a grounded root',()=>{
 const o=fixture(),extra={x:1,y:0,z:0,w:1,d:2,color:'green'},id=recipeBrickId(extra);
 o.brickModel.bricks.push(extra);o.moduleReplay.unshift({id:'earlier',label:'Earlier',kind:'grounded',brickIds:[id],brickOrder:[id]});
 assert.throws(()=>createAssemblyPlan(o),/clear ground columns/);
 const bad=fixture();bad.moduleReplay[0].kind='detail';
 assert.throws(()=>createAssemblyPlan(bad),/bounded work-surface/);
});


test('independent foundations can be completed in separate clear ground columns',()=>{
 const a=fixture(),b=fixture(),move=b=>({...b,x:b.x+10});
 const bricks=b.brickModel.bricks.map(move),map=new Map(b.brickModel.bricks.map((part,i)=>[recipeBrickId(part),recipeBrickId(bricks[i])])),ids=b.moduleReplay[0].brickIds.map(id=>map.get(id));
 a.brickModel.bricks.push(...bricks);a.moduleReplay.push({...b.moduleReplay[0],id:'second',brickIds:ids,brickOrder:ids});
 a.moduleRecipes.second=structuredClone(b.moduleRecipes.foundation);
 for(const m of a.moduleRecipes.second.moduleReplay){m.brickIds=m.brickIds.map(id=>map.get(id));m.brickOrder=m.brickOrder.map(id=>map.get(id));}
 const p=createAssemblyPlan(a);assert.equal(p.stats.unresolvedBrickCount,0);assert.equal(p.modules.length,2);assert.equal(p.steps.filter(s=>s.kind==='join').length,0);
 assert.ok(p.steps.find(s=>s.moduleId==='second').visibleBrickIds.every(id=>ids.includes(id)));
});
