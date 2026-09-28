import {spatialRegions} from './placement-groups.js';

const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const bounds=bs=>({x:Math.min(...bs.map(b=>b.x)),z:Math.min(...bs.map(b=>b.z)),
  w:Math.max(...bs.map(b=>b.x+b.w))-Math.min(...bs.map(b=>b.x)),
  d:Math.max(...bs.map(b=>b.z+b.d))-Math.min(...bs.map(b=>b.z))});
function components(ids,adjacency) {
  const pending=new Set(ids),groups=[];
  while(pending.size){
    const group=new Set([pending.values().next().value]);
    for(const id of group){pending.delete(id);for(const next of adjacency.get(id))if(pending.has(next))group.add(next);}
    groups.push([...group]);
  }
  return groups;
}

/** Candidate ownership only: local recipes and every final join still need replay. */
export function discoverGroundedComponentRecipes(plan,{maxCandidates=4,maxParts=1000}={}) {
  if(!plan?.bricks?.length||plan.bricks.length>maxParts||maxCandidates<1)return [];
  const by=new Map(plan.bricks.map(b=>[b.id,b]));
  const roots=spatialRegions(plan.bricks.filter(b=>b.y===0));
  if(roots.length<2||roots.length>4)return [];
  const boxes=roots.map(bounds),rootIds=new Set(roots.flatMap(bs=>bs.map(b=>b.id)));
  const adjacency=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b}of plan.graph.edges){adjacency.get(a).push(b);adjacency.get(b).push(a);}
  // An existing handled assembly spanning multiple foundations is the shared
  // receiver, not a fragment to steal while completing either foundation.
  const protectedIds=new Set(plan.modules.filter(m=>m.recipeFamily||m.sharedHandledRecipe||m.mirroredAssembly
    ||m.buildContext&&boxes.filter(box=>m.brickIds.some(id=>overlaps(box,by.get(id)))).length>1).flatMap(m=>m.brickIds));
  if([...rootIds].some(id=>protectedIds.has(id)))return [];
  const groundColors=new Set(roots.flatMap(bs=>bs.map(b=>b.color)));
  if(groundColors.size>2)return [];
  // Material is a bounded discovery hint. Ownership is accepted only after
  // connectedness, complete foundation coverage and insertion closure below.
  const palettes=[groundColors];
  if(groundColors.size===1)for(const color of [...new Set(plan.bricks.map(b=>b.color))].sort()){
    if(!groundColors.has(color))palettes.push(new Set([...groundColors,color]));
    if(palettes.length===12)break;
  }
  const result=[],seen=new Set();
  for(const palette of palettes){
    const selected=plan.bricks.filter(b=>!protectedIds.has(b.id)&&palette.has(b.color));
    const initial=components(selected.map(b=>b.id),adjacency).filter(ids=>ids.some(id=>rootIds.has(id)));
    if(initial.length!==roots.length||initial.some(ids=>ids.length<12||ids.length>96
      ||Math.max(bounds(ids.map(id=>by.get(id))).w,bounds(ids.map(id=>by.get(id))).d)>16
      ||roots.filter(root=>root.some(b=>ids.includes(b.id))).length!==1
      ||roots.some(root=>root.some(b=>ids.includes(b.id))&&!root.every(b=>ids.includes(b.id)))))continue;
    const initialIds=new Set(initial.flat());
    const outside=plan.bricks.filter(b=>!initialIds.has(b.id)&&!protectedIds.has(b.id));
    const captured=new Set();
    for(const brick of outside)for(const id of initialIds)if(by.get(id).y>brick.y&&overlaps(brick,by.get(id)))captured.add(id);
    // Capturing only the first blocker creates a new obstruction above it.
    // Close transitively over the entire insertion column before making a cut.
    for(const id of captured)for(const next of initialIds)if(by.get(next).y>by.get(id).y&&overlaps(by.get(id),by.get(next)))captured.add(next);
    const cores=initial.map(ids=>ids.filter(id=>!captured.has(id)));
    if(cores.some((ids,i)=>ids.length<12||ids.length<initial[i].length/2||!ids.some(id=>rootIds.has(id))
      ||components(ids,adjacency).length!==1))continue;
    const coreIds=new Set(cores.flat()),affected=plan.modules.filter(m=>m.brickIds.some(id=>initialIds.has(id)));
    if(affected.some(m=>m.brickIds.some(id=>protectedIds.has(id))))continue;
    const remainder=affected.flatMap(m=>m.brickIds).filter(id=>!coreIds.has(id));
    const receivers=components(remainder,adjacency).filter(ids=>ids.length>=4&&ids.length<=128
      &&cores.every(core=>ids.some(id=>adjacency.get(id).some(other=>core.includes(other)))));
    if(receivers.length!==1)continue;
    const receiver=receivers[0];
    if([...captured].some(id=>!receiver.includes(id)))continue;
    const key=cores.map(ids=>[...ids].sort().join('|')).sort().join(';')+';'+[...receiver].sort().join('|');
    if(seen.has(key))continue;seen.add(key);
    result.push({cores,receiver,captured:[...captured],affectedModuleIds:affected.map(m=>m.id),
      protectedBrickIds:[...protectedIds],remaining:remainder.filter(id=>!receiver.includes(id))});
    if(result.length>=maxCandidates)break;
  }
  return result;
}
