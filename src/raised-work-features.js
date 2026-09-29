import {createAssemblyPlan} from './assembly.js';
import {chooseInstructionView} from './instruction-visibility.js';
import {placementFootprint,spatialRegions} from './placement-groups.js';
const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const order=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x;
const layers=bricks=>[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b).flatMap(y=>spatialRegions(bricks.filter(b=>b.y===y).sort(order)).map(region=>region.map(b=>b.id)));
// Complete independent work areas above a shared table layout. Side contact
// defines a task boundary only; the assembler still verifies every stud
// placement, and the complete core must be connected before turning over.
export function raisedBranches(plan){
 if(!plan?.bricks?.length||plan.bricks.length>512||plan.stats.unresolvedBrickCount)return[];
 const bricks=plan.bricks,by=new Map(bricks.map(b=>[b.id,b])),attempts=[];
 const cuts=[...new Set(bricks.map(b=>b.y))].sort((a,b)=>a-b).filter(y=>y>0);
 let checks=0;
 for(const cut of cuts){
  const base=bricks.filter(b=>b.y<cut),branches=spatialRegions(bricks.filter(b=>b.y>=cut));
  if(branches.length<2||branches.length>6||branches.some(bs=>bs.length<3||!bs.some(b=>b.y===cut)||new Set(bs.map(b=>b.y)).size<2))continue;
  if(checks++>=4)break;
  branches.sort((a,b)=>Math.max(...a.map(b=>b.y))-Math.max(...b.map(b=>b.y))||a.length-b.length);
  const groups=layers(base),owner=new Map(branches.flatMap((bs,i)=>bs.map(b=>[b.id,i])));
  if(bricks.some(a=>bricks.some(b=>owner.has(a.id)&&owner.has(b.id)&&owner.get(a.id)>owner.get(b.id)&&a.y<b.y&&overlaps(a,b))))continue;
  let visible=groups.flat().map(id=>by.get(id));
  for(const branch of branches){
   const remaining=layers(branch);let i=0;
   while(i<remaining.length){
    let best=remaining[i];let take=1;
    for(let n=2;n<=remaining.length-i;n++){
     const ids=remaining.slice(i,i+n).flat(),bs=ids.map(id=>by.get(id)),shape=placementFootprint(bs),height=Math.max(...bs.map(b=>b.y))-Math.min(...bs.map(b=>b.y))+1;
     if(ids.length>24||height>4||shape.width>16||shape.depth>16)break;
     if(shape.fill<.45||spatialRegions(bs).length!==1||new Set(bs.map(b=>b.color)).size>3
      ||new Set(bs.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`)).size>8)continue;
     const v=chooseInstructionView({visibleBricks:[...visible,...bs],highlightedIds:ids});
     if(v.passes&&!v.truncated){best=ids;take=n;}
    }
    groups.push(best);visible.push(...best.map(id=>by.get(id)));i+=take;
   }
  }
  try{
   const local=createAssemblyPlan({brickModel:{version:1,kind:'bricks',bricks:bricks.map(({id,...b})=>b)},moduleReplay:[{id:'courses',label:'Complete features',kind:'grounded',brickIds:groups.flat(),brickOrder:groups.flat(),actionOrder:true,placementGroups:groups}],integratedBuild:true,allowUnderAttachments:false});
   if(local.stats.unresolvedBrickCount)throw Error('unresolved');
   const featureGroups=groups.filter(ids=>new Set(ids.map(id=>by.get(id).y)).size>1);
   attempts.push({cut,branchParts:branches.map(bs=>bs.length),groups,featureGroups,local});
  }catch(error){attempts.push({cut,error:error.message});}
 }
 return attempts;
}
