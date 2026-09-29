import {planNestedAssemblies} from './nested-assemblies.js';
import {planUndersideAssemblies} from './underside-assemblies.js';
import {planReceiverBands} from './receiver-band-assemblies.js';

// Optional bounded exploration. Completing a receiver can expose a valid join
// for another component, so discovery resumes after each accepted recipe.
export function planAssemblyRecipes(before,options={}) {
  let current=before;
  const stages=[],evaluated=new Map();
  for(let round=0;round<3;round++){
    const initial=current;
    for(const [plan,key]of [[planNestedAssemblies,'nestedAssemblyPlanning'],[planReceiverBands,'receiverBandPlanning'],[planUndersideAssemblies,'undersideAssemblyPlanning']]){
      if(evaluated.get(plan)===current.assemblyPlan)continue;
      evaluated.set(plan,current.assemblyPlan);
      const next=plan(current,options);
      if(next===current||!next[key]?.selected)continue;
      stages.push({round,kind:key,moduleId:next[key].moduleId,
        beforeUnresolved:current.assemblyPlan.stats.unresolvedBrickCount,afterUnresolved:next.assemblyPlan.stats.unresolvedBrickCount});
      current=next;
    }
    if(current===initial)break;
  }
  return current===before?before:{...current,assemblyRecipePlanning:{selected:true,stages}};
}
