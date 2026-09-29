import {rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';

export function detachedRoofFixture(turn=0,{recolor=false}={}){
  const bricks=[],add=(owner,x,y,z,w,d,color)=>bricks.push({owner,x,y,z,w,d,color});
  for(const x of [0,2,4,6])add('base',x,0,0,2,2,'black');
  const color=turn%2?'blue':'green';
  for(const x of [0,2,4,6])add('roof',x,1,0,2,2,color);
  for(const [x,w] of [[0,3],[3,4],[7,1]])add('roof',x,2,0,w,2,color);
  add('trim',8,1,0,2,2,recolor?'yellow':color);add('trim',8,2,0,2,2,'white');
  add('later',0,3,0,2,2,'red');add('later',0,4,0,2,2,'white');
  add('trim',15,5,0,1,1,'orange');
  const moved=bricks.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner})),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const normalized=moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ})),brickModel={kind:'bricks',version:1,bricks:normalized.map(({owner,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks,owner=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const moduleReplay=['base','roof','later','trim'].map(id=>{
    const bs=identified.filter(b=>owner.get(`${b.x},${b.y},${b.z}`)===id),groups=[...new Set(bs.map(b=>b.y))].sort((a,b)=>a-b).map(y=>bs.filter(b=>b.y===y).map(b=>b.id));
    return {id,label:id,kind:id==='trim'?'floating':id==='roof'?'detail':'grounded',brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(id==='roof'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}}:{}),
      ...(id==='trim'?{groupType:'detached-parts'}:{}),...(id==='later'?{groupType:'continuation'}:{})};
  });
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay}),compact=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan),assemblyEvaluation:{compaction:compact.report}};
}
