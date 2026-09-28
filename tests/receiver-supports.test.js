import {guideComponents} from '../src/guide-components.js';
import {createStepGuidance} from '../src/guide-step-guidance.js';
import {createSemanticGuideInput} from '../src/semantic-guide.js';
import test from 'node:test';import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';import {createGuideSections} from '../src/guide-sections.js';import {createBookletPresentation} from '../src/assembly-booklet-presentation.js';import {completeReceiverSupports,discoverReceiverSupports,discoverPrefixSupports} from '../src/complete-receiver-supports.js';import {rotateRecipeBrick} from '../src/assembly-recipes.js';import {contactCells} from '../src/local-interface-repair.js';
function fixture(turn=0,blocked=false){
 const parts=[...[0,6].flatMap(x=>[0,1].map(y=>({x,y,z:0,w:2,d:2,color:'black'}))),
  ...[1,3,5].map(x=>({x,y:2,z:0,w:2,d:2,color:'green'})),
  ...[[1,1],[2,4],[6,1]].map(([x,w])=>({x,y:3,z:0,w,d:2,color:'green'})),
  ...[0,7].flatMap(x=>[2,3].map(y=>({x,y,z:0,w:1,d:2,color:'black'})))];
 if(blocked)parts.push({x:0,y:4,z:0,w:2,d:2,color:'black'});
 const bricks=parts.map(b=>({...rotateRecipeBrick(b,turn),color:turn&&b.color==='green'?'orange':b.color})),brickModel={version:1,kind:'bricks',bricks};
 const bs=createAssemblyPlan({brickModel}).bricks,base=bs.filter(b=>b.y<2).map(b=>b.id),parent=bs.filter(b=>b.color!=='black').map(b=>b.id),upper=bs.filter(b=>b.color==='black'&&b.y>=2).map(b=>b.id);
 const assemblyPlan=createAssemblyPlan({brickModel,maxBricksPerStep:1,integratedBuild:true,moduleReplay:[
  {id:'base',label:'Base',kind:'grounded',brickIds:base,brickOrder:base},
  {id:'receiver',label:'Receiver',kind:'detail',groupType:'work-surface',brickIds:parent,brickOrder:parent,buildContext:{kind:'work-surface',floorY:2}},
  {id:'upper',label:'Continuation',kind:'grounded',groupType:'continuation',brickIds:upper,brickOrder:upper}],allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true});
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('complete grounded components repeat before their unchanged receiver attachment',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=completeReceiverSupports(before);
  assert.ok(after.receiverSupportCompletion?.selected,JSON.stringify(after.receiverSupportCompletion));
  assert.deepEqual(before,snapshot);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  const oldJoin=before.assemblyPlan.steps.find(s=>s.kind==='join'),join=after.assemblyPlan.steps.find(s=>s.kind==='join');
  assert.deepEqual(contactCells(before.assemblyPlan,oldJoin),contactCells(after.assemblyPlan,join));
  assert.ok(after.assemblyPlan.steps.slice(after.assemblyPlan.steps.indexOf(join)+1).every(s=>!s.moduleId.includes('-support-')));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  const view=createBookletPresentation(after);assert.ok(view.presentation.sections.some(s=>s.repeatCount===2),JSON.stringify(after.groundedRecipeSharing));
  assert.ok(view.numbering.diagramCount<=createBookletPresentation(before).numbering.diagramCount);
  assert.equal(completeReceiverSupports(after),after);
 }
});

test('a completed overhang that would block lowering the receiver is rejected',()=>{
 const before=fixture(0,true),after=completeReceiverSupports(before);
 assert.ok(discoverReceiverSupports(before.assemblyPlan).length);
 assert.equal(after.receiverSupportCompletion?.selected,false);
 assert.deepEqual(after.assemblyPlan,before.assemblyPlan);
});

test('discovery preserves existing recipe ownership and rejects interdependent components',()=>{
 const before=fixture(),p=before.assemblyPlan;assert.equal(discoverReceiverSupports(p).length,1);
 const repeated=structuredClone(p);repeated.modules[0].recipeFamily='existing';assert.deepEqual(discoverReceiverSupports(repeated),[]);
 const bridged=structuredClone(p),roots=p.bricks.filter(b=>b.y===0);bridged.graph.edges.push({a:roots[0].id,b:roots[1].id,studs:1});assert.deepEqual(discoverReceiverSupports(bridged),[]);
 const failed=structuredClone(p);failed.steps.find(s=>s.kind==='join').issues.push({severity:'error'});assert.deepEqual(discoverReceiverSupports(failed),[]);
});

