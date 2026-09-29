// Placement groups describe the new work itself. Existing geometry underneath
// does not make two distant additions a coherent instruction.
export function facesTouch(a, b) {
  const overlaps = [Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x),
    Math.min(a.y + 1, b.y + 1) - Math.max(a.y, b.y),
    Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z)];
  return overlaps.every(value => value >= 0) && overlaps.filter(value => value === 0).length === 1;
}

export function spatialRegions(bricks) {
  const remaining = new Set(bricks);
  const regions = [];
  while (remaining.size) {
    const region = [remaining.values().next().value];
    remaining.delete(region[0]);
    for (let index = 0; index < region.length; index += 1) {
      for (const brick of remaining) if (facesTouch(region[index], brick)) {
        region.push(brick);
        remaining.delete(brick);
      }
    }
    regions.push(region);
  }
  return regions;
}

export function placementFootprint(bricks) {
  const minX = Math.min(...bricks.map(b => b.x)), minZ = Math.min(...bricks.map(b => b.z));
  const maxX = Math.max(...bricks.map(b => b.x + b.w)), maxZ = Math.max(...bricks.map(b => b.z + b.d));
  const area = bricks.reduce((sum, b) => sum + b.w * b.d, 0);
  return {minX, minZ, maxX, maxZ, width:maxX-minX, depth:maxZ-minZ, fill:area/((maxX-minX)*(maxZ-minZ))};
}

export function createPlacementGroups(bricks) {
  const ordered = [...bricks].sort((a,b) => a.y-b.y || a.z-b.z || a.x-b.x || a.id.localeCompare(b.id));
  const remaining = new Set(ordered);
  const groups = [];
  while (remaining.size) {
    const group = [remaining.values().next().value];
    remaining.delete(group[0]);
    while (group.length < 12) {
      const choices = [...remaining].filter(b => b.y === group[0].y && group.some(a => facesTouch(a,b)))
        .map(brick => ({brick, bounds:placementFootprint([...group,brick])}))
        .filter(({bounds}) => bounds.width <= 12 && bounds.depth <= 12
          && bounds.fill >= (group.length < 4 ? 0.5 : 0.8))
        .sort((a,b) => b.bounds.fill-a.bounds.fill || a.brick.z-b.brick.z || a.brick.x-b.brick.x);
      if (!choices.length) break;
      group.push(choices[0].brick);
      remaining.delete(choices[0].brick);
    }
    if (group.length > 4 && placementFootprint(group).fill < 0.9) {
      let completeEnd = 0;
      for (let end = 1; end < group.length; end += 1) {
        if (placementFootprint(group.slice(0,end)).fill === 1) completeEnd = end;
      }
      if (completeEnd >= Math.ceil(group.length/2)) {
        const tail = new Set(group.splice(completeEnd));
        const pending = ordered.filter(b => remaining.has(b) || tail.has(b));
        remaining.clear();
        for (const b of pending) remaining.add(b);
      }
    }
    groups.push(group.map(b => b.id));
  }
  return groups;
}

// Source batches contain independent placements on one course. When an earlier
// design cannot be safely reordered, split only clean batches into local work;
// preserve unresolved operations and all warning evidence verbatim.
export function groupPlacementOperations(plan) {
  const byId = new Map(plan.bricks.map(b => [b.id,b]));
  const steps = plan.steps.flatMap(step => {
    const bricks = step.newBrickIds.map(id => byId.get(id));
    const marker = step.placementGroupId ?? `${step.moduleId}-placement`;
    if (step.kind !== 'build' || step.issues.length || !bricks.length
      || new Set(bricks.map(b => b.y)).size !== 1) return [{...step,placementGroupId:marker}];
    const groups = createPlacementGroups(bricks);
    if (groups.length === 1) return [{...step,placementGroupId:marker}];
    const newIds = new Set(step.newBrickIds);
    const visible = step.visibleBrickIds.filter(id => !newIds.has(id));
    return groups.map((ids,index) => {
      visible.push(...ids);
      return {...step,id:`${step.id}-placement-${index+1}`,sourceOperationId:step.id,
        placementGroupId:marker,newBrickIds:ids,highlightBrickIds:ids,visibleBrickIds:[...visible]};
    });
  });
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(0,...steps.map(s => s.newBrickIds.length)),
    planReferenceCount:steps.reduce((sum,s) => sum+s.newBrickIds.length+s.visibleBrickIds.length+s.highlightBrickIds.length,0)}};
}
