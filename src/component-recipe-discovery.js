import {createAssemblyPlan} from './assembly.js';
import {MAX_ASSEMBLY_RECIPE_BRICKS} from './assembly-recipe-limits.js';
import {planNestedAssemblies} from './nested-assemblies.js';
import {planAssemblyRecipes} from './assembly-recipe-planning.js';
import {planUndersideAssemblies} from './underside-assemblies.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {recipeReplay} from './capture-recipes.js';
import {replayNestedRecipes} from './replay-nested-recipes.js';
import {createBookletPresentation} from './assembly-booklet-presentation.js';

function localSeed(bricks,allowUnderAttachments,preferLocalProgress) {
  if(!Array.isArray(bricks)||!bricks.length||bricks.length>MAX_ASSEMBLY_RECIPE_BRICKS)throw Error(`Component discovery requires 1–${MAX_ASSEMBLY_RECIPE_BRICKS} pieces`);
  const floor=Math.min(...bricks.map(b=>b.y));
  const brickModel={version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>({...b,y:b.y-floor}))};
  const assemblyPlan=createAssemblyPlan({brickModel,integratedBuild:true,allowUnderAttachments,groupUnderAttachments:true,
    preferLocalProgress,preferLocalFoundations:preferLocalProgress});
  return {floor,local:prepareAssemblyGuide({brickModel,assemblyPlan,metrics:{conversionMs:0}})};
}

function capture(local,floor,preservePlacements) {
  if(local.assemblyPlan.stats.unresolvedBrickCount)throw Error('Incomplete internal recipe');
  return {floor,recipe:{moduleReplay:recipeReplay(local.assemblyPlan,{preservePlacements}),
    moduleRecipes:replayNestedRecipes(local.assemblyPlan),groupUnderAttachments:true,
    diagramGroups:local.instructionPlan.steps.filter(step=>step.kind==='build').map(step=>step.newBrickIds)}};
}

/** The shallow strategy remains available at the bounded search's inner limit. */
export function discoverCompleteTableRecipe(bricks,{allowUnderAttachments=true}={}) {
  const {floor,local}=localSeed(bricks,allowUnderAttachments,true);
  return capture(planNestedAssemblies(local),floor,false);
}

/** Discover complete children before replaying the parent in the real scene. */
export function discoverCompleteComponentRecipe(bricks,{allowUnderAttachments=false,preferLocalProgress=false}={}) {
  const seed=localSeed(bricks,allowUnderAttachments,preferLocalProgress);
  // No discovery callback is passed to this local search. Its three rounds
  // therefore cannot recursively re-enter this complete-component strategy.
  let local=planAssemblyRecipes(seed.local);
  for(let round=0;round<2&&local.assemblyPlan.stats.unresolvedBrickCount;round++){
    const next=planUndersideAssemblies(local,{preservePlacements:true,
      discoverRecipe:parts=>discoverCompleteTableRecipe(parts,{allowUnderAttachments:false}).recipe});
    if(!next.undersideAssemblyPlanning?.selected)break;
    local=next;
  }
  return capture(local,seed.floor,true);
}

/** Build courses downward; assemble necessary hanging parts before joining them. */
export function discoverLayeredComponentRecipe(bricks) {
  if(!Array.isArray(bricks)||!bricks.length||bricks.length>MAX_ASSEMBLY_RECIPE_BRICKS)throw Error(`Component discovery requires 1–${MAX_ASSEMBLY_RECIPE_BRICKS} pieces`);
  // One child level and four distinct local searches per parent. The budget is
  // shared across siblings, so an unsuccessful branch cannot multiply the work.
  const memo=new Map();let remaining=4;
  function discover(parts,depth=0) {
    const floor=Math.min(...parts.map(b=>b.y));
    const key=JSON.stringify([depth,parts.map(({id,...b})=>({...b,y:b.y-floor}))]);
    if(memo.has(key)){
      const cached=memo.get(key);if(cached.error)throw cached.error;
      return {...cached.result,floor};
    }
    if(remaining<=0)throw Error('Complete component discovery budget exhausted');
    remaining--;
    try{
      const seed=localSeed(parts,false,false);
      const finish=initial=>{
        let local=initial;
        const limit=Math.min(6,local.assemblyPlan.stats.unresolvedBrickCount);
        for(let round=0;round<limit&&local.assemblyPlan.stats.unresolvedBrickCount;round++){
          const next=planUndersideAssemblies(local,{preservePlacements:true,allowUnderAttachments:false,
            discoverRecipe:child=>{
              const inner=localSeed(child,false,true);
              const complete=planNestedAssemblies(inner.local,{allowUnderAttachments:false});
              const result=capture(complete,inner.floor,true);
              result.recipe.allowUnderAttachments=false;return result.recipe;
            }});
          if(!next.undersideAssemblyPlanning?.selected)break;
          local=next;
        }
        return local;
      };
      const candidates=[finish(planAssemblyRecipes(seed.local,{allowUnderAttachments:false}))];
      if(depth<1&&candidates[0].assemblyPlan.stats.unresolvedBrickCount&&remaining>0){
        const nested=planNestedAssemblies(seed.local,{allowUnderAttachments:false,
          discoverNestedRecipe:child=>discover(child,depth+1).recipe});
        if(nested.nestedAssemblyPlanning?.selected)candidates.push(finish(nested));
      }
      const complete=candidates.filter(local=>!local.assemblyPlan.stats.unresolvedBrickCount);
      complete.sort((a,b)=>createBookletPresentation(a).numbering.diagramCount-createBookletPresentation(b).numbering.diagramCount);
      if(!complete.length)throw Error('Incomplete internal recipe');
      const result=capture(complete[0],seed.floor,true);
      result.recipe.allowUnderAttachments=false;
      memo.set(key,{result});return result;
    }catch(error){memo.set(key,{error});throw error;}
  }
  return discover(bricks);
}
