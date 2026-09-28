import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';
import {rotateRecipeBrick} from '../../src/assembly-recipes.js';

export function receiverFixture(turn=0,{repeatedSupports=false,blocked=false,weakCap=false}={}) {
  const bricks=[],add=(owner,x,y,z,w,d,color='tan')=>bricks.push({owner,x,y,z,w,d,color});
  add('base',2,0,0,2,4,'black');
  if(repeatedSupports)add('base-copy',4,0,0,2,4,'black');
  for(let x=0;x<8;x+=2)add('platform',blocked&&x===0?-1:x,1,0,2,4);
  for(let z=0;z<4;z++)for(const [x,w]of [[0,1],[1,4],[5,3]])add('platform',x,2,z,w,1);
  if(blocked)for(let x=0;x<8;x+=2)add('platform',x,3,0,2,4);
  const floor=blocked?3:2;
  add('left',-1,floor,0,1,1,'red');add('left',-1,floor+1,0,2,weakCap?4:1,'red');
  add('right',8,floor,3,1,1,'blue');add('right',7,floor+1,weakCap?0:3,2,weakCap?4:1,'blue');
  const moved=bricks.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner}));
  const minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const normalized=moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ,color:turn?(b.color==='red'?'green':b.color==='blue'?'yellow':b.color):b.color}));
  const brickModel={version:1,kind:'bricks',bricks:normalized.map(({owner,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks;
  const ownerByPosition=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const groups=new Map(['base',...(repeatedSupports?['base-copy']:[]),'platform','left','right'].map(owner=>[owner,identified.filter(b=>ownerByPosition.get(`${b.x},${b.y},${b.z}`)===owner).map(b=>b.id)]));
  const replay=[...groups].map(([owner,ids])=>({id:owner,label:owner,kind:owner.startsWith('base')?'grounded':'detail',brickIds:ids,brickOrder:ids,
    ...(owner.startsWith('base')?{}:{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:owner==='platform'?1:floor,orderPolicy:'course-first'}})}));
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay:replay});
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  if(repeatedSupports)for(const module of assemblyPlan.modules)if(module.id.startsWith('base'))module.recipeFamily='matching-supports';
  const compacted=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compacted.plan,guide:createGuideSections(compacted.plan),assemblyEvaluation:{compaction:compacted.report}};
}
