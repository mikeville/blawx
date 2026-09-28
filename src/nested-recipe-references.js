// References identify canonical operations, not presentation diagram IDs.
export const nestedRecipeScopes=step=>step.nestedRecipePath ?? (step.nestedRecipe ? [step.nestedRecipe] : []);

// A parent's first operation may belong to a deeper child. Only its own join
// completes it; an inner attachment must not become the parent's endpoint.
export function refreshNestedRecipeReferences(assemblyPlan, instructionPlan) {
  const scopes=new Map();
  for(const step of assemblyPlan.steps)for(const scope of nestedRecipeScopes(step)) {
    if(!scopes.has(scope.id))scopes.set(scope.id,{firstStepId:step.id});
    if(step.kind==='join'&&step.nestedRecipe?.id===scope.id)scopes.get(scope.id).attachmentStepId=step.id;
  }
  const refresh=plan=>({...plan,steps:plan.steps.map(step=>step.nestedRecipe ? {...step,
    nestedRecipe:{...step.nestedRecipe,...scopes.get(step.nestedRecipe.id)},
    ...(step.nestedRecipePath ? {nestedRecipePath:step.nestedRecipePath.map(scope=>({...scope,...scopes.get(scope.id)}))} : {})} : step)});
  return {assemblyPlan:refresh(assemblyPlan),instructionPlan:refresh(instructionPlan)};
}
