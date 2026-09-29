import test from 'node:test';import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';import {createGuideSections} from '../src/guide-sections.js';
import {completeReceiverConnections,discoverReceiverConnections} from '../src/complete-receiver-connections.js';
import {contactCells} from '../src/local-interface-repair.js';
function fixture(turn=0,blocked=false){
 let bricks=[[2,0,0,1,4,'black'],[2,1,0,1,4,'tan'],[2,2,0,1,2,'tan'],[2,2,2,1,2,'tan'],[2,3,0,1,4,'red'],[2,4,0,1,4,'blue'],[2,5,0,1,4,'blue'],[1,3,0,1,2,'brown'],[1,3,2,1,2,'brown'],[1,4,0,1,4,'green']].map(([x,y,z,w,d,color],i)=>({x,y,z,w,d,color,owner:i===0?0:i<7?1:2}));
 if(blocked){for(let y=0;y<6;y++)bricks.push({x:3,y,z:0,w:1,d:2,color:'black',owner:0});bricks.push({x:1,y:6,z:0,w:3,d:2,color:'black',owner:0});}
 const palette=turn%2?{tan:'white',brown:'yellow',green:'red',red:'blue',blue:'green',black:'black'}:{};
 bricks=bricks.map(b=>{let n={...b};for(let i=0;i<turn;i++)n={...n,x:-n.z-n.d,z:n.x,w:n.d,d:n.w};return{...n,x:n.x+12,z:n.z+12,color:palette[b.color]??b.color};});
 const brickModel={version:1,kind:'bricks',bricks:bricks.map(({owner,...b})=>b)},identified=createAssemblyPlan({brickModel}).bricks;
 const groups=[0,1,2].map(owner=>identified.filter(b=>bricks.some(n=>n.owner===owner&&n.x===b.x&&n.y===b.y&&n.z===b.z)));
 const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:groups.map((bs,i)=>({id:`m${i}`,label:`Assembly ${i}`,kind:['grounded','detail','floating'][i],brickIds:bs.map(b=>b.id),brickOrder:bs.map(b=>b.id)}))});
 const instructionPlan={...assemblyPlan,steps:assemblyPlan.steps.map(s=>({...s,sourceStepIds:[s.id]}))};
 return{brickModel,assemblyPlan,instructionPlan,guide:createGuideSections(instructionPlan),metrics:{conversionMs:0}};
}
const cells=bs=>new Map(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}`,b.color])));

test('complete receiver repair covers both disconnected lower roots across rotations and palettes',()=>{
 for(let turn=0;turn<4;turn++){
  const before=fixture(turn),snapshot=structuredClone(before),after=completeReceiverConnections(before,{allowExtensions:true});
  assert.deepEqual(before,snapshot);assert.equal(before.assemblyPlan.stats.unresolvedBrickCount,3);assert.equal(after.assemblyPlan.stats.unresolvedBrickCount,0);
  assert.equal(after.receiverConnectionCompletion.selected,true);assert.equal(after.receiverConnectionCompletion.addedCells.length,2);
  assert.equal(after.metrics.structuralAddedMappedCellCount,2);assert.equal(after.receiverConnectionCompletion.attempts[0].joined.length,3);
  const old=cells(before.brickModel.bricks),next=cells(after.brickModel.bricks);assert.equal(next.size,old.size+2);for(const[k,c]of old)assert.equal(next.get(k),c);
  for(const c of after.receiverConnectionCompletion.addedCells)assert.ok(next.has(`${c.x},${c.y+1},${c.z}`));
  assert.ok(after.assemblyPlan.steps.filter(s=>s.moduleId==='m1').every(s=>!s.issues.length));
  const join=p=>p.steps.find(s=>s.moduleId==='m1'&&s.kind==='join'&&!s.nestedRecipe);
  assert.ok(join(after.assemblyPlan).joinContext);assert.deepEqual(contactCells(before.assemblyPlan,join(before.assemblyPlan)),contactCells(after.assemblyPlan,join(after.assemblyPlan)));
  assert.deepEqual(after.instructionPlan.steps.flatMap(s=>s.sourceStepIds),after.assemblyPlan.steps.map(s=>s.id));
  assert.deepEqual(after.assemblyPlan.steps.flatMap(s=>s.newBrickIds).sort(),after.assemblyPlan.bricks.map(b=>b.id).sort());
  assert.equal(completeReceiverConnections(after,{allowExtensions:true}),after);
 }
});

test('one support is insufficient and protected or unapproved geometry stays unchanged',()=>{
 for(const mode of ['disabled','budget','raw','repeat','component','mirror']){
  const before=fixture(),parent=before.assemblyPlan.modules.find(m=>m.id==='m1');
  if(mode==='budget')before.metrics.structuralAddedMappedCellCount=3;
  if(mode==='raw')before.metrics.geometryDifferenceRatio=0;
  if(mode==='repeat')parent.sharedHandledRecipe={familyId:'pair'};
  if(mode==='component')parent.componentRecipe={receiverModuleId:'base'};
  if(mode==='mirror')parent.mirroredAssembly={sourceModuleId:'base'};
  const after=completeReceiverConnections(before,{allowExtensions:mode!=='disabled'});
  assert.notEqual(after.receiverConnectionCompletion?.selected,true,mode);
  for(const k of ['brickModel','assemblyPlan','instructionPlan','guide'])assert.deepEqual(after[k],before[k],mode);
 }
 assert.equal(discoverReceiverConnections(fixture(),1).length,0);
});

test('an obstructed final receiver insertion cannot be accepted as a complete repair',()=>{
 const before=fixture(0,true),after=completeReceiverConnections(before,{allowExtensions:true});
 assert.notEqual(after.receiverConnectionCompletion?.selected,true);
 assert.deepEqual(after.assemblyPlan,before.assemblyPlan);
});
