import assert from 'node:assert/strict';
import {rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';

export function handledPanelFixture(turn=0){
  const bricks=[],add=(owner,x,y,z,w,d,color)=>bricks.push({owner,x,y,z,w,d,color});
  for(let x=0;x<8;x+=2)for(let z=0;z<6;z+=2)add('base',x,0,z,2,2,'black');
  for(let side=0;side<2;side++)for(let y=1;y<=4;y++){
    const widths=side===0?(y%2?[4,4]:[2,4,2]):(y%2?[3,3,2]:[2,3,3]);let x=0;
    for(const w of widths){add(`panel-${side}`,x,y,side*4,w,1,y===3?'white':turn%2?'blue':'green');x+=w;}
  }
  const moved=bricks.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner})),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const normalized=moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ}));
  const brickModel={kind:'bricks',version:1,bricks:normalized.map(({owner,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks,owner=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const replay=['base','panel-0','panel-1'].map(id=>{const ids=identified.filter(b=>owner.get(`${b.x},${b.y},${b.z}`)===id).map(b=>b.id);return {id,label:id,kind:id==='base'?'grounded':'detail',brickIds:ids,brickOrder:ids,...(id==='base'?{}:{groupType:'branch'})};});
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay});assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  const compact=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan),assemblyEvaluation:{compaction:compact.report}};
}