function prefixFixture(turn=0,{handled=false,future=false,asymmetric=false}={}) {
 const lower=[0,6].flatMap(x=>[0,1,2,3].map(y=>({x,y,z:0,w:2,d:2,color:asymmetric&&x===6?'blue':'black'})));
 const receiver=[...[1,3,5].map(x=>({x,y:4,z:0,w:2,d:2,color:'green'})),
  ...[[1,1],[2,4],[6,1]].map(([x,w])=>({x,y:5,z:0,w,d:2,color:'green'}))];
 const upper=future?[...[0,7].flatMap(x=>[4,5].map(y=>({x,y,z:0,w:1,d:2,color:'black'}))),
  ...[0,4].map(x=>({x,y:6,z:0,w:4,d:2,color:'black'})),{x:2,y:7,z:0,w:4,d:2,color:'black'}]:[];
 const transformed=parts=>parts.map(b=>rotateRecipeBrick({...b,color:turn&&b.color==='green'?'orange':b.color},turn));
 const brickModel={version:1,kind:'bricks',bricks:transformed([...lower,...receiver,...upper])},bs=createAssemblyPlan({brickModel}).bricks;
 const identify=parts=>transformed(parts).map(b=>bs.find(t=>t.x===b.x&&t.y===b.y&&t.z===b.z&&t.w===b.w&&t.d===b.d&&t.color===b.color).id);
 const child=handled?lower.filter(b=>b.x===0&&b.y>=2):[],base=identify(lower.filter(b=>!child.includes(b))),childIds=identify(child),parent=identify(receiver),later=identify(upper);
 const by=new Map(bs.map(b=>[b.id,b]));base.sort((a,b)=>by.get(a).y-by.get(b).y||by.get(a).x-by.get(b).x);
 const descriptor=(id,ids,extra={})=>({id,label:id,kind:'grounded',brickIds:ids,brickOrder:ids,actionOrder:true,placementGroups:ids.map(id=>[id]),...extra});
 const moduleReplay=[descriptor('interleaved-base',base),...(child.length?[descriptor('existing-child',childIds,{kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:2}})]:[]),
  descriptor('receiver',parent,{kind:'detail',groupType:'work-surface',buildContext:{kind:'work-surface',floorY:4}}),...(future?[descriptor('future-crown',later,{groupType:'continuation'})]:[])];
 const assemblyPlan=createAssemblyPlan({brickModel,maxBricksPerStep:1,integratedBuild:true,moduleReplay,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true});
 assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}

test('interleaved grounded prefixes become complete repeated components before an existing receiver',()=>{
 for(let turn=0;turn<4;turn++) {
  const before=prefixFixture(turn),snapshot=structuredClone(before),after=completeReceiverSupports(before);
  assert.ok(discoverPrefixSupports(before.assemblyPlan).length);
  assert.ok(after.receiverSupportCompletion?.selected,JSON.stringify(after.receiverSupportCompletion));
  assert.deepEqual(before,snapshot);assert.deepEqual(after.brickModel,before.brickModel);
  assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.receiverSupportCompletion.kind,'prefix-components');
  const v=createBookletPresentation(after);assert.ok(v.presentation.sections.some(s=>s.repeatCount===2));
  assert.ok(v.numbering.diagramCount<=createBookletPresentation(before).numbering.diagramCount);
  const old=before.assemblyPlan.steps.find(s=>s.kind==='join'),now=after.assemblyPlan.steps.find(s=>s.moduleId==='receiver'&&s.kind==='join');
  assert.deepEqual(contactCells(after.assemblyPlan,now),contactCells(before.assemblyPlan,old));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.equal(completeReceiverSupports(after),after);
 }
});

test('a preserved small handled recipe stays inside its completed grounded component',()=>{
 const before=prefixFixture(0,{handled:true,asymmetric:true}),after=completeReceiverSupports(before);
 assert.ok(after.receiverSupportCompletion?.selected,JSON.stringify(after.receiverSupportCompletion));
 for(const old of before.assemblyPlan.steps.filter(s=>s.kind==='join')){
  const current=after.assemblyPlan.steps.find(s=>s.kind==='join'&&s.moduleId===old.moduleId);
  assert.ok(current&&!current.issues.length);assert.deepEqual(contactCells(after.assemblyPlan,current),contactCells(before.assemblyPlan,old));
 }
 assert.ok(!createBookletPresentation(after).presentation.sections.some(s=>s.repeatCount>1),'different components must not share a false recipe');
 const sourceIds=after.instructionPlan.steps.flatMap(s=>s.sourceStepIds);assert.deepEqual(sourceIds,after.assemblyPlan.steps.map(s=>s.id));
});

