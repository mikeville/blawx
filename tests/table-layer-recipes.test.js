import test from 'node:test';
import assert from 'node:assert/strict';
import {planTableLayers} from '../src/table-layer-recipes.js';
import {refineOfflineRecipes} from '../src/offline-recipes.js';
import {createAssemblyPlan} from '../src/assembly.js';
import {prepareAssemblyGuide} from '../src/prepare-assembly-guide.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {createGuideSections} from '../src/guide-sections.js';
import {assessWorkSurfaceQuality} from '../src/work-surface-quality.js';

function slab(turn=0){
  const bricks=[];
  for(let z=0;z<16;z+=4)for(let x=0;x<16;x+=2)bricks.push({x,y:1,z,w:2,d:4,color:'blue'});
  for(const [z,d]of [[0,1],...[1,3,5,7,9,11,13].map(z=>[z,2]),[15,1]]){
    const row=z===0||z%4===1?[[0,4],[4,4],[8,4],[12,4]]:[[0,2],[2,4],[6,4],[10,4],[14,2]];
    for(const [x,w]of row)bricks.push({x,y:2,z,w,d,color:'blue'});
  }
  return bricks.map((b,i)=>{
    for(let r=0;r<turn;r++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
    return {...b,x:b.x+20,z:b.z+20,color:turn?'green':'blue',id:`piece-${i}`};
  });
}

test('large table recipes complete courses with bounded consecutive strips across rotations',()=>{
  for(let turn=0;turn<4;turn++){
    const bricks=slab(turn),snapshot=structuredClone(bricks),plan=planTableLayers(bricks);
    assert.ok(plan);assert.ok(plan.actions.length<12);
    assert.deepEqual(plan.actions.flatMap(a=>a.brickIds).sort(),bricks.map(b=>b.id).sort());
    assert.ok(plan.actions.every(a=>a.brickIds.length<=20));
    const byId=new Map(bricks.map(b=>[b.id,b]));
    const courses=plan.actions.map(a=>new Set(a.brickIds.map(id=>byId.get(id).y)));
    assert.ok(courses.every(c=>c.size===1));
    assert.deepEqual(courses.map(c=>[...c][0]),courses.map(c=>[...c][0]).sort((a,b)=>a-b));
    assert.deepEqual(bricks,snapshot);
  }
});

test('a layer recipe preserves the real attachment and unrelated operations while exposing its handling tradeoff',()=>{
  const geometry=slab().map(({id,...b})=>b);
  const brickModel={version:1,kind:'bricks',bricks:[{x:20,y:0,z:20,w:2,d:4,color:'tan'},...geometry]};
  const identified=createAssemblyPlan({brickModel});
  const selected=identified.bricks.filter(b=>b.y>0).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds:selected,workSurfaceOrder:'connected-patches'});
  const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),snapshot=structuredClone(before);
  const after=refineOfflineRecipes(before),module=assemblyPlan.modules.find(m=>m.buildContext);
  assert.equal(after.offlineRecipeRefinement?.selected,true);
  assert.ok(after.offlineRecipeRefinement.tableLayout);
  const outside=s=>s.moduleId!==module.id||!s.newBrickIds.length;
  assert.deepEqual(after.assemblyPlan.steps.filter(outside),before.assemblyPlan.steps.filter(outside));
  assert.deepEqual(after.instructionPlan.steps.filter(outside),before.instructionPlan.steps.filter(outside));
  assert.equal(after.brickModel,before.brickModel);
  assert.deepEqual(after.assemblyPlan.modules,before.assemblyPlan.modules);
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.ok(after.offlineRecipeRefinement.handlingAfter.peakLooseBrickCount>after.offlineRecipeRefinement.handlingBefore.peakLooseBrickCount);
  assert.equal(after.offlineRecipeRefinement.handlingAfter.finalComponentCount,1);
  const numbering={byStepId:new Map(after.instructionPlan.steps.map((s,i)=>[s.id,i+1]))};
  const recipe=after.instructionPlan.steps.filter(s=>s.tableRecipe);
  const first=createStepGuidance(after.instructionPlan,recipe[0],numbering);
  assert.match(first.instruction,/Continue the base layer/);
  assert.doesNotMatch(first.instruction,/Lay out the complete base/);
  assert.ok(first.map);
  assert.match(createStepGuidance(after.instructionPlan,recipe.at(-1),numbering).instruction,/Complete the top layer/);
  assert.deepEqual(before,snapshot);
  assert.equal(refineOfflineRecipes(after),after);
});

