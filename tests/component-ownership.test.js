import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {compactAssemblyPlan} from '../src/assembly-diagrams.js';
import {createGuideSections} from '../src/guide-sections.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';
import {discoverComponentExpansions} from '../src/component-ownership.js';
import {completeComponentOwnership} from '../src/complete-component-ownership.js';

function fixture(turn=0){
  const move=bs=>bs.map(b=>({...rotateRecipeBrick(b,turn),color:turn%2?'tan':b.color}));
  const lower=move([...Array.from({length:3},(_,y)=>({x:0,y,z:0,w:2,d:2,color:'black'})),{x:2,y:2,z:0,w:2,d:2,color:'red'}]);
  const core=move([{x:0,y:3,z:0,w:4,d:2,color:'green'}]);
  const upper=move([{x:2,y:4,z:0,w:2,d:2,color:'blue'},{x:4,y:4,z:0,w:2,d:2,color:'blue'},{x:2,y:5,z:0,w:4,d:2,color:'blue'}]);
  const module=(id,parts,extra)=>({id,label:id,brickIds:parts.map(recipeBrickId),brickOrder:parts.map(recipeBrickId),...extra});
  const brickModel={version:1,kind:'bricks',bricks:[...lower,...core,...upper]};
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:[module('foundation',lower,{kind:'grounded'}),
    module('core',core,{kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:3}}),
    module('upper',upper,{kind:'grounded',groupType:'continuation'})],allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false});
  const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  return {brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('dependency ownership crosses an old boundary and captures its hanging support',()=>{
  for(let turn=0;turn<4;turn++){
    const before=fixture(turn),copy=structuredClone(before),proposals=discoverComponentExpansions(before.assemblyPlan);
    assert.equal(proposals.length,1);assert.equal(proposals[0].brickIds.length,5);assert.equal(proposals[0].captured.flat().length,1);
    assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);
    const after=completeComponentOwnership(before);
    assert.ok(after.componentOwnershipCompletion?.selected);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
    assert.deepEqual(before,copy);assert.deepEqual(after.brickModel,before.brickModel);
    assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
    assert.equal(completeComponentOwnership(after),after);
  }
});

test('protected assemblies, recipe boundaries and bounded search cannot be consumed',()=>{
  for(const index of [1,2]){const r=fixture();r.assemblyPlan.modules[index].recipeFamily='fixed';assert.deepEqual(discoverComponentExpansions(r.assemblyPlan),[]);assert.equal(completeComponentOwnership(r),r);}
  const r=fixture();assert.deepEqual(discoverComponentExpansions(r.assemblyPlan,{maxPieces:3}),[]);assert.deepEqual(discoverComponentExpansions(r.assemblyPlan,{maxCandidates:0}),[]);
  r.semanticGuide={};assert.equal(completeComponentOwnership(r),r);
  assert.deepEqual(discoverComponentExpansions(null),[]);
});

test('a continuation with another earlier receiving interface stays outside the proposed component',()=>{
  const r=fixture(),p=r.assemblyPlan,parent=p.modules[1],upper=p.modules[2];
  p.graph.edges.push({a:upper.brickIds[0],b:p.modules[0].brickIds[0]});
  assert.deepEqual(discoverComponentExpansions(p),[]);
  assert(parent.buildContext);
});

test('an overhead obstruction rejects the larger attachment without replacing the old guide',()=>{
  const base=fixture(),obstacle=[...Array.from({length:8},(_,y)=>({x:6,y,z:0,w:2,d:2,color:'white'})),{x:4,y:8,z:0,w:4,d:2,color:'white'}];
  const brickModel={...base.brickModel,bricks:[...base.brickModel.bricks,...obstacle]};
  const original=base.assemblyPlan.modules.map(m=>({id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,brickIds:m.brickIds,brickOrder:m.brickIds,...(m.buildContext?{buildContext:m.buildContext}:{})}));
  original.splice(1,0,{id:'overhead',label:'Overhead',kind:'grounded',brickIds:obstacle.map(recipeBrickId),brickOrder:obstacle.map(recipeBrickId)});
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:original,allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false});
  const instructionPlan=compactAssemblyPlan(assemblyPlan).plan;
  const before={brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
  assert.equal(discoverComponentExpansions(assemblyPlan).length,1);
  assert.equal(completeComponentOwnership(before),before);
});