test('future connecting work does not merge the grounded components beneath an earlier receiver',()=>{
 const before=prefixFixture(0,{future:true}),after=completeReceiverSupports(before),proposals=discoverPrefixSupports(before.assemblyPlan);
 assert.ok(proposals.some(p=>p.components.length===2));
 assert.ok(after.receiverSupportCompletion?.selected,JSON.stringify(after.receiverSupportCompletion));
 assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
 assert.ok(after.assemblyPlan.steps.filter(s=>s.moduleId==='future-crown').every(s=>s.newBrickIds.every(id=>after.assemblyPlan.bricks.find(b=>b.id===id).y>4)));
 assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
 assert.ok(createBookletPresentation(after).numbering.diagramCount<=createBookletPresentation(before).numbering.diagramCount);
});

test('prefix ownership keeps protected recipes and physically failed receivers out of discovery',()=>{
 const before=prefixFixture(),protectedPlan=structuredClone(before.assemblyPlan);
 protectedPlan.modules[0].mirroredAssembly={};assert.deepEqual(discoverPrefixSupports(protectedPlan),[]);
 const failed=structuredClone(before.assemblyPlan);failed.steps.find(s=>s.kind==='join').issues.push({code:'blocked-module-insertion',severity:'error'});
 assert.deepEqual(discoverPrefixSupports(failed),[]);
});


test('logical components retain physical child joins inside one flat inventory-complete section',()=>{
 const after=completeReceiverSupports(prefixFixture(0,{handled:true,asymmetric:true}));
 const plan=after.instructionPlan,components=guideComponents(plan),view=createBookletPresentation(after);
 assert.equal(components.length,2);
 const compound=components.find(c=>c.moduleIds.includes('existing-child'));
 assert.ok(compound.moduleIds.length>1);
 const section=view.presentation.sections.find(s=>s.moduleIds.includes('existing-child'));
 assert.deepEqual(section.stepIds,compound.steps.map(s=>s.id));
 assert.deepEqual([...section.brickIds].sort(),[...compound.brickIds].sort());
 assert.equal(section.inventory.reduce((sum,p)=>sum+p.count,0),compound.brickIds.length);
 const all=view.presentation.sections.flatMap(s=>s.instances.flatMap(i=>i.brickIds));
 assert.deepEqual([...all].sort(),plan.bricks.map(b=>b.id).sort());
 const first=compound.steps[0],child=compound.steps.find(s=>s.moduleId==='existing-child'&&s.kind==='build');
 const finalJoinNumber=view.numbering.byStepId.get(compound.attachment.id);
 assert.match(createStepGuidance(plan,first,view.numbering).instruction,new RegExp(`until step ${finalJoinNumber}`));
 assert.doesNotMatch(createStepGuidance(plan,first,view.numbering).instruction,/completed assembly aside/);
 assert.match(createStepGuidance(plan,child,view.numbering).instruction,/separately on a flat table/);
 const input=createSemanticGuideInput({plan,guide:after.guide});
 assert.ok(input.protectedRanges.some(r=>r.startStepId===first.id&&r.endStepId===compound.steps.at(-1).id));
});

test('logical ownership must cover a consistent contiguous whole component',()=>{
 const after=completeReceiverSupports(prefixFixture(0,{handled:true,asymmetric:true})),plan=after.instructionPlan;
 const component=guideComponents(plan).find(c=>c.moduleIds.includes('existing-child'));
 for(const corrupt of [
  p=>p.modules.find(m=>m.id==='existing-child').componentRecipe.brickIds.pop(),
  p=>p.modules.find(m=>m.id==='existing-child').componentRecipe.moduleIds.pop(),
  p=>p.modules.find(m=>m.id==='existing-child').componentRecipe.receiverModuleId='missing',
  p=>{const i=p.steps.findIndex(s=>!component.moduleIds.includes(s.moduleId));p.steps.splice(1,0,p.steps.splice(i,1)[0]);},
 ]) {
  const p=JSON.parse(JSON.stringify(plan));corrupt(p);
  assert.ok(!guideComponents(p).some(c=>c.id===component.id));
 }
 const adjacent=JSON.parse(JSON.stringify(plan));
 adjacent.modules.filter(m=>!component.moduleIds.includes(m.id)).forEach(m=>m.label='Base assembly 1');
 assert.deepEqual(guideComponents(adjacent).map(c=>c.moduleIds),guideComponents(plan).map(c=>c.moduleIds));
});
