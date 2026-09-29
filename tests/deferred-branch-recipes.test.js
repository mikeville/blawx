import test from 'node:test';
import assert from 'node:assert/strict';
import {lowerBranchClosure,discoverDeferredBranchRecipe} from '../src/deferred-branch-recipes.js';
import {readableMaterialRichCourse} from '../src/material-rich-courses.js';
import {orientedCourseRejections} from '../src/oriented-course-diagrams.js';
import {recipeBrickId,rotateRecipeBrick} from '../src/assembly-recipes.js';

for(let turn=0;turn<4;turn++)test(`deferred branch follows every obstructing lower column (${turn})`,()=>{
  const parts=[{x:0,y:3,z:0,w:2,d:2},{x:1,y:2,z:1,w:2,d:2},
    {x:2,y:0,z:2,w:2,d:2},{x:8,y:0,z:0,w:2,d:2},{x:0,y:4,z:0,w:2,d:2}]
    .map(b=>rotateRecipeBrick({...b,y:b.y+5,color:turn%2?'yellow':'blue'},turn))
    .map(b=>({...b,id:recipeBrickId(b)}));
  const snapshot=structuredClone(parts);
  assert.deepEqual(lowerBranchClosure(parts,[parts[0].id]).map(b=>b.id),parts.slice(0,3).map(b=>b.id));
  assert.deepEqual(parts,snapshot);
  assert.deepEqual(lowerBranchClosure(parts,['missing']),[]);
});

const layer=()=>Array.from({length:8},(_,i)=>({id:String(i),x:i%4*2,y:0,z:Math.floor(i/4)*2,w:2,d:2,color:['red','blue','green','white'][i%4]}));
test('a material-rich course stays bounded by footprint, course and sorting complexity',()=>{
  assert(readableMaterialRichCourse(layer()));
  for(const transform of[
    bs=>bs.map((b,i)=>({...b,x:i*4})),
    bs=>bs.map((b,i)=>({...b,y:i%2})),
    bs=>bs.map((b,i)=>({...b,color:String(i)})),
    bs=>Array.from({length:32},(_,i)=>({...bs[i%8],x:i%8*2,z:Math.floor(i/8)*2})),
  ])assert.equal(readableMaterialRichCourse(transform(layer())),false);
});

test('explicit mixed-material recipes still require real visibility and identical working poses',()=>{
  const bricks=layer(),by=new Map(bricks.map(b=>[b.id,b]));
  const steps=bricks.map((b,i)=>({kind:'build',newBrickIds:[b.id],visibleBrickIds:bricks.slice(0,i+1).map(b=>b.id),issues:[],insertionDirection:'up',workingOrientation:{kind:'inverted',surfaceY:1}}));
  assert(orientedCourseRejections(steps,by).includes('course-complexity'));
  assert.deepEqual(orientedCourseRejections(steps,by,{allowMixedMaterials:true}),[]);
  const changed=structuredClone(steps);changed[1].workingOrientation.surfaceY=2;
  assert(orientedCourseRejections(changed,by,{allowMixedMaterials:true}).includes('working-orientation-boundary'));
  const bad=structuredClone(steps);bad[0].issues=[{code:'unsupported-addition',severity:'error'}];
  assert(orientedCourseRejections(bad,by,{allowMixedMaterials:true}).includes('reported-issue'));
  const blocker={id:'blocker',x:0,y:-1,z:0,w:8,d:4,color:'black'};by.set(blocker.id,blocker);
  const hidden=structuredClone(steps);hidden.at(-1).visibleBrickIds.push(blocker.id);
  assert(orientedCourseRejections(hidden,by,{allowMixedMaterials:true}).includes('visibility'));
});

test('branch discovery is bounded and leaves an already usable connected workpiece unsplit',()=>{
  assert.deepEqual(discoverDeferredBranchRecipe([]),{attempts:[],candidate:null});
  assert.deepEqual(discoverDeferredBranchRecipe(Array(513).fill({})),{attempts:[],candidate:null});
  const bs=[0,1,2,3].flatMap(y=>[0,2].flatMap(z=>[0,2,4,6].map(x=>({x:x+(y%2),y,z,w:2,d:2,color:'blue'}))));
  const snapshot=structuredClone(bs),found=discoverDeferredBranchRecipe(bs);
  assert.equal(found.candidate,null);assert.deepEqual(bs,snapshot);
});
