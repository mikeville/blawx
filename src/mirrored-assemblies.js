import {mapRecipe} from './assembly-recipes.js';

const cells=bricks=>bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>`${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort().join('|');

// A reflected shape keeps its own diagrams. It must never inherit an
// identical-copy badge merely because its colored silhouette is mirrored.
export function markMirroredAssemblies(result,moduleIds) {
  const plan=result.assemblyPlan,by=new Map(plan.bricks.map(b=>[b.id,b]));
  const selected=plan.modules.filter(m=>moduleIds.has(m.id)&&m.kind==='grounded'),markers=new Map();
  for(let j=1;j<selected.length;j++)for(let i=0;i<j;i++){
    const a=selected[i],b=selected[j],source=a.brickIds.map(id=>by.get(id)),target=b.brickIds.map(id=>by.get(id)),targetCells=cells(target);
    if([0,1,2,3].some(turn=>cells(mapRecipe(source,target,turn))===targetCells))continue;
    const reflected=source.map(p=>({...p,x:-p.x-p.w}));
    const turn=[0,1,2,3].find(turn=>cells(mapRecipe(reflected,target,turn))===targetCells);
    if(turn!==undefined){markers.set(b.id,{sourceModuleId:a.id,rotationQuarterTurns:turn});break;}
  }
  if(!markers.size)return result;
  const modules=plan.modules.map(m=>markers.has(m.id)?{...m,mirroredAssembly:markers.get(m.id)}:m);
  return {...result,assemblyPlan:{...plan,modules},instructionPlan:{...result.instructionPlan,modules}};
}
