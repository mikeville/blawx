import {createAssemblyPlan} from './assembly.js';
import {discoverInvertedCore} from './inverted-component-recipes.js';
import {splitWorkingComponents} from './working-component-cuts.js';

/** Explore two connected workpieces and a small deferred closure. */
export function discoverWorkingSections(bricks){
 if(!Array.isArray(bricks)||bricks.length<24||bricks.length>512)return{attempts:[],candidates:[]};
 const floor=Math.min(...bricks.map(b=>b.y)),brickModel={version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>({...b,y:b.y-floor}))};
 const ordinary=createAssemblyPlan({brickModel,integratedBuild:true,allowUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
 const by=new Map(ordinary.bricks.map(b=>[b.id,b])),up=new Map(ordinary.bricks.map(b=>[b.id,[]])),down=new Map(ordinary.bricks.map(b=>[b.id,[]]));
 for(const{a,b}of ordinary.graph.edges){const[lo,hi]=by.get(a).y<by.get(b).y?[a,b]:[b,a];up.get(lo).push(hi);down.get(hi).push(lo);}
 const attempts=[],candidates=[],memo=new Map(),seen=new Set();
 const recipeFor=ids=>{const key=[...ids].sort().join('|');if(!memo.has(key))memo.set(key,discoverInvertedCore(ids.map(id=>by.get(id))).candidate);return memo.get(key);};
 for(const weight of[1,100]){
  const partition=splitWorkingComponents(ordinary,{sameMaterialWeight:weight});if(!partition)continue;
  const signature=partition.groups.map(ids=>[...ids].sort().join('|')).sort().join('/');if(seen.has(signature))continue;seen.add(signature);
  const owner=new Map(partition.groups.flatMap((ids,i)=>ids.map(id=>[id,i])));
  for(const rootIndex of[0,1])for(const direction of['up','down']){
   const row={weight,rootIndex,direction};
   try{
    const childIndex=1-rootIndex,closing=new Set();
    for(const{a,b}of ordinary.graph.edges)if(owner.get(a)!==owner.get(b)){
     const[lo,hi]=by.get(a).y<by.get(b).y?[a,b]:[b,a];
     const blocked=direction==='up'?hi:lo;if(owner.get(blocked)===childIndex)closing.add(blocked);
    }
    const descendants=direction==='up'?up:down;
    for(const id of closing)for(const next of descendants.get(id))if(owner.get(next)===childIndex)closing.add(next);
    const rootIds=partition.groups[rootIndex],childIds=partition.groups[childIndex].filter(id=>!closing.has(id));
    const closeIds=[...closing].sort((a,b)=>by.get(a).y-by.get(b).y||a.localeCompare(b));
    Object.assign(row,{parts:[rootIds.length,childIds.length,closeIds.length]});
    if(!childIds.length||closing.size>Math.min(32,bricks.length*.15))throw Error('Connection closure is too large');
    const root=recipeFor(rootIds),child=recipeFor(childIds);
    if(!root||!child)throw Error('No readable complete working recipe for both sections');
    const recipe={allowUnderAttachments:true,groupUnderAttachments:true,moduleReplay:[
     {id:'root',label:'First section',kind:'grounded',groupType:'table-root',brickIds:rootIds,brickOrder:rootIds,buildContext:{kind:'work-surface',floorY:root.floor}},
     {id:'child',label:'Second section',kind:'detail',groupType:'work-surface',brickIds:childIds,brickOrder:childIds,buildContext:{kind:'work-surface',floorY:child.floor,joinDirection:direction}},
     ...(closeIds.length?[{id:'closing',label:'Finish connection',kind:'grounded',groupType:'supported-additions',brickIds:closeIds,brickOrder:closeIds}]:[])],moduleRecipes:{root:root.recipe,child:child.recipe}};
    const plan=createAssemblyPlan({brickModel,moduleReplay:recipe.moduleReplay,moduleRecipes:recipe.moduleRecipes,nestedRecipeDepth:1,integratedBuild:true,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
    if(plan.stats.unresolvedBrickCount||plan.graph.components.length!==1||plan.steps.some(s=>s.issues.some(i=>i.severity==='error')))throw Error('Sections cannot attach and close');
    Object.assign(row,{unresolved:0,joins:plan.steps.filter(s=>s.kind==='join').length});
    candidates.push({floor,recipe,plan,...row});
   }catch(error){row.error=error.message;}
   attempts.push(row);
  }
 }
 return{attempts,candidates};
}
