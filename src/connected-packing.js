import {packingProfile,packingRejectionReasons} from './refine-construction.js';

const footprints=[[2,4],[4,2],[2,3],[3,2],[2,2],[1,4],[4,1],[1,3],[3,1],[1,2],[2,1],[1,1]];
const key=(x,y,z)=>`${x},${y},${z}`;
const signature=b=>`${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cells=b=>Array.from({length:b.w*b.d},(_,i)=>key(b.x+i%b.w,b.y,b.z+Math.floor(i/b.w)));
const order=(a,b)=>a.y-b.y||a.z-b.z||a.x-b.x||a.w-b.w||a.d-b.d||a.color.localeCompare(b.color);

function connectivity(bricks,profile){
  const grounded=new Set(bricks.filter(b=>b.y===0).map(b=>profile.cells.get(key(b.x,b.y,b.z)).component));
  const components=new Map();
  for(const cell of profile.cells.values())components.set(cell.component,(components.get(cell.component)??0)+1);
  return {grounded,components,ungrounded:[...components].reduce((sum,[id,n])=>sum+(grounded.has(id)?0:n),0)};
}

// Choose the bond first. Exact-cover the rest of the intersected bricks; a
// locally attractive tiling is irrelevant if it leaves the components apart.
function tileRemainder(before,bridge){
  const occupied=new Set(before.flatMap(cells));
  for(const c of cells(bridge))occupied.delete(c);
  const floor=bridge.y,color=bridge.color,failed=new Set();let nodes=0;
  function visit(pending,left){
    if(!pending.size)return [];
    if(left<=0||++nodes>512||pending.size>left*8)return null;
    const coords=[...pending].map(k=>k.split(',').map(Number)).sort((a,b)=>a[2]-b[2]||a[0]-b[0]);
    const state=coords.map(c=>c.join(',')).join('|')+':'+left;
    if(failed.has(state))return null;
    const [x,,z]=coords[0];
    for(const [w,d]of footprints){
      const b={x,y:floor,z,w,d,color},covered=cells(b);
      if(!covered.every(c=>pending.has(c)))continue;
      const next=new Set(pending);for(const c of covered)next.delete(c);
      const tail=visit(next,left-1);if(tail)return [b,...tail];
    }
    failed.add(state);return null;
  }
  // A small part-count tradeoff may establish an otherwise absent bond. The
  // integration layer evaluates the completed assembly, not this patch alone.
  const rest=visit(occupied,before.length+1);
  return rest?[bridge,...rest].sort(order):null;
}

export function proposeConnectedPacking(brickModel,{maxChecks=96,maxCandidates=8,region=null,protectedBricks=[],diverseInterfaces=false,workSurfaceFloorY=null}={}){
  if(!Number.isSafeInteger(maxChecks)||maxChecks<0||!Number.isSafeInteger(maxCandidates)||maxCandidates<0)throw new RangeError('Packing limits must be nonnegative integers');
  const bricks=brickModel.bricks,profile=packingProfile(bricks);
  const protectedKeys=new Set(protectedBricks.map(signature));
  const regionKeys=region&&new Set(region.map(signature));
  const targetBricks=regionKeys?bricks.filter(b=>regionKeys.has(signature(b))):bricks;
  if(regionKeys&&targetBricks.length!==regionKeys.size)throw Error('Packing region must contain existing whole bricks');
  const targetProfile=regionKeys?packingProfile(targetBricks):profile,base=connectivity(targetBricks,targetProfile),seams=[];
  if((regionKeys?base.components.size<2:!base.ungrounded)||!maxChecks||!maxCandidates)return {proposals:[],checks:0};
  for(const [k,a]of targetProfile.cells){
    const [x,y,z]=k.split(',').map(Number);
    for(const [dx,dz]of [[1,0],[0,1]]){
      const b=targetProfile.cells.get(key(x+dx,y,z+dz));
      if(!b||a.color!==b.color||a.component===b.component||base.grounded.has(a.component)&&base.grounded.has(b.component))continue;
      seams.push({x,y,z,dx,dz,color:a.color,interface:[a.component,b.component].sort((a,b)=>a-b).join(':'),priority:(base.grounded.has(a.component)?0:base.components.get(a.component))+(base.grounded.has(b.component)?0:base.components.get(b.component)),anchored:base.grounded.has(a.component)||base.grounded.has(b.component)});
    }
  }
  seams.sort((a,b)=>Number(b.anchored)-Number(a.anchored)||b.priority-a.priority||a.y-b.y||a.z-b.z||a.x-b.x);
  const interfaces=new Set(seams.map(s=>s.interface));
  const interfaceLimit=diverseInterfaces?Math.max(4,Math.floor(maxChecks/Math.max(1,interfaces.size))):Infinity,interfaceChecks=new Map();
  const tried=new Set(),proposals=[];let checks=0;
  outer:for(const seam of seams)for(const [w,d]of footprints){
    for(let x=seam.x+seam.dx-w+1;x<=seam.x;x++)for(let z=seam.z+seam.dz-d+1;z<=seam.z;z++){
      const bridge={x,y:seam.y,z,w,d,color:seam.color},id=signature(bridge);
      if(tried.has(id))continue;tried.add(id);
      const covered=cells(bridge);if(!covered.every(c=>targetProfile.cells.get(c)?.color===seam.color))continue;
      const indexes=new Set(covered.map(c=>profile.cells.get(c).index));
      const before=[...indexes].map(i=>bricks[i]);
      if(before.some(b=>protectedKeys.has(signature(b))))continue;
      if(regionKeys&&before.some(b=>!regionKeys.has(signature(b))))continue;
      if(before.length>6||before.reduce((n,b)=>n+b.w*b.d,0)>32)continue;
      if((interfaceChecks.get(seam.interface)??0)>=interfaceLimit)continue;
      interfaceChecks.set(seam.interface,(interfaceChecks.get(seam.interface)??0)+1);
      if(checks++>=maxChecks){checks=maxChecks;break outer;}
      const after=tileRemainder(before,bridge);if(!after)continue;
      const next=[...bricks.filter((_,i)=>!indexes.has(i)),...after].map(({id,...b})=>b).sort(order);
      const nextProfile=packingProfile(next);
      // A table supports a recipe's initial course even where the final model
      // has no brick beneath it. The caller must replay that complete recipe
      // and validate handling, connectedness before lifting and attachment.
      // All other packing guards, especially existing bonds, remain mandatory.
      const onTableFloor=regionKeys&&Number.isSafeInteger(workSurfaceFloorY)
        &&before.every(b=>b.y===workSurfaceFloorY);
      const reasons=packingRejectionReasons(profile,nextProfile).filter(reason=>
        !(onTableFloor&&reason==='Unsupported occupied volume increased'));
      if(reasons.length)continue;
      const targetNext=regionKeys?next.filter(b=>cells(b).every(c=>targetProfile.cells.has(c))):next;
      const connected=connectivity(targetNext,regionKeys?packingProfile(targetNext):nextProfile);
      const gain=regionKeys?Math.max(...connected.components.values())-Math.max(...base.components.values()):base.ungrounded-connected.ungrounded;
      if(regionKeys&&connected.components.size>=base.components.size)continue;
      if(gain<=0)continue;
      proposals.push({interface:seam.interface,bricks:next,before,after,connectedCellCount:gain,beforeUngroundedCells:base.ungrounded,afterUngroundedCells:connected.ungrounded});
    }
  }
  proposals.sort((a,b)=>b.connectedCellCount-a.connectedCellCount||a.bricks.length-b.bricks.length||a.after.map(signature).join('|').localeCompare(b.after.map(signature).join('|')));
  const unique=new Map();for(const p of proposals){const id=p.after.map(signature).join('|');if(!unique.has(id))unique.set(id,p);}
  // A shortlist of four variants of one failed interface prevents trying any
  // other component. Reserve one candidate per interface before extra variants.
  const first=[],rest=[],seenInterfaces=new Set();
  for(const proposal of unique.values()) {
    if(seenInterfaces.has(proposal.interface))rest.push(proposal);
    else {seenInterfaces.add(proposal.interface);first.push(proposal);}
  }
  return {proposals:(diverseInterfaces?[...first,...rest]:[...unique.values()]).slice(0,maxCandidates),checks};
}
