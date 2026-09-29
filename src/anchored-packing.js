const footprints = [[2,4],[4,2],[2,3],[3,2],[2,2],[1,4],[4,1],[1,3],[3,1],[1,2],[2,1],[1,1]];
export const packingSignature = b => `${b.x},${b.y},${b.z}:${b.w}x${b.d}:${b.color}`;
const cellKey = (x,y,z) => `${x},${y},${z}`;
const cells = b => Array.from({length:b.w*b.d}, (_,i) => cellKey(b.x+i%b.w,b.y,b.z+Math.floor(i/b.w)));

/** Change seams, not occupied cells, so an upper-supported piece can be placed from above. */
export function proposeAnchoredPacking(model, region, {maxCandidates = 32, maxNodes = 3000} = {}) {
  if (!region.length || maxCandidates <= 0 || maxNodes <= 0) return [];
  const occupied = new Map(model.bricks.flatMap((b,i) => cells(b).map(c => [c,{b,i}])));
  const scope = new Set(region.map(packingSignature));
  const anchored = b => b.y === 0 || cells(b).some(c => {
    const [x,y,z] = c.split(',').map(Number);
    return occupied.has(cellKey(x,y-1,z));
  });
  const floor = Math.min(...region.map(b => b.y));
  const targets = region.filter(b => b.y > floor && !anchored(b));
  const seen = new Set(), results = [];
  const ranked = () => results.sort((a,b) => b.unsupportedRemoved-a.unsupportedRemoved
    || (a.after.length-a.before.length)-(b.after.length-b.before.length));

  for (const target of targets) for (const cell of cells(target)) {
    const [cx,y,cz] = cell.split(',').map(Number);
    for (const [w,d] of footprints) for (let x=cx-w+1;x<=cx;x++) for (let z=cz-d+1;z<=cz;z++) {
      const bridge = {x,y,z,w,d,color:target.color}, id = packingSignature(bridge), covered = cells(bridge);
      if (seen.has(id)) continue;
      seen.add(id);
      if (!anchored(bridge) || !covered.every(c => occupied.get(c)?.b.color === target.color)) continue;
      const touched = [...new Set(covered.map(c => occupied.get(c).i))].map(i => model.bricks[i]);
      if (touched.length > 6 || touched.some(b => !scope.has(packingSignature(b)))
        || touched.reduce((n,b) => n+b.w*b.d,0) > 32) continue;
      const pending = new Set(touched.flatMap(cells));
      for (const c of covered) pending.delete(c);
      let nodes = 0;
      const failed = new Set();
      function tile(remaining,left) {
        if (!remaining.size) return [];
        if (left <= 0 || remaining.size > left*8 || ++nodes > maxNodes) return null;
        const order = [...remaining].sort((a,b) => {
          const [ax,,az] = a.split(',').map(Number), [bx,,bz] = b.split(',').map(Number);
          return az-bz || ax-bx;
        });
        const memo = order.join('|')+':'+left;
        if (failed.has(memo)) return null;
        const [x,y,z] = order[0].split(',').map(Number);
        for (const [w,d] of footprints) {
          const b = {x,y,z,w,d,color:target.color}, covered = cells(b);
          if (!anchored(b) || !covered.every(c => remaining.has(c))) continue;
          const next = new Set(remaining);
          covered.forEach(c => next.delete(c));
          const rest = tile(next,left-1);
          if (rest) return [b,...rest];
        }
        failed.add(memo);
        return null;
      }
      const tail = tile(pending,touched.length+1);
      if (!tail) continue;
      const after = [bridge,...tail], removed = new Set(touched.map(packingSignature));
      results.push({before:touched,after,
        bricks:[...model.bricks.filter(b => !removed.has(packingSignature(b))),...after],
        unsupportedRemoved:touched.filter(b => !anchored(b)).length});
      if (results.length >= maxCandidates) return ranked();
    }
  }
  return ranked();
}