test('scattered feet, hollow frames, unsupported upper pieces and excessive color variety do not become table layouts',()=>{
  const source=slab();
  assert.equal(planTableLayers(source.filter(b=>b.y!==1||b.x===20||b.x===34)),null);
  assert.equal(planTableLayers(source.map(b=>({...b,x:b.y===2?b.x+50:b.x}))),null);
  assert.equal(planTableLayers(source.map((b,i)=>({...b,color:['red','blue','green','yellow','black'][i%5]}))),null);
});

function mixedSlab(turn,connected=false){
  const palette=turn%2?['green','yellow','white','black']:['blue','orange','tan','red'];
  const geometry=slab(turn).map(({id,...b},i)=>({...b,color:palette[i%palette.length]}));
  const first=geometry[0],brickModel={version:1,kind:'bricks',bricks:[{...first,y:0,color:'lightGray'},...geometry]};
  const identified=createAssemblyPlan({brickModel}),ids=identified.bricks.filter(b=>b.y>0).map(b=>b.id);
  const assemblyPlan=connected?createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds:ids,workSurfaceOrder:'connected-patches'}):
    createAssemblyPlan({brickModel,moduleReplay:[
      {id:'base',kind:'grounded',label:'Base',brickIds:identified.bricks.filter(b=>b.y===0).map(b=>b.id),brickOrder:identified.bricks.filter(b=>b.y===0).map(b=>b.id)},
      {id:'slab',kind:'detail',label:'Slab',groupType:'work-surface',brickIds:ids,brickOrder:ids,
        placementGroups:ids.map(id=>[id]),actionOrder:true,buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}},
    ]});
  const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,id:`diagram-${s.id}`,sourceStepIds:[s.id],
    orderedOperations:[{id:s.id,kind:s.kind,newBrickIds:s.newBrickIds,highlightBrickIds:s.highlightBrickIds,issues:s.issues,insertionDirection:s.insertionDirection??'down'}]}))};
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan)};
}

