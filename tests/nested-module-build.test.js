import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {createAssemblyJoinPreview} from '../src/assembly-join-preview.js';

function fixture(blocked=false){
 const bricks=[{x:0,y:0,z:0,w:4,d:2,color:'black'},
  {x:0,y:1,z:0,w:4,d:2,color:'green'},{x:2,y:2,z:0,w:2,d:2,color:'green'},
  {x:4,y:2,z:0,w:1,d:2,color:'yellow'},{x:2,y:3,z:0,w:3,d:2,color:'yellow'}];
 if(blocked){for(let y=0;y<4;y++)bricks.push({x:-1,y,z:0,w:1,d:2,color:'red'});bricks.push({x:-1,y:4,z:0,w:4,d:2,color:'red'});}
 const brickModel={version:1,kind:'bricks',bricks},identified=createAssemblyPlan({brickModel}).bricks;
 const parent=identified.filter(b=>['green','yellow'].includes(b.color)),localModel={version:1,kind:'bricks',bricks:parent.map(({id,...b})=>({...b,y:b.y-1}))};
 const local=createAssemblyPlan({brickModel:localModel}).bricks;
 const base=local.filter(b=>b.color==='green').map(b=>b.id),child=local.filter(b=>b.color==='yellow').map(b=>b.id);
 const moduleReplay=[{id:'main',kind:'grounded',brickIds:identified.filter(b=>b.color==='black').map(b=>b.id)},
  ...(blocked?[{id:'obstacle',kind:'grounded',brickIds:identified.filter(b=>b.color==='red').map(b=>b.id)}]:[]),
  {id:'parent',kind:'detail',groupType:'work-surface',brickIds:parent.map(b=>b.id),buildContext:{kind:'work-surface',floorY:1}}];
 const childReplay=[{id:'local-base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'local-child',kind:'detail',groupType:'work-surface',brickIds:child,brickOrder:child,buildContext:{kind:'work-surface',floorY:1}}];
 for(const m of [...moduleReplay,...childReplay]){m.label=m.id;m.brickOrder??=[...m.brickIds];}
 return {brickModel,moduleReplay,moduleRecipes:{parent:{moduleReplay:childReplay}},allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true};
}

test('a child attaches to its offline parent before the parent joins the actual model',()=>{
 const options=fixture(),snapshot=structuredClone(options),p=createAssemblyPlan(options);
 assert.equal(p.stats.unresolvedBrickCount,0);assert.equal(p.stats.coverageComplete,true);
 assert.deepEqual(options,snapshot);
 const joins=p.steps.filter(s=>s.kind==='join');assert.equal(joins.length,2);
 assert.equal(p.stats.validJoinCount,joins.length);
 const prepared=prepareAssemblyGuide({brickModel:options.brickModel,assemblyPlan:p,metrics:{conversionMs:0,stageTiming:{}}});
 assert.equal(prepared.assemblyPlan,p,'guide preparation preserves the validated nested recipe');
 assert.ok(joins[0].nestedRecipe?.separate);assert.equal(joins[1].nestedRecipe,undefined);
 const byId=new Map(p.bricks.map(b=>[b.id,b]));
 const previewArgs={model:{kind:'bricks',bricks:joins[0].visibleBrickIds.map(id=>byId.get(id))},highlightIds:new Set(joins[0].highlightBrickIds),joinContext:joins[0].joinContext};
 assert.equal(createAssemblyJoinPreview(previewArgs).active,true,'child attachment has an exploded preview above its actual parent surface');
 assert.equal(createAssemblyJoinPreview({...previewArgs,joinContext:{...joins[0].joinContext,supportFloorY:0}}).active,false,'a false ground anchor is rejected');
 assert.ok(joins[0].joinContext.supportGroups.flatMap(g=>g.brickIds).every(id=>byId.get(id).y>0),'child uses the supported offline parent');
 assert.ok(joins[1].joinContext.supportGroups.flatMap(g=>g.brickIds).some(id=>byId.get(id).y===0),'outer attachment checks the real receiver');
 for(const s of p.steps.filter(s=>s.nestedRecipe))assert.ok(s.visibleBrickIds.every(id=>byId.get(id).y>0),'main model stays outside the local recipe view');
 const compacted=compactAssemblyPlan(p);
 assert.deepEqual(compacted.plan.steps.flatMap(s=>s.sourceStepIds),p.steps.map(s=>s.id));
 assert.equal(compacted.plan.steps.filter(s=>s.kind==='join').length,2,'child and parent joins remain separate');
 for(const step of compacted.plan.steps){const sources=p.steps.filter(s=>step.sourceStepIds.includes(s.id));assert.equal(new Set(sources.map(s=>s.nestedRecipe?.id)).size,1,'compaction cannot mix local contexts');}
 const parentStart=compacted.plan.steps.find(s=>s.moduleId==='parent'&&s.kind==='build');
 const finalJoin=compacted.plan.steps.at(-1),childJoin=compacted.plan.steps.find(s=>s.nestedRecipe&&s.kind==='join');
 const numbering={byStepId:new Map([[finalJoin.id,20],[childJoin.id,10]])};
 assert.match(createStepGuidance(compacted.plan,parentStart,numbering).instruction,/Attach it in step 20/);
 const childStart=compacted.plan.steps.find(s=>s.nestedRecipe?.separate&&s.kind==='build');
 assert.match(createStepGuidance(compacted.plan,childStart,numbering).instruction,/section you are building in step 10/);
 assert.match(createStepGuidance(compacted.plan,childJoin,numbering).instruction,/section you are building/);
});

test('a valid internal recipe cannot bypass a blocked final attachment',()=>{
 const p=createAssemblyPlan(fixture(true));
 const outer=p.steps.find(s=>s.moduleId==='parent'&&!s.nestedRecipe);
 assert.equal(outer.kind,'unresolved');assert.ok(outer.issues.some(i=>i.code==='blocked-module-insertion'));
 assert.ok(p.steps.filter(s=>s.nestedRecipe).every(s=>s.kind!=='unresolved'));
});

test('nested recipes reject missing coverage, wrong scope and unresolved child operations',()=>{
 const bad=fixture();bad.moduleRecipes.parent.moduleReplay[1].brickIds.pop();
 assert.throws(()=>createAssemblyPlan(bad),/coverage|cover|missing|every|exactly/i);
 const unknown=fixture();unknown.moduleRecipes.unknown=unknown.moduleRecipes.parent;
 assert.throws(()=>createAssemblyPlan(unknown),/existing parent/);
 const wrong=fixture();wrong.moduleRecipes.main=wrong.moduleRecipes.parent;
 assert.throws(()=>createAssemblyPlan(wrong),/work-surface parent/);
 const empty=fixture();empty.moduleRecipes.parent=null;
 assert.throws(()=>createAssemblyPlan(empty),/work-surface parent/);
 const failed=fixture();const parts=failed.moduleRecipes.parent.moduleReplay.flatMap(m=>m.brickIds);
 failed.moduleRecipes.parent.moduleReplay=[{id:'unresolved',label:'Unresolved',kind:'grounded',brickIds:parts,brickOrder:[...parts]}];failed.allowUnderAttachments=false;
 assert.throws(()=>createAssemblyPlan(failed),/unresolved internal/);
});

test('a recipe placement policy survives reconstruction and cannot loosen its enclosing policy',()=>{
 for(let turn=0;turn<4;turn++){
  const options=transformFixture(fixture(),turn),recipe=options.moduleRecipes.parent;
  const parts=recipe.moduleReplay.flatMap(m=>m.brickIds);
  recipe.moduleReplay=[{id:'root',label:'Root',kind:'grounded',brickIds:parts,brickOrder:parts}];
  const old=createAssemblyPlan(options);
  assert.equal(old.stats.unresolvedBrickCount,0);
  assert.ok(old.steps.some(s=>s.kind==='build'&&s.insertionDirection==='up'));
  recipe.allowUnderAttachments=false;
  assert.throws(()=>createAssemblyPlan(options),/unresolved internal/);
  recipe.allowUnderAttachments=true;options.allowUnderAttachments=false;
  assert.throws(()=>createAssemblyPlan(options),/unresolved internal/);
  recipe.allowUnderAttachments='yes';
  assert.throws(()=>createAssemblyPlan(options),/must be a boolean/);
 }
});

test('nested underside operations cannot lift a still-disconnected table layout',()=>{
 const localBricks=[
  {x:0,y:0,z:0,w:4,d:2,color:'green'}, {x:10,y:0,z:0,w:2,d:2,color:'green'},
  {x:2,y:1,z:0,w:2,d:2,color:'green'}, {x:2,y:2,z:0,w:3,d:2,color:'yellow'},
  {x:4,y:1,z:0,w:1,d:2,color:'yellow'}, {x:10,y:1,z:0,w:2,d:2,color:'green'},
  {x:10,y:2,z:0,w:2,d:2,color:'green'}, {x:4,y:3,z:0,w:4,d:2,color:'green'},
  {x:8,y:3,z:0,w:4,d:2,color:'green'}, {x:6,y:4,z:0,w:4,d:2,color:'green'},
 ];
 const identify=bricks=>createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks}}).bricks;
 const local=identify(localBricks),key=b=>`${b.x},${b.y},${b.z}:${b.w},${b.d}:${b.color}`;
 const byKey=new Map(local.map(b=>[key(b),b.id]));const ids=localBricks.map(b=>byKey.get(key(b)));
 const brickModel={version:1,kind:'bricks',bricks:[{x:0,y:0,z:0,w:4,d:2,color:'black'},...localBricks.map(b=>({...b,y:b.y+1}))]};
 const global=identify(brickModel.bricks),base=global.filter(b=>b.y===0).map(b=>b.id),parent=global.filter(b=>b.y>0).map(b=>b.id);
 const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'parent',label:'Parent',kind:'detail',groupType:'work-surface',brickIds:parent,brickOrder:parent,buildContext:{kind:'work-surface',floorY:1}}];
 assert.throws(()=>createAssemblyPlan({brickModel,moduleReplay,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,
  moduleRecipes:{parent:{moduleReplay:[{id:'root',label:'Root',kind:'grounded',brickIds:ids,brickOrder:ids}]}}}),/loose nested layout/);
});

