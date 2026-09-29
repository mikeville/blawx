import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../../src/assembly.js';
import {prepareAssemblyGuide} from '../../src/prepare-assembly-guide.js';
import {rotateRecipeBrick} from '../../src/assembly-recipes.js';

export function repeatedSupportFixture(turn=0) {
  const bricks=[];
  for (const x of [0,8]) for(let y=0;y<4;y++) {
    if(y%2) for(let z=0;z<2;z++)bricks.push({x,y,z,w:4,d:1,color:'tan'});
    else for(let dx=0;dx<4;dx+=2)bricks.push({x:x+dx,y,z:0,w:2,d:2,color:'tan'});
  }
  bricks.push({x:0,y:4,z:0,w:4,d:1,color:'red'},{x:8,y:4,z:0,w:2,d:2,color:'blue'});
  for(let x=0;x<12;x+=4)bricks.push({x,y:5,z:0,w:4,d:2,color:'green'});
  for(const [x,w]of [[0,2],[2,4],[6,4],[10,2]])bricks.push({x,y:6,z:0,w,d:2,color:'green'});
  const moved=bricks.map(b=>rotateRecipeBrick(b,turn)),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const brickModel={version:1,kind:'bricks',bricks:moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ,color:turn&&b.color==='tan'?'yellow':b.color}))};
  const identified=createAssemblyPlan({brickModel,integratedBuild:true});
  const workSurfaceBrickIds=identified.bricks.filter(b=>b.y>=5).map(b=>b.id);
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,workSurfaceBrickIds,workSurfaceOrder:'connected-patches'});
  assert.equal(assemblyPlan.stats.unresolvedBrickCount,0);
  return prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}});
}

