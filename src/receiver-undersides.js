import {createAssemblyPlan} from './assembly.js';
import {recipeReplay,restrictRecipe} from './capture-recipes.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {prepareCompleteRecipeCandidate} from './complete-assembly-recipes.js';
import {assessAssemblyQuality} from './assembly-quality.js';

const geometry=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;

/** Failed lower components whose only external contacts belong to one receiver. */
export function discoverReceiverUndersides(plan){
  const by=new Map(plan.bricks.map(b=>[b.id,b]));
  const owners=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const adjacency=new Map(plan.bricks.map(b=>[b.id,new Set()]));
  for(const {a,b}of plan.graph.edges){adjacency.get(a).add(b);adjacency.get(b).add(a);}
  const pending=new Set(plan.steps.filter(s=>s.kind==='unresolved').flatMap(s=>s.newBrickIds)),groups=new Map();
  while(pending.size){
    const ids=new Set([pending.values().next().value]);
    for(const id of ids){pending.delete(id);for(const next of adjacency.get(id))if(pending.has(next))ids.add(next);}
    if(ids.size<2||ids.size>64||[...ids].some(id=>owners.get(id).kind!=='grounded'||owners.get(id).buildContext))continue;
    const contacts=[...new Set([...ids].flatMap(id=>[...adjacency.get(id)].filter(next=>!ids.has(next))))];
    const receivers=new Set(contacts.map(id=>owners.get(id)));
    if(receivers.size!==1)continue;
    const parent=[...receivers][0];
    if(parent.buildContext?.kind!=='work-surface'||parent.sharedHandledRecipe||parent.recipeFamily||plan.moduleRecipes?.[parent.id]
      ||!plan.steps.some(s=>s.moduleId===parent.id&&s.kind==='join'&&!s.issues.length)
      ||[...ids].some(id=>by.get(id).y>=parent.buildContext.floorY))continue;
    const floor=Math.min(...[...ids].map(id=>by.get(id).y));
    if(floor<=0)continue;
    if(!groups.has(parent.id))groups.set(parent.id,{parent,components:[],floor});
    const proposal=groups.get(parent.id);
    if(proposal.floor===floor)proposal.components.push([...ids]);
  }
  return [...groups.values()].filter(({parent,components})=>parent.brickIds.length+components.flat().length<=256);
}

function reconstruct(before,{parent,components,floor}){
  const old=before.assemblyPlan,by=new Map(old.bricks.map(b=>[b.id,b]));
  const moved=new Set(components.flat()),ids=[...parent.brickIds,...moved];
  const localModel={version:1,kind:'bricks',bricks:ids.map(id=>{const{id:unused,...b}=by.get(id);return {...b,y:b.y-floor};})};
  const local=createAssemblyPlan({brickModel:localModel});
  const localIds=new Map(local.bricks.map(b=>[geometry({...b,y:b.y+floor}),b.id]));
  const map=ids=>ids.map(id=>localIds.get(geometry(by.get(id))));
  const childReplay=[...components.map((ids,index)=>({id:`lower-${index+1}`,label:'Lower section',kind:'grounded',brickIds:map(ids),brickOrder:map(ids)})),
    {id:'receiver',label:'Receiving section',kind:'detail',groupType:'work-surface',brickIds:map(parent.brickIds),brickOrder:map(parent.brickIds),
      buildContext:{kind:'work-surface',floorY:parent.buildContext.floorY-floor,orderPolicy:'course-first'}}];
  const replay=recipeReplay(old,{preservePlacements:true}).map(m=>m.id===parent.id
    ?{...m,brickIds:ids,brickOrder:ids,placementGroups:undefined,actionOrder:false,buildContext:{...m.buildContext,floorY:floor}}
    :restrictRecipe(m,m.brickIds.filter(id=>!moved.has(id)))).filter(m=>m.brickIds.length);
  const plan=createAssemblyPlan({brickModel:before.brickModel,moduleReplay:replay,moduleRecipes:{...old.moduleRecipes,[parent.id]:{moduleReplay:childReplay}},
    integratedBuild:old.integratedBuild??false,allowUnderAttachments:true,allowWorkSurfaceUnderAttachments:true,preferLocalProgress:true,preferLocalFoundations:true});
  if(plan.steps.filter(s=>s.moduleId===parent.id).some(s=>s.issues.length))throw Error('Incomplete receiving assembly or attachment');
  const raw=prepareAssemblyGuide({...before,assemblyPlan:plan},{moduleReplay:replay});
  // After the completed parent attaches, subsequent diagrams legitimately
  // include its newly repaired lower parts. Preserve all other context and
  // task boundaries; do not add these parts to earlier or separate scenes.
  const context=plan=>({...plan,steps:plan.steps.map(s=>s.moduleId!==parent.id&&parent.brickIds.every(id=>s.visibleBrickIds.includes(id))
    ?{...s,visibleBrickIds:[...new Set([...s.visibleBrickIds,...moved])]}:s)});
  const expected={...before,assemblyPlan:context(old),instructionPlan:context(before.instructionPlan)};
  return prepareCompleteRecipeCandidate(expected,raw).candidate;
}

/** Complete a receiver on its lower components before the existing outer join. */
export function completeReceiverUndersides(before){
  if(!before.instructionPlan||before.assemblyError||!before.assemblyPlan?.stats.rootFailureCount
    ||before.brickModel.bricks.length>1000||before.receiverUndersideCompletion?.selected)return before;
  let current=before;const attempts=[],accepted=[];
  for(let round=0;round<2;round++){
    let winner;
    for(const proposal of discoverReceiverUndersides(current.assemblyPlan).slice(0,4)){
      const receipt={parentId:proposal.parent.id,parts:proposal.components.flat().length,components:proposal.components.length};
      try{
        const candidate=reconstruct(current,proposal);
        attempts.push({...receipt,reasons:[]});accepted.push(receipt);winner=candidate;break;
      }catch(error){attempts.push({...receipt,reasons:[error.message]});}
    }
    if(!winner)break;current=winner;
  }
  if(!accepted.length)return attempts.length?{...before,receiverUndersideCompletion:{selected:false,attempts}}:before;
  return {...current,assemblyEvaluation:{...current.assemblyEvaluation,after:assessAssemblyQuality(current.assemblyPlan)},
    receiverUndersideCompletion:{selected:true,attempts,accepted}};
}