function wrappedFixture(){
 const inner=fixture(),brickModel={version:1,kind:'bricks',bricks:[{x:0,y:0,z:0,w:4,d:2,color:'blue'},...inner.brickModel.bricks.map(b=>({...b,y:b.y+1}))]};
 const bricks=createAssemblyPlan({brickModel}).bricks,base=bricks.filter(b=>b.y===0).map(b=>b.id),body=bricks.filter(b=>b.y>0).map(b=>b.id);
 return {brickModel,allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false,moduleReplay:[
  {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'whole',label:'Whole assembly',kind:'detail',groupType:'work-surface',brickIds:body,brickOrder:body,buildContext:{kind:'work-surface',floorY:1}}],
  moduleRecipes:{whole:{moduleReplay:inner.moduleReplay,moduleRecipes:inner.moduleRecipes}}};
}

function transformFixture(value,turn){
 const colors=[{},{blue:'tan',black:'darkGray',green:'blue',yellow:'red'},{blue:'white',black:'brown',green:'yellow',yellow:'green'},{blue:'brown',black:'lightGray',green:'orange',yellow:'blue'}][turn];
 const transform=b=>{let next={...b,color:colors[b.color]??b.color};for(let i=0;i<turn;i++)next={...next,x:-next.z-next.d,z:next.x,w:next.d,d:next.w};return next;};
 const visit=v=>{
  if(typeof v==='string'&&v.startsWith('b@')){const [,x,y,z,w,d,color]=/^b@(-?\d+),(\d+),(-?\d+):(\d+)x(\d+):(.+)$/.exec(v),b=transform({x:+x,y:+y,z:+z,w:+w,d:+d,color});return `b@${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;}
  if(Array.isArray(v))return v.map(visit);
  if(v&&typeof v==='object')return Number.isInteger(v.x)&&Number.isInteger(v.w)?transform(v):Object.fromEntries(Object.entries(v).map(([k,v])=>[k,visit(v)]));
  return v;
 };
 return visit(value);
}

test('a recipe inside another recipe retains its operations, attachment scopes and table heights',async()=>{
 const {replayNestedRecipes}=await import('../src/replay-nested-recipes.js');
 const {recipeReplay}=await import('../src/capture-recipes.js');
 const {refreshNestedRecipeReferences}=await import('../src/nested-recipe-references.js');
 for(let turn=0;turn<4;turn++){
  const options=transformFixture(wrappedFixture(),turn),snapshot=structuredClone(options),plan=createAssemblyPlan(options);
  assert.deepEqual(options,snapshot);assert.equal(plan.stats.unresolvedBrickCount,0);
  const joins=plan.steps.filter(s=>s.kind==='join');assert.equal(joins.length,3);assert.equal(plan.stats.validJoinCount,3);
  assert.deepEqual(joins.map(s=>s.nestedRecipe?.id),['whole/parent/local-child','whole/parent',undefined]);
  assert.deepEqual(joins.map(s=>s.joinContext.supportFloorY??0),[2,1,0]);
  const paths=plan.steps.filter(s=>s.nestedRecipePath);assert.ok(paths.length);
  assert.ok(paths.every(s=>s.nestedRecipePath[0].id==='whole/parent'));
  for(const s of paths)for(const scope of s.nestedRecipePath){assert.ok(plan.steps.some(t=>t.id===scope.firstStepId));if(scope.attachmentStepId)assert.ok(plan.steps.some(t=>t.id===scope.attachmentStepId&&t.kind==='join'));}
  const compacted=compactAssemblyPlan(plan),fresh=refreshNestedRecipeReferences(plan,compacted.plan);
  const numbering={byStepId:new Map(fresh.instructionPlan.steps.flatMap((s,i)=>[s.id,...s.sourceStepIds].map(id=>[id,i+1])))};
  const start=fresh.instructionPlan.steps.find(s=>s.nestedRecipePath?.[0].id==='whole/parent');
  const parentJoin=fresh.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='whole/parent'&&s.kind==='join');
  assert.match(createStepGuidance(fresh.instructionPlan,start,numbering).instruction,new RegExp(`section you are building in step ${numbering.byStepId.get(parentJoin.id)}`));
  assert.deepEqual(compacted.plan.steps.flatMap(s=>s.sourceStepIds),plan.steps.map(s=>s.id));
  const replayed=createAssemblyPlan({...options,moduleReplay:recipeReplay(plan,{preservePlacements:true}),moduleRecipes:replayNestedRecipes(plan)});
  assert.equal(replayed.stats.unresolvedBrickCount,0);assert.deepEqual(replayed.steps.map(s=>[s.kind,s.newBrickIds,s.insertionDirection,s.nestedRecipe?.id]),plan.steps.map(s=>[s.kind,s.newBrickIds,s.insertionDirection,s.nestedRecipe?.id]));
  const lost=structuredClone(options);delete lost.moduleRecipes.whole.moduleRecipes;
  assert.throws(()=>createAssemblyPlan(lost),/unresolved internal/,'dropping the stored child construction must not pass');
 }
});

test('deep recipes reject missing internal coverage and remain bounded',()=>{
 const missing=wrappedFixture();missing.moduleRecipes.whole.moduleRecipes.parent.moduleReplay[1].brickIds.pop();
 assert.throws(()=>createAssemblyPlan(missing),/cover|every|missing|exactly/i);
 for(const nestedRecipeDepth of [-1,0.5,4])assert.throws(()=>createAssemblyPlan({...fixture(),nestedRecipeDepth}),/depth/);
 const tooDeep=wrappedFixture();tooDeep.nestedRecipeDepth=2;
 assert.throws(()=>createAssemblyPlan(tooDeep),/three-level/);
});
