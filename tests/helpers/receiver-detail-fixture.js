import {rotateRecipeBrick} from '../../src/assembly-recipes.js';
import {createAssemblyPlan} from '../../src/assembly.js';
import {compactAssemblyPlan} from '../../src/assembly-diagrams.js';
import {createGuideSections} from '../../src/guide-sections.js';

export function receiverDetailFixture(turn=0,{blocked=false}={}){
  const bricks=[],add=(owner,x,y,z,w,d,color,phase=y)=>bricks.push({owner,x,y,z,w,d,color,phase});
  for(const x of [0,4]){add('body',x,0,0,4,2,'brown');add('body',x,1,0,4,2,'brown',blocked?5:1);}
  if(blocked){add('body',0,0,3,1,1,'brown');add('body',0,1,3,1,1,'brown');add('body',0,2,3,1,1,'brown');add('body',0,3,2,2,2,'black');}
  else{add('body',0,2,0,2,2,'brown');add('body',0,3,0,2,4,'black');}
  add('top',4,2,0,2,2,'white');add('top',4,3,0,2,2,'white');
  add('review',1,1,2,1,1,turn%2?'blue':'yellow');add('review',12,5,0,1,1,'orange');
  const moved=bricks.map(b=>({...rotateRecipeBrick(b,turn),owner:b.owner,phase:b.phase})),minX=Math.min(...moved.map(b=>b.x)),minZ=Math.min(...moved.map(b=>b.z));
  const normalized=moved.map(b=>({...b,x:b.x-minX,z:b.z-minZ})),brickModel={version:1,kind:'bricks',bricks:normalized.map(({owner,phase,...b})=>b)};
  const identified=createAssemblyPlan({brickModel}).bricks,owner=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.owner]));
  const phase=new Map(normalized.map(b=>[`${b.x},${b.y},${b.z}`,b.phase]));
  const moduleReplay=['body','top','review'].map(id=>{
    const bs=identified.filter(b=>owner.get(`${b.x},${b.y},${b.z}`)===id),groups=[...new Set(bs.map(b=>phase.get(`${b.x},${b.y},${b.z}`)))].sort((a,b)=>a-b).map(y=>bs.filter(b=>phase.get(`${b.x},${b.y},${b.z}`)===y).map(b=>b.id));
    return {id,label:id,kind:id==='body'?'grounded':id==='top'?'detail':'floating',brickIds:groups.flat(),brickOrder:groups.flat(),placementGroups:groups,actionOrder:true,
      ...(id==='review'?{groupType:'detached-parts'}:{}),...(id==='top'?{groupType:'work-surface',buildContext:{kind:'work-surface',floorY:2,orderPolicy:'planned-actions'}}:{})};
  });
  const assemblyPlan=createAssemblyPlan({brickModel,moduleReplay}),compact=compactAssemblyPlan(assemblyPlan);
  return {brickModel,assemblyPlan,instructionPlan:compact.plan,guide:createGuideSections(compact.plan),assemblyEvaluation:{compaction:compact.report}};
}
