import test from 'node:test';import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {raisedBranches} from '../src/raised-work-features.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';
import {orientedCourseRejections} from '../src/oriented-course-diagrams.js';
import {workingViewBrick} from '../src/recipe-working-frame.js';
import {chooseInstructionView} from '../src/instruction-visibility.js';

function fork(turn=0){
 const bricks=[{x:0,y:0,z:0,w:8,d:2,color:'black'},
  ...Array.from({length:5},(_,i)=>({x:0,y:i+1,z:0,w:2,d:2,color:'blue'})),
  ...Array.from({length:3},(_,i)=>({x:6,y:i+1,z:0,w:2,d:2,color:'white'}))].map(b=>rotateRecipeBrick({...b,color:turn%2&&b.color==='blue'?'green':b.color},turn));
 return createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks},integratedBuild:true,allowUnderAttachments:false});
}
for(let turn=0;turn<4;turn++)test(`complete a supported branch before moving to the next (${turn})`,()=>{
 const before=fork(turn),snapshot=structuredClone(before),out=raisedBranches(before);
 assert(out.length);assert.deepEqual(before,snapshot);
 const chosen=out.sort((a,b)=>a.groups.length-b.groups.length)[0];
 assert(chosen.groups.length<before.steps.length);assert.equal(chosen.local.stats.unresolvedBrickCount,0);
 assert.deepEqual(chosen.groups.flat().sort(),before.bricks.map(b=>b.id).sort());
 assert.equal(chosen.featureGroups[0].length,3);assert.equal(chosen.branchParts[0],3);
 const by=new Map(chosen.local.bricks.map(b=>[b.id,b]));let scene=[];
 for(const ids of chosen.groups){scene.push(...ids);const v=chooseInstructionView({visibleBricks:scene.map(id=>by.get(id)),highlightedIds:ids});assert(v.passes&&!v.truncated);}
});
test('a shared upper receiver prevents independent branch ownership',()=>{
 const p=fork(),bricks=p.bricks.map(({id,...b})=>b);bricks.push({x:0,y:6,z:0,w:8,d:2,color:'black'},... [4,5].map(y=>({x:6,y,z:0,w:2,d:2,color:'white'})));
 const joined=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks},integratedBuild:true,allowUnderAttachments:false});
 assert.deepEqual(raisedBranches(joined),[]);
});
test('multi-course diagrams require a bounded explicit feature and preserve every piece visibility',()=>{
 const plan=fork(),found=raisedBranches(plan)[0],wanted=new Set(found.featureGroups[0]);
 const local=found.local,by=new Map(local.bricks.map(b=>[b.id,{...b,y:6-b.y,z:-b.z-b.d}]));
 const steps=local.steps.filter(s=>s.newBrickIds.some(id=>wanted.has(id))).map(s=>({...s,insertionDirection:'up',workingOrientation:{kind:'inverted',surfaceY:7}}));
 assert(orientedCourseRejections(steps,by).includes('incomplete-course'));
 assert.deepEqual(orientedCourseRejections(steps,by,{feature:true}),[]);
 const bad=structuredClone(steps);bad[0].issues.push({code:'unsupported-addition',severity:'error',brickIds:bad[0].newBrickIds});
 assert(orientedCourseRejections(bad,by,{feature:true}).includes('reported-issue'));
 assert.deepEqual(workingViewBrick(by.get(steps[0].newBrickIds[0]),steps[0].workingOrientation),local.bricks.find(b=>b.id===steps[0].newBrickIds[0]));
});
