import {proposeConnectedPacking} from './connected-packing.js';
import {recipeWorkingFrame} from './recipe-working-frame.js';
import {recipeBrickId} from './assembly-recipes.js';
export function workingFrameProposals(before,parent,floating){
 const plan=before.assemblyPlan,by=new Map(plan.bricks.map(b=>[b.id,b])),root=plan.moduleRecipes?.[parent.id],frames=[];
 if(!root)return [];
 function visit(recipe,parts,floor){
  const frame=recipeWorkingFrame(recipe,parts,floor);
  if(frame.inverted){frames.push({frame,parts});return;}
  const local=new Map(parts.map(b=>[recipeBrickId(frame.toLocal(b)),b]));
  for(const child of recipe.moduleReplay){const nested=recipe.moduleRecipes?.[child.id];if(nested)visit(nested,child.brickIds.map(id=>local.get(id)),floor+(child.buildContext?.floorY??0));}
 }
 visit(root,parent.brickIds.map(id=>by.get(id)),parent.buildContext.floorY);
 const proposals=[];
 for(const{frame,parts}of frames.slice(0,4)){
  const region=[...parts,...[...floating].map(id=>by.get(id))];
  const model={...before.brickModel,bricks:before.brickModel.bricks.map(frame.toLocal)};
  const found=proposeConnectedPacking(model,{region:region.map(frame.toLocal),maxChecks:256,maxCandidates:8,diverseInterfaces:true});
  proposals.push(...found.proposals.map(p=>({...p,bricks:p.bricks.map(frame.fromLocal),before:p.before.map(frame.fromLocal),after:p.after.map(frame.fromLocal)})));
 }
 return proposals.slice(0,8);
}
