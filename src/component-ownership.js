const protectedModule=m=>['recipeFamily','sharedHandledRecipe','repeatContinuation','mirroredAssembly'].some(k=>m[k]);
export function discoverComponentExpansions(plan,{maxCandidates=4,maxPieces=512}={}){
 if(!plan?.stats.unresolvedBrickCount||plan.bricks.length>1000)return[];
 const by=new Map(plan.bricks.map(b=>[b.id,b])),owner=new Map(plan.modules.flatMap((m,i)=>m.brickIds.map(id=>[id,{m,i}]))),adj=new Map(plan.bricks.map(b=>[b.id,[]]));
 for(const {a,b}of plan.graph.edges){adj.get(a).push(b);adj.get(b).push(a);}
 const failed=new Set(plan.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds));
 const results=[];
 for(const [i,parent]of plan.modules.entries()){
  if(parent.buildContext?.kind!=='work-surface'||protectedModule(parent)||parent.brickIds.length>maxPieces)continue;
  const ids=new Set(parent.brickIds),donors=[];
  // Grow through neighboring upper work only when this core is its entire
  // already-scheduled receiving interface. Unrelated branches remain outside.
  for(let j=i+1;j<plan.modules.length;j++){
   const m=plan.modules[j];if(m.kind!=='grounded'||m.buildContext||protectedModule(m))break;
   if(m.brickIds.some(id=>by.get(id).y<parent.buildContext.floorY)||m.brickIds.length+ids.size>maxPieces)break;
   const connected=new Set();for(const id of m.brickIds)if(adj.get(id).some(id=>ids.has(id)))connected.add(id);
   for(const id of connected)for(const n of adj.get(id))if(owner.get(n).m===m)connected.add(n);
   if(connected.size!==m.brickIds.length)break;
   const previousContacts=m.brickIds.flatMap(id=>adj.get(id).filter(n=>owner.get(n).i<j&&owner.get(n).m!==m));
   if(!previousContacts.length||previousContacts.some(n=>!ids.has(n)))break;
   for(const id of m.brickIds)ids.add(id);donors.push(m.id);
  }
  if(!donors.length||![...ids].some(id=>failed.has(id)))continue;
  // Add failed hanging pieces which contact the new component above and only
  // its earlier receiver below. Full recipe replay must prove both interfaces.
  const remaining=new Set([...failed].filter(id=>!ids.has(id)&&owner.get(id).i<i&&owner.get(id).m.kind==='grounded'&&!owner.get(id).m.buildContext&&!protectedModule(owner.get(id).m)));
  const captured=[];
  while(remaining.size){const group=new Set([remaining.values().next().value]);for(const id of group){remaining.delete(id);for(const n of adj.get(id))if(remaining.has(n))group.add(n);}
   if(group.size>64||ids.size+group.size>maxPieces)continue;
   const contacts=[...group].flatMap(id=>adj.get(id).filter(n=>!group.has(n)).map(n=>({id,n})));
   if(!contacts.some(({id,n})=>ids.has(n)&&by.get(n).y>by.get(id).y)||contacts.some(({id,n})=>!ids.has(n)&&(failed.has(n)||owner.get(n).i>=i||by.get(n).y>=by.get(id).y)))continue;
   for(const id of group)ids.add(id);captured.push([...group]);
  }
  const floor=Math.min(...[...ids].map(id=>by.get(id).y));if(floor<=0)continue;
  results.push({parentId:parent.id,upperModuleIds:donors,captured,brickIds:[...ids],floor,failedParts:[...ids].filter(id=>failed.has(id)).length});
 }
 return results.sort((a,b)=>b.failedParts-a.failedParts||a.brickIds.length-b.brickIds.length).slice(0,maxCandidates);
}
