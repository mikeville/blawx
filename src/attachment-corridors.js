import { packingProfile, packingRejectionReasons } from './refine-construction.js';

const key = ({x, y, z, w, d, color}) => `${x},${y},${z}:${w}x${d}:${color}`;
const footprints = [[2,4],[4,2],[2,3],[3,2],[2,2],[1,4],[4,1],[1,3],[3,1],[1,2],[2,1],[1,1]];

function tileRemainder(anchor, occupied) {
  const remaining = new Set();
  for (let z = anchor.z; z < anchor.z + anchor.d; z++) for (let x = anchor.x; x < anchor.x + anchor.w; x++) {
    if (!occupied.has(`${x},${z}`)) remaining.add(`${x},${z}`);
  }
  const bricks = [];
  while (remaining.size) {
    const [x, z] = remaining.values().next().value.split(',').map(Number);
    const [w, d] = footprints.find(([w,d]) => {
      for (let dx=0;dx<w;dx++) for(let dz=0;dz<d;dz++) if(!remaining.has(`${x+dx},${z+dz}`)) return false;
      return true;
    });
    bricks.push({x,y:anchor.y,z,w,d,color:anchor.color});
    for(let dx=0;dx<w;dx++) for(let dz=0;dz<d;dz++) remaining.delete(`${x+dx},${z+dz}`);
  }
  return bricks;
}

// Retile one existing support with a narrow ordinary-brick tab beneath a nearby
// detached part. Unlike a side-contact edge, the tab has real overlap with both
// assemblies. Existing occupied cells/colors are preserved and never split into
// disconnected components. The caller still has to prove the assembly sequence.
export function proposeAttachmentCorridors(result, {maxAddedCells = 4, maxProposals = 32} = {}) {
  if (!Number.isSafeInteger(maxAddedCells) || maxAddedCells < 0 || !Number.isSafeInteger(maxProposals) || maxProposals < 1) {
    throw new RangeError('Corridor budgets must be nonnegative cells and positive proposals.');
  }
  const plan = result.assemblyPlan;
  const profile = packingProfile(plan.bricks);
  const grounded = new Set(plan.graph.components.filter(c => c.grounded).flatMap(c => c.brickIds));
  const detached = new Set(plan.graph.components.filter(c => !c.grounded).flatMap(c => c.brickIds));
  const targets = plan.bricks.filter(b => detached.has(b.id));
  const anchors = plan.bricks.filter(b => grounded.has(b.id));
  const candidates = new Map();
  let visits = 0;
  for (const target of targets) for (const anchor of anchors) {
    if (anchor.y !== target.y - 1) continue;
    const xGap = Math.max(anchor.x - (target.x+target.w), target.x - (anchor.x+anchor.w), 0);
    const zGap = Math.max(anchor.z - (target.z+target.d), target.z - (anchor.z+anchor.d), 0);
    if (xGap + zGap > 1) continue;
    for (const [w,d] of footprints) {
      // At most two cells across and four along a connector.
      if (Math.min(w,d) > 2) continue;
      for (let z = target.z-d+1; z < target.z+target.d; z++) for(let x=target.x-w+1;x<target.x+target.w;x++) {
        if (x < 0 || z < 0 || x+w > 64 || z+d > 64) continue;
        const ax=Math.max(0,Math.min(x+w,anchor.x+anchor.w)-Math.max(x,anchor.x));
        const az=Math.max(0,Math.min(z+d,anchor.z+anchor.d)-Math.max(z,anchor.z));
        if (!ax || !az) continue;
        if (++visits > 8_192) return ordered(candidates, maxProposals);
        const stripe = new Set();
        const addedCells=[];
        let blocked=false;
        for(let dx=0;dx<w;dx++) for(let dz=0;dz<d;dz++) {
          const cx=x+dx,cz=z+dz;
          stripe.add(`${cx},${cz}`);
          const existing=profile.cells.get(`${cx},${anchor.y},${cz}`);
          if(existing && plan.bricks[existing.index].id !== anchor.id) blocked=true;
          if(!existing) addedCells.push({x:cx,y:anchor.y,z:cz,color:anchor.color});
        }
        if(blocked || !addedCells.length || addedCells.length>Math.min(4,maxAddedCells)) continue;
        // Confine every addition to covered space between these two parts.
        if(addedCells.some(c=>!profile.cells.has(`${c.x},${c.y+1},${c.z}`))) continue;
        const after=[{x,y:anchor.y,z,w,d,color:anchor.color},...tileRemainder(anchor,stripe)];
        if(after.length>3) continue;
        const signature=`${key(anchor)}>${after.map(key).sort().join('|')}`;
        if(candidates.has(signature)) continue;
        const bricks=[...plan.bricks.filter(b=>b.id!==anchor.id).map(({id,...b})=>b),...after];
        const next=packingProfile(bricks);
        // Addition is intentional; use the exact old-cell/component guard.
        const oldOnly={...next,cells:new Map([...next.cells].filter(([k])=>profile.cells.has(k)))};
        if(packingRejectionReasons(profile,oldOnly).length) continue;
        candidates.set(signature,{before:[anchor],after,bricks,addedCells,signature,
          targetIds:[target.id],targetCourse:target.y,anchorIds:[anchor.id],direction:'covered-corridor'});
      }
    }
  }
  return ordered(candidates,maxProposals);
}

function ordered(candidates, limit) {
  return [...candidates.values()].sort((a,b)=>a.targetCourse-b.targetCourse || a.addedCells.length-b.addedCells.length
    || a.after.length-b.after.length || a.signature.localeCompare(b.signature)).slice(0,limit);
}
