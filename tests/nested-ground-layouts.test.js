import test from 'node:test';import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {createGuideSections} from '../src/guide-sections.js';
import {completeNestedGroundLayouts,discoverNestedGroundLayouts,consolidateCompactNestedAreas,samePlacementOutcomes} from '../src/nested-ground-layouts.js';
import {rotateRecipeBrick,recipeBrickId} from '../src/assembly-recipes.js';
import {contactCells} from '../src/local-interface-repair.js';

function fixture(turn=0,{narrow=false,bonded=false}={}) {
 const transform=b=>rotateRecipeBrick({...b,color:turn&&b.color==='orange'?'green':b.color},turn);
 const layers=narrow?3:2;
 const lower=[0,6].flatMap(x=>Array.from({length:layers},(_,y)=>{
  const bridge=narrow&&(x===6||bonded&&y===layers-1);
  return (bridge?[0]:[0,1]).map(dx=>({x:x+dx,y,z:0,w:bridge?2:1,d:2,color:dx?'orange':'black'}));
 })).flat();
 const cap=[...[0,2,4,6].map(x=>({x,y:layers,z:0,w:2,d:2,color:'blue'})),...[0,1,3,5,7].map(x=>({x,y:layers+1,z:0,w:x===0||x===7?1:2,d:2,color:'blue'}))];
 const local=[...lower,...cap].map(transform),localIds=parts=>parts.map(b=>recipeBrickId(transform(b)));
 const groups=Array.from({length:layers},(_,y)=>[0,6].map(x=>localIds(lower.filter(b=>b.y===y&&b.x>=x&&b.x<x+2)))).flat();
 const childReplay=[{id:'layout',label:'Layout',kind:'grounded',brickIds:localIds(lower),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups},
  {id:'cap',label:'Cap',kind:'detail',groupType:'work-surface',brickIds:localIds(cap),brickOrder:localIds(cap),buildContext:{kind:'work-surface',floorY:layers}}];
 const base=[0,4].map(x=>transform({x,y:0,z:0,w:4,d:2,color:'tan'}));
 const parent=local.map(b=>({...b,y:b.y+1})),brickModel={version:1,kind:'bricks',bricks:[...base,...parent]};
 const moduleReplay=[{id:'base',label:'Base',kind:'grounded',brickIds:base.map(recipeBrickId),brickOrder:base.map(recipeBrickId)},
  {id:'parent',label:'Parent',kind:'detail',groupType:'work-surface',brickIds:parent.map(recipeBrickId),brickOrder:parent.map(recipeBrickId),buildContext:{kind:'work-surface',floorY:1}}];
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay,moduleRecipes:{parent:{moduleReplay:childReplay,diagramGroups:groups}},integratedBuild:true,
  allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('nested table areas complete in place without inventing a stud connection or changing tasks',()=>{
 for(let turn=0;turn<4;turn++)for(const narrow of [false,true]){
  const before=fixture(turn,{narrow}),snapshot=structuredClone(before),proposals=discoverNestedGroundLayouts(before);
  assert.equal(proposals.length,1);assert.equal(proposals[0].components.length,2);
  const after=completeNestedGroundLayouts(before);
  assert.ok(after.nestedGroundLayouts?.selected,JSON.stringify(after.nestedGroundLayouts));assert.deepEqual(before,snapshot);
  assert.deepEqual(after.brickModel,before.brickModel);assert.deepEqual(after.assemblyPlan.graph,before.assemblyPlan.graph);
  assert.equal(after.instructionPlan.steps.length,before.instructionPlan.steps.length);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const grouped=after.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout');
  const owners=new Map(proposals[0].components.flatMap((ids,i)=>ids.map(id=>[id,i])));
  const order=grouped.map(s=>owners.get(s.newBrickIds[0])),runs=order.filter((id,i)=>!i||order[i-1]!==id);assert.deepEqual(runs,[0,1]);
  const tasks=p=>p.steps.map(s=>JSON.stringify([s.kind,s.newBrickIds,s.highlightBrickIds,s.issues])).sort();
  assert.deepEqual(tasks(after.instructionPlan),tasks(before.instructionPlan));
  const joins=p=>p.steps.filter(s=>s.kind==='join').map(s=>contactCells(p,s));assert.deepEqual(joins(after.assemblyPlan),joins(before.assemblyPlan));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.equal(completeNestedGroundLayouts(after),after);
 }
});

test('a protected task, mixed-area diagram or inconsistent floor cannot be reordered',()=>{
 for(const change of [
  r=>r.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='parent/layout').componentTask={id:'deliberate-task'},
  r=>r.instructionPlan.steps.find(s=>s.nestedRecipe?.id==='parent/layout').issues=[{code:'blocked-insertion',severity:'error',brickIds:[]}],
  r=>{for(const s of r.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout'))s.nestedRecipe.floorY++;},
  r=>{const steps=r.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout');steps[0].newBrickIds.push(steps[1].newBrickIds.pop());steps[0].highlightBrickIds=[...steps[0].newBrickIds];steps[1].highlightBrickIds=[...steps[1].newBrickIds];},
 ]) {
  const r=fixture();change(r);assert.deepEqual(discoverNestedGroundLayouts(r),[]);assert.equal(completeNestedGroundLayouts(r),r);
 }
});

test('full replay rejects an invented source warning rather than treating it as authority',()=>{
 const before=fixture(),s=before.assemblyPlan.steps.find(s=>s.nestedRecipe?.id==='parent/layout');
 s.issues=[{code:'limited-support',severity:'warning',message:'Advisory',brickIds:[s.newBrickIds[0]]}];
 // The diagram and source share that warning, but actual geometry does not.
 before.instructionPlan.steps.find(t=>t.sourceStepIds.includes(s.id)).issues=s.issues;
 assert.equal(discoverNestedGroundLayouts(before).length,1);
 const after=completeNestedGroundLayouts(before);assert.equal(after.nestedGroundLayouts.selected,false);
 assert.deepEqual(after.assemblyPlan,before.assemblyPlan);assert.deepEqual(after.instructionPlan,before.instructionPlan);
});


test('a complete existing component task moves intact with its table area',()=>{
 const before=fixture(),proposal=discoverNestedGroundLayouts(before)[0],ids=new Set(proposal.components[1]);
 const members=before.instructionPlan.steps.filter(s=>s.newBrickIds.some(id=>ids.has(id)));
 for(const [i,s]of members.entries())s.componentTask={id:'existing-area',index:i+1,total:members.length,lastStepId:members.at(-1).id};
 const after=completeNestedGroundLayouts(before);assert.ok(after.nestedGroundLayouts?.selected);
 const current=after.instructionPlan.steps.filter(s=>s.componentTask?.id==='existing-area');
 assert.deepEqual(current.map(s=>s.newBrickIds),members.map(s=>s.newBrickIds));
 assert.ok(current.every(s=>s.componentTask.lastStepId===current.at(-1).id));
 assert.equal(current.length,members.length);
 const crossing=fixture(),other=discoverNestedGroundLayouts(crossing)[0].ordered;
 other[0].componentTask={id:'cross-area',index:1,total:2,lastStepId:other.at(-1).id};
 other.at(-1).componentTask={id:'cross-area',index:2,total:2,lastStepId:other.at(-1).id};
 assert.deepEqual(discoverNestedGroundLayouts(crossing),[]);
});

test('equivalent source batches retain each placement outcome, scope and warning',()=>{
 const before=fixture().assemblyPlan,after=structuredClone(before);
 const index=after.steps.findIndex(s=>s.newBrickIds.length>1),step=after.steps[index];
 after.steps.splice(index,1,...step.newBrickIds.map((id,i)=>({...step,id:`split-${i}`,newBrickIds:[id],highlightBrickIds:[id]})));
 assert.ok(samePlacementOutcomes(before,after));
 for(const mutate of [
  p=>{p.steps[index].insertionDirection='up';},
  p=>{p.steps[index].moduleId='elsewhere';},
  p=>{p.steps[index].nestedRecipe={id:'other',floorY:3,separate:true};},
  p=>{p.steps[index].issues=[{code:'limited-support',severity:'warning',brickIds:p.steps[index].newBrickIds}];},
  p=>{p.steps[index].newBrickIds=[];},
  p=>{p.steps.splice(index,0,structuredClone(p.steps[index]));},
  p=>{p.bricks[0].color='changed';},
 ]){const altered=structuredClone(after);mutate(altered);assert.equal(samePlacementOutcomes(before,altered),false);}
});

test('complete compact table components retain literal operations in one diagram each',()=>{
 for(let turn=0;turn<4;turn++){
  const ordered=completeNestedGroundLayouts(fixture(turn,{narrow:true,bonded:true}));
  const snapshot=structuredClone(ordered),after=consolidateCompactNestedAreas(ordered);
  assert.deepEqual(ordered,snapshot);
  assert.equal(after.compactNestedAreas.changes.length,2);
  assert.deepEqual(after.assemblyPlan,ordered.assemblyPlan);
  const scope=after.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout');
  assert.equal(scope.length,2);assert.deepEqual(scope.map(s=>s.newBrickIds.length).sort(),[3,5]);
  for(const key of ['newBrickIds','sourceStepIds','orderedOperations'])assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s[key]),ordered.instructionPlan.steps.flatMap(s=>s[key]));
  assert.equal(consolidateCompactNestedAreas(after),after);
 }
});

test('side-adjacent columns without a stud bond remain separate placement diagrams',()=>{
 const ordered=completeNestedGroundLayouts(fixture(0,{narrow:true}));
 const after=consolidateCompactNestedAreas(ordered);
 assert.equal(after.compactNestedAreas.changes.length,1);
 assert.equal(after.compactNestedAreas.changes[0].parts,3);
 const original=ordered.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout');
 const merged=new Set(after.compactNestedAreas.changes.flatMap(c=>c.sourceDiagramIds));
 assert.deepEqual(after.instructionPlan.steps.filter(s=>s.nestedRecipe?.id==='parent/layout'&&!merged.has(s.id)),original.filter(s=>!merged.has(s.id)));
 assert.equal(after.instructionPlan.steps.length,ordered.instructionPlan.steps.length-2);
});
