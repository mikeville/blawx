const key=b=>`${b.x},${b.y},${b.z}`;
export const recipeBrickId=b=>`b@${key(b)}:${b.w}x${b.d}:${b.color}`;
const origin=bs=>({x:Math.min(...bs.map(b=>b.x)),y:Math.min(...bs.map(b=>b.y)),z:Math.min(...bs.map(b=>b.z))});
const cells=bs=>new Map(bs.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>[key({x:b.x+i%b.w,y:b.y,z:b.z+Math.floor(i/b.w)}),b.color])));
export function rotateRecipeBrick(b, turns) {
  let result={...b};
  for(let i=0;i<turns;i++) result={...result,x:-result.z-result.d,z:result.x,w:result.d,d:result.w};
  return result;
}
export function mapRecipe(source,target,turns) {
  const rotated=source.map(b=>rotateRecipeBrick(b,turns));
  const a=origin(rotated),b=origin(target);
  return rotated.map(brick=>{const mapped={...brick,x:brick.x+b.x-a.x,y:brick.y+b.y-a.y,z:brick.z+b.z-a.z};return {...mapped,id:recipeBrickId(mapped)};});
}

// Reuse exact recipes before scheduling. Optional differences are restricted to
// tiny ground supports absent from the raw ground layer; never erase an original
// cell, recolor source ground cells, or alter the component above its underside.
export function proposeSharedRecipes(brickModel, replay, {rawModel,adjustments=false,repairCells=[]}={}) {
  const byId=new Map(brickModel.bricks.map(b=>[recipeBrickId(b),{...b,id:recipeBrickId(b)}]));
  const originalGround=new Map((rawModel?.cells??[]).filter(c=>c.y===0).map(c=>[key(c),c.color]));
  const repairs=new Set(repairCells.map(key));
  const representatives=[];const changes=[];const families=[];
  const ordered=[...replay].sort((a,b)=>b.brickIds.reduce((n,id)=>n+byId.get(id).w*byId.get(id).d,0)-a.brickIds.reduce((n,id)=>n+byId.get(id).w*byId.get(id).d,0));
  const modules=ordered.map(module=>{
    const target=module.brickIds.map(id=>byId.get(id));
    if(module.kind!=='grounded'||module.groupType||target.length>80) return module;
    const targetCells=cells(target);
    for(const representative of representatives)for(let turns=0;turns<4;turns++){
      const mapped=mapRecipe(representative.bricks,target,turns),proposed=cells(mapped);
      const removed=[...targetCells].filter(([k])=>!proposed.has(k));
      const changed=[...proposed].filter(([k,c])=>targetCells.get(k)!==c);
      if(removed.length) continue;
      if(changed.length && (!adjustments||!rawModel||changed.length>3||changed.length>targetCells.size*.06
        ||changed.some(([k,c])=>k.split(',')[1]!=='0'||targetCells.has(k)&&!repairs.has(k)||originalGround.has(k)&&originalGround.get(k)!==c))) continue;
      // A small underside repair is justified only by otherwise exact geometry.
      if([...targetCells].some(([k,c])=>k.split(',')[1]!=='0'&&proposed.get(k)!==c)) continue;
      const replaced=new Set(module.brickIds);
      const outside=cells([...byId].filter(([k])=>!replaced.has(k)).map(([,b])=>b));
      if([...proposed.keys()].some(k=>outside.has(k))) continue;
      for(const old of module.brickIds) byId.delete(old);
      for(const b of mapped) byId.set(b.id,b);
      const family={moduleId:module.id,representativeId:representative.moduleId,rotationQuarterTurns:turns};families.push(family);
      if(changed.length) changes.push({moduleId:module.id,cells:changed.map(([position,color])=>({position,before:targetCells.get(position)??null,after:color}))});
      return {...module,brickIds:mapped.map(b=>b.id),brickOrder:mapped.map(b=>b.id),recipe:family};
    }
    representatives.push({moduleId:module.id,bricks:target});
    return module;
  });
  return {brickModel:{...brickModel,bricks:[...byId.values()].map(({id,...b})=>b)},replay:replay.map(m=>modules.find(n=>n.id===m.id)),families,changes};
}

export function shareRecipeActions(replay, bricks) {
  const byId=new Map(bricks.map(b=>[b.id,b]));
  const result=[];
  for(const module of replay){
    const representative=replay.find(m=>m.id===module.recipe?.representativeId);
    if(!representative){result.push(module);continue;}
    const source=representative.brickIds.map(id=>byId.get(id)),target=module.brickIds.map(id=>byId.get(id));
    const mapped=mapRecipe(source,target,module.recipe.rotationQuarterTurns);
    const ids=new Map(source.map((b,i)=>[b.id,mapped[i].id]));
    const actions=representative.actions.map(a=>({...a,brickIds:a.brickIds.map(id=>ids.get(id))}));
    result.push({...module,actions,placementGroups:actions.map(a=>a.brickIds),brickOrder:actions.flatMap(a=>a.brickIds)});
  }
  return result;
}