test('material-rich table courses consolidate without increasing loose-layout burden across rotations',()=>{
  for(let turn=0;turn<4;turn++){
    const before=mixedSlab(turn),snapshot=structuredClone(before),after=refineOfflineRecipes(before);
    assert.equal(after.offlineRecipeRefinement?.tableLayout?.mixedMaterials,true);
    const module=before.assemblyPlan.modules.find(m=>m.buildContext),outside=s=>s.moduleId!==module.id||!s.newBrickIds.length;
    assert.deepEqual(after.assemblyPlan.steps.filter(outside),before.assemblyPlan.steps.filter(outside));
    assert.deepEqual(after.instructionPlan.steps.filter(outside),before.instructionPlan.steps.filter(outside));
    assert.equal(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    const previous=assessWorkSurfaceQuality(before.assemblyPlan).modules[0],next=assessWorkSurfaceQuality(after.assemblyPlan).modules[0];
    assert.equal(next.peakLooseBrickCount,previous.peakLooseBrickCount);
    assert.equal(next.peakComponentCount,previous.peakComponentCount);
    assert.equal(next.firstBondAtAddition,previous.firstBondAtAddition);
    assert.equal(next.finalComponentCount,1);
    const by=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
    const courses=after.instructionPlan.steps.filter(s=>s.tableRecipe).map(s=>{
      const bs=s.newBrickIds.map(id=>by.get(id)),ys=new Set(bs.map(b=>b.y));
      assert.equal(ys.size,1);assert.ok(bs.length<=20);
      assert.ok(new Set(bs.map(b=>`${b.w}x${b.d}:${b.color}`)).size<=8);
      return [...ys][0];
    });
    assert.deepEqual(courses,[...courses].sort((a,b)=>a-b));
    const numbering={byStepId:new Map(after.instructionPlan.steps.map((s,i)=>[s.id,i+1]))};
    const middle=after.instructionPlan.steps.filter(s=>{
      const d=s.instructionAction?.destination;
      return d?.kind==='layer'&&d.course>d.firstCourse&&d.ordinal>1&&d.ordinal<d.total;
    });
    assert.ok(middle.length);
    for(const s of middle)assert.match(createStepGuidance(after.instructionPlan,s,numbering).instruction,/Continue this layer/);
    assert.deepEqual(before,snapshot);
  }
});

test('material-rich layers cannot replace an earlier connected recipe with a larger loose floor',()=>{
  const before=mixedSlab(0,true),module=before.assemblyPlan.modules.find(m=>m.buildContext);
  const bricks=before.assemblyPlan.bricks.filter(b=>module.brickIds.includes(b.id));
  assert.equal(planTableLayers(bricks),null);
  assert.ok(planTableLayers(bricks,{allowMixedMaterials:true}));
  assert.ok(assessWorkSurfaceQuality(before.assemblyPlan).modules[0].firstBondAtAddition<bricks.filter(b=>b.y===1).length);
  assert.equal(refineOfflineRecipes(before),before);
});

test('a rejected early-bonding strategy still considers complete courses on a compact table layout',()=>{
  for(let turn=0;turn<4;turn++){
    const parts=[];
    for(let z=0;z<8;z+=4)for(let x=0;x<8;x+=2)parts.push({x,y:1,z,w:2,d:4,color:'blue'});
    for(const [z,d]of [[0,1],[1,2],[3,2],[5,2],[7,1]]){
      const row=z===3?[[0,2],[2,4],[6,2]]:[[0,4],[4,4]];
      for(const[x,w]of row)parts.push({x,y:2,z,w,d,color:'blue'});
    }
    const geometry=[{x:0,y:0,z:0,w:2,d:4,color:'tan'},...parts].map(b=>{
      for(let i=0;i<turn;i++)b={...b,x:-b.z-b.d,z:b.x,w:b.d,d:b.w};
      return {...b,color:turn&&b.color==='blue'?'green':b.color};
    });
    const brickModel={version:1,kind:'bricks',bricks:geometry};
    const identified=createAssemblyPlan({brickModel}),ids=identified.bricks.filter(b=>b.y>0).map(b=>b.id);
    const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds:ids,workSurfaceOrder:'connected-patches'});
    const before=prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}}),snapshot=structuredClone(before);
    const after=refineOfflineRecipes(before),module=assemblyPlan.modules.find(m=>m.buildContext);
    assert.ok(after.offlineRecipeRefinement?.tableLayout);
    assert.equal(after.offlineRecipeRefinement.afterDiagrams,2);
    const beforeHandling=after.offlineRecipeRefinement.handlingBefore,afterHandling=after.offlineRecipeRefinement.handlingAfter;
    assert.ok(beforeHandling.firstBondAtAddition<afterHandling.firstBondAtAddition);
    assert.equal(afterHandling.peakLooseBrickCount,8);
    assert.equal(afterHandling.finalComponentCount,1);
    const layers=after.instructionPlan.steps.filter(s=>s.tableRecipe),by=new Map(after.assemblyPlan.bricks.map(b=>[b.id,b]));
    assert.deepEqual(layers.map(s=>[...new Set(s.newBrickIds.map(id=>by.get(id).y))]),[[1],[2]]);
    const outside=s=>s.moduleId!==module.id||!s.newBrickIds.length;
    assert.deepEqual(after.assemblyPlan.steps.filter(outside),before.assemblyPlan.steps.filter(outside));
    assert.deepEqual(after.instructionPlan.steps.filter(outside),before.instructionPlan.steps.filter(outside));
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),ids.concat(identified.bricks.filter(b=>b.y===0).map(b=>b.id)).sort());
    assert.deepEqual(before,snapshot);
    assert.equal(refineOfflineRecipes(after),after);
  }
});
