import {rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';

export function detachedInterfaceFixture(turn=0,{blocked=false}={}){
  const bricks=[],add=(owner,x,y,z,w,d,color)=>bricks.push({owner,x,y,z,w,d,color});
  for(const x of [0,4])add('base',x,0,0,4,2,'black');
  for(const [x,w] of [[0,2],[2,4],[6,2]])add('receiver',x,1,0,w,2,'darkGray');
  for(const x of [0,4])add('receiver',x,2,0,4,2,'darkGray');
  for(const x of [0,4])add('detached',x,2,2,4,1,'lightGray');
  for(const [x,w] of [[0,2],[2,4],[6,2]])add('detached',x,3,2,w,1,'lightGray');
  if(blocked){for(let y=3;y<=5;y++)add('receiver',0,y,0,1,1,'darkGray');add('receiver',0,6,0,1,3,'darkGray');}
  const color=turn%2?'blue':'red';
  for(const x of [0,7])add('detached',x,5,2,1,1,color);
  const moved=bricks.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner})),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const normalized=moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ}));
  const brickModel={kind:'bricks',version:1,bricks:normalized.map(({owner,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks,owner=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const moduleReplay=['base','receiver','detached'].map(id=>{
    const owned=identified.filter(b=>owner.get(`${b.x},${b.y},${b.z}`)===id),groups=[...new Set(owned.map(b=>b.y))].sort((a,b)=>a-b).map(y=>owned.filter(b=>b.y===y).map(b=>b.id));
    return {id,label:id,kind:id==='base'?'grounded':id==='receiver'?'detail':'floating',brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(id==='detached'?{groupType:'detached-parts'}:{}),
      ...(id==='receiver'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}}:{})};
  });
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay}),compact=compactAssemblyPlan(assemblyPlan);
  const supportCells=[0,7].map(x=>rotateRecipeBrick({x,y:4,z:2,w:1,d:1,color},turn)).map(({x,y,z,color})=>({x:x-minX,y,z:z-minZ,color}));
  return {brickModel,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan),assemblyEvaluation:{compaction:compact.report},continuityRefinement:{supportCells}};
}
