import {createAssemblyPlan} from './assembly.js';
import {recipeBrickId} from './assembly-recipes.js';
import {discoverInvertedCore} from './inverted-component-recipes.js';
import {placementFootprint} from './placement-groups.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;

/** Include the lower pieces that would otherwise obstruct a deferred upward join. */
export function lowerBranchClosure(bricks,rootIds){
  const by=new Map(bricks.map(b=>[b.id,b])),selected=new Set(rootIds);
  if(!rootIds.length||rootIds.some(id=>!by.has(id)))return [];
  for(const id of selected){
    const root=by.get(id);
    for(const b of bricks)if(b.y<root.y&&overlap(root,b))selected.add(b.id);
  }
  return bricks.filter(b=>selected.has(b.id));
}

/** Choose a complete main workpiece and a small branch from actual failed finish operations. */
export function discoverDeferredBranchRecipe(bricks){
  if(!Array.isArray(bricks)||bricks.length<24||bricks.length>512)return{attempts:[],candidate:null};
  const floor=Math.min(...bricks.map(b=>b.y));
  const normalized=bricks.map(({id,...b})=>{const local={...b,y:b.y-floor};return{...local,id:recipeBrickId(local)};});
  const initial=discoverInvertedCore(normalized,{allowMixedMaterials:true,collectDeferredRoots:true});
  // A usable unsplit workpiece needs no extra build/attach task.
  if(initial.candidate)return{attempts:[],candidate:null};
  const attempts=[],candidates=[],seen=new Set();
  for(const failed of initial.attempts.filter(a=>a.deferredRootIds?.length)){
    const branch=lowerBranchClosure(normalized,failed.deferredRootIds),branchIds=branch.map(b=>b.id);
    const signature=[...branchIds].sort().join('|');if(seen.has(signature))continue;seen.add(signature);
    const row={rootIds:failed.deferredRootIds,branchIds};
    try{
      if(branch.length<2||branch.length>Math.min(24,normalized.length*.2))throw Error('Deferred branch is not a small workpiece');
      const shape=placementFootprint(branch),height=Math.max(...branch.map(b=>b.y))-Math.min(...branch.map(b=>b.y))+1;
      if(shape.width>16||shape.depth>16||height>6)throw Error('Deferred branch is too dispersed');
      const selected=new Set(branchIds),main=normalized.filter(b=>!selected.has(b.id));
      const root=discoverInvertedCore(main,{allowMixedMaterials:true}).candidate;
      if(!root)throw Error('Remaining main section has no readable working recipe');
      const recipe={allowUnderAttachments:true,groupUnderAttachments:true,moduleReplay:[
        {id:'root',label:'Main section',kind:'grounded',groupType:'table-root',brickIds:main.map(b=>b.id),brickOrder:main.map(b=>b.id),buildContext:{kind:'work-surface',floorY:root.floor}},
        {id:'branch',label:'Lower branch',kind:'detail',groupType:'work-surface',brickIds:branchIds,brickOrder:branchIds,buildContext:{kind:'work-surface',floorY:Math.min(...branch.map(b=>b.y)),joinDirection:'up'}},
      ],moduleRecipes:{root:root.recipe}};
      const plan=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:normalized},moduleReplay:recipe.moduleReplay,moduleRecipes:recipe.moduleRecipes,nestedRecipeDepth:1,integratedBuild:true,
        allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,groupUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
      if(plan.stats.unresolvedBrickCount||plan.graph.components.length!==1||plan.steps.some(s=>s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning')))
        throw Error('Working sections cannot be built and attached');
      const join=plan.steps.find(s=>s.moduleId==='branch'&&s.kind==='join');
      if(!join||join.insertionDirection!=='up'||join.issues.length)throw Error('Deferred branch has no valid upward attachment');
      Object.assign(row,{coreParts:root.coreParts,finishParts:root.finishParts,coreDiagrams:root.coreDiagrams});
      candidates.push({floor,recipe,plan,...row});
    }catch(error){row.error=error.message;}
    attempts.push(row);
  }
  candidates.sort((a,b)=>a.coreDiagrams+a.finishParts+a.branchIds.length-(b.coreDiagrams+b.finishParts+b.branchIds.length));
  return{attempts,candidate:candidates[0]??null};
}
