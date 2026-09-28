import {rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';

export function tableEaveFixture(turn=0,{withoutBase=false,splitUpper=false}={}){
  const color=turn%2?'blue':'green';
  const source=[
    {owner:'base',x:0,y:0,z:5,w:4,d:1,color:'black'},
    {owner:'trim',x:0,y:1,z:0,w:4,d:2,color},
    {owner:'roof',x:0,y:1,z:2,w:2,d:4,color},
    {owner:'roof',x:2,y:1,z:2,w:2,d:4,color},
    ...(splitUpper?[{owner:'roof',x:0,y:2,z:2,w:4,d:2,color},{owner:'roof',x:0,y:2,z:4,w:4,d:2,color}]:[
      {owner:'roof',x:0,y:2,z:2,w:4,d:1,color},
      {owner:'roof',x:0,y:2,z:3,w:4,d:2,color},
      {owner:'roof',x:0,y:2,z:5,w:4,d:1,color}]),
    {owner:'later',x:0,y:3,z:2,w:2,d:2,color:'white'},
  ].filter(b=>!withoutBase||!['base','later'].includes(b.owner));
  const rotated=source.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner}));
  const minX=Math.min(...rotated.map(b=>b.x)),minZ=Math.min(...rotated.map(b=>b.z));
  const normalized=rotated.map(b=>({...b,x:b.x-minX,z:b.z-minZ}));
  const brickModel={kind:'bricks',version:1,bricks:normalized.map(({owner,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks;
  const owners=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const moduleReplay=['base','roof','later','trim'].flatMap(id=>{
    const bricks=identified.filter(b=>owners.get(`${b.x},${b.y},${b.z}`)===id);
    if(!bricks.length)return [];
    const groups=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b).map(y=>bricks.filter(b=>b.y===y).map(b=>b.id));
    return [{id,label:id,kind:id==='trim'?'floating':id==='roof'?'detail':'grounded',brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(id==='roof'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:1,orderPolicy:'planned-actions'}}:{}),
      ...(id==='trim'?{groupType:'detached-parts'}:{}),...(id==='later'?{groupType:'continuation'}:{})}];
  });
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay}),compact=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan),assemblyEvaluation:{compaction:compact.report}};
}
