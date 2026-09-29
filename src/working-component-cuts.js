function components(ids,edges){
 const allowed=new Set(ids),adj=new Map(ids.map(id=>[id,[]]));for(const{a,b}of edges)if(allowed.has(a)&&allowed.has(b)){adj.get(a).push(b);adj.get(b).push(a);}
 const pending=new Set(ids),groups=[];while(pending.size){const group=new Set([pending.values().next().value]);for(const id of group){pending.delete(id);for(const next of adj.get(id))if(pending.has(next))group.add(next);}groups.push([...group]);}return groups;
}
// Split the final contact graph at its weakest interface while keeping each
// already bonded working section whole. Candidate ownership, not a validity waiver.
export function splitWorkingComponents(plan,{sameMaterialWeight=1}={}){
 const state=plan.steps.find(s=>s.insertionDirection==='up'&&components(s.visibleBrickIds,plan.graph.edges).length===2);
 if(!state)return null;
 const seeds=components(state.visibleBrickIds,plan.graph.edges).sort((a,b)=>b.length-a.length);
 if(seeds.some(g=>g.length<8))return null;
 const ids=plan.bricks.map(b=>b.id),index=new Map(ids.map((id,i)=>[id,i])),n=ids.length,S=n,T=n+1,N=n+2;
 const residual=Array.from({length:N},()=>new Float64Array(N)),adj=Array.from({length:N},()=>new Set());
 function edge(a,b,capacity){residual[a][b]+=capacity;adj[a].add(b);adj[b].add(a);}
 const by=new Map(plan.bricks.map(b=>[b.id,b])),capacity=e=>e.studs*(by.get(e.a).color===by.get(e.b).color?sameMaterialWeight:1);
 const infinity=1+plan.graph.edges.reduce((n,e)=>n+capacity(e),0);
 for(const e of plan.graph.edges){edge(index.get(e.a),index.get(e.b),capacity(e));edge(index.get(e.b),index.get(e.a),capacity(e));}
 for(const id of seeds[0])edge(S,index.get(id),infinity);for(const id of seeds[1])edge(index.get(id),T,infinity);
 let flow=0;
 while(true){const parent=new Int32Array(N).fill(-1),queue=[S];parent[S]=S;for(const a of queue){for(const b of adj[a])if(parent[b]===-1&&residual[a][b]>0){parent[b]=a;queue.push(b);}if(parent[T]!==-1)break;}if(parent[T]===-1)break;let amount=Infinity;for(let b=T;b!==S;b=parent[b])amount=Math.min(amount,residual[parent[b]][b]);for(let b=T;b!==S;b=parent[b]){residual[parent[b]][b]-=amount;residual[b][parent[b]]+=amount;}flow+=amount;}
 const reachable=new Set([S]);for(const a of reachable)for(const b of adj[a])if(residual[a][b]>0)reachable.add(b);
 const groups=[ids.filter(id=>reachable.has(index.get(id))),ids.filter(id=>!reachable.has(index.get(id)))];
 if(groups.some(g=>components(g,plan.graph.edges).length!==1))return null;
 return {groups,seedSizes:seeds.map(g=>g.length),weightedCut:flow,sameMaterialWeight,cutStuds:plan.graph.edges.filter(e=>reachable.has(index.get(e.a))!==reachable.has(index.get(e.b))).reduce((n,e)=>n+e.studs,0),stateId:state.id};
}
