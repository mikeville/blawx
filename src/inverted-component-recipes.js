import{createAssemblyPlan}from'./assembly.js';
import{recipeBrickId}from'./assembly-recipes.js';
import{recipeReplay}from'./capture-recipes.js';
import{placementFootprint,spatialRegions}from'./placement-groups.js';
import{chooseInstructionView}from'./instruction-visibility.js';
import{raisedBranches}from'./raised-work-features.js';
import{readableMaterialRichCourse}from'./material-rich-courses.js';

// Choose a working orientation from the occupied geometry: choose a broad table course, finish its connected
// underside as complete layers, turn it over, then add deferred details.
export function discoverInvertedCore(bricks,{maxChecks=4,allowMixedMaterials=false,collectDeferredRoots=false}={}){
 if(!Number.isSafeInteger(maxChecks)||maxChecks<0||maxChecks>4)throw new RangeError('Inverted discovery allows zero to four table-course checks.');
 if(!Array.isArray(bricks)||bricks.length<12||bricks.length>512)return{attempts:[],candidate:null};
 const floor=Math.min(...bricks.map(b=>b.y)),bs=bricks.map(({id,...b})=>{const shifted={...b,y:b.y-floor};return{...shifted,id:recipeBrickId(shifted)};});
 const courses=[...new Set(bs.map(b=>b.y))].filter(y=>y>=2).map(y=>({y,area:bs.filter(b=>b.y===y).reduce((n,b)=>n+b.w*b.d,0)})).sort((a,b)=>b.area-a.area||b.y-a.y),attempts=[],candidates=[];
 for(const {y:ceiling,area}of courses.slice(0,maxChecks)){
  const report={ceiling,area};try{
   let core=bs.filter(b=>b.y<=ceiling),removed=[];let local,model,groups;
   for(let pass=0;pass<4;pass++){
    const flipped=core.map(({id,...b})=>({...b,y:ceiling-b.y,z:-b.z-b.d}));model={version:1,kind:'bricks',bricks:flipped};
    groups=[...new Set(flipped.map(b=>b.y))].sort((a,b)=>a-b).flatMap(y=>spatialRegions(flipped.filter(b=>b.y===y).sort((a,b)=>a.z-b.z||a.x-b.x)).map(region=>region.map(recipeBrickId)));
    const replay=[{id:'courses',label:'Complete layers',kind:'grounded',brickIds:groups.flat(),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups}];
    local=createAssemblyPlan({brickModel:model,integratedBuild:true,allowUnderAttachments:false,preferLocalProgress:false});
    if(!local.stats.unresolvedBrickCount){local=createAssemblyPlan({brickModel:model,moduleReplay:replay,integratedBuild:true,allowUnderAttachments:false});break;}
    const roots=new Set(local.steps.flatMap(s=>s.issues.filter(i=>i.code==='unsupported-addition').map(i=>i.brickIds[0]))),defer=new Set(local.bricks.filter(b=>roots.has(b.id)).map(b=>recipeBrickId({...b,y:ceiling-b.y,z:-b.z-b.d})));
    if(!defer.size||core.length-defer.size<bs.length*.6)throw Error('No bounded connected core');
    removed.push(...defer);core=core.filter(b=>!defer.has(b.id));
   }
   if(local.stats.unresolvedBrickCount||local.graph.components.length!==1)throw Error('Core cannot be completed and turned over');
   const feature=raisedBranches(local).filter(candidate=>candidate.groups&&candidate.groups.length<groups.length)
    .sort((a,b)=>a.groups.length-b.groups.length||a.cut-b.cut)[0];
   if(feature){local=feature.local;groups=feature.groups;}
   const coreIds=core.map(b=>b.id),selected=new Set(coreIds),rest=bs.filter(b=>!selected.has(b.id)).sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x).map(b=>b.id),orders=recipeReplay(local,{preservePlacements:true}).map(m=>({...m,actionOrder:true,brickOrder:local.steps.filter(s=>s.moduleId===m.id).flatMap(s=>s.newBrickIds),placementGroups:local.steps.filter(s=>s.moduleId===m.id).map(s=>s.newBrickIds)}));
   const recipe={allowUnderAttachments:false,moduleReplay:[{id:'core',label:'Build upside down',kind:'grounded',groupType:'table-root',brickIds:coreIds,brickOrder:coreIds,buildContext:{kind:'work-surface',floorY:Math.min(...core.map(b=>b.y))}},...(rest.length?[{id:'finish',label:'Turn over and finish',kind:'grounded',groupType:'continuation',brickIds:rest,brickOrder:rest}]:[])],moduleRecipes:{core:{orientation:'inverted',allowUnderAttachments:false,moduleReplay:orders,diagramGroups:groups}}};
   if(feature)recipe.moduleRecipes.core.featureDiagramGroups=feature.featureGroups;
   const plan=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:bs},moduleReplay:recipe.moduleReplay,moduleRecipes:recipe.moduleRecipes,nestedRecipeDepth:1,integratedBuild:true,allowUnderAttachments:false,allowWorkSurfaceUnderAttachments:false,preferLocalProgress:true,preferLocalFoundations:true});
   if(plan.stats.unresolvedBrickCount||plan.graph.components.length!==1){
    if(collectDeferredRoots)report.deferredRootIds=[...new Set(plan.steps.filter(s=>s.moduleId==='finish'&&s.kind==='unresolved').flatMap(s=>s.newBrickIds))];
    throw Error('Upright finish is incomplete');
   }
   Object.assign(report,{coreParts:core.length,finishParts:rest.length,coreDiagrams:groups.length,deferredRoots:removed.length});
   const localBy=new Map(local.bricks.map(b=>[b.id,b]));let visible=[];
   for(const ids of groups){visible.push(...ids);const v=chooseInstructionView({visibleBricks:visible.map(id=>localBy.get(id)),highlightedIds:ids});const layer=ids.map(id=>localBy.get(id)),shape=placementFootprint(layer),types=new Set(layer.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`));if(!v.passes||v.truncated||ids.length>80||shape.width>24||shape.depth>24||shape.fill<.45||new Set(layer.map(b=>b.color)).size>3&&!(allowMixedMaterials&&readableMaterialRichCourse(layer))||types.size>8)throw Error('A complete layer is not readable: '+JSON.stringify({parts:ids.length,passes:v.passes,truncated:v.truncated}));}
   if(allowMixedMaterials)recipe.moduleRecipes.core.allowMixedMaterialCourses=true;
   Object.assign(report,{coreParts:core.length,finishParts:rest.length,coreDiagrams:groups.length,deferredRoots:removed.length,unresolved:0});candidates.push({floor,recipe,plan,...report});
  }catch(error){report.error=error.message;}attempts.push(report);
 }
 candidates.sort((a,b)=>a.coreDiagrams+a.finishParts-(b.coreDiagrams+b.finishParts));return{attempts,candidate:candidates[0]??null};
}
