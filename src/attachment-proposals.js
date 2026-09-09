const ORDINARY_FOOTPRINTS = Object.freeze([
  [2, 4], [4, 2], [2, 3], [3, 2], [2, 2], [1, 4], [4, 1],
  [1, 3], [3, 1], [1, 2], [2, 1], [1, 1],
]);

const cellKey = (x, y, z) => `${x},${y},${z}`;
const brickKey = ({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`;
const compareBricks = (a, b) => a.y - b.y || a.z - b.z || a.x - b.x
  || a.w - b.w || a.d - b.d || a.color.localeCompare(b.color);

function cellsOf(brick) {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x += 1) {
    for (let z = brick.z; z < brick.z + brick.d; z += 1) cells.push(cellKey(x, brick.y, z));
  }
  return cells;
}

function unresolvedCells(plan, byId) {
  const unresolved = new Set();
  for (const step of plan.steps) {
    if (step.kind !== 'unresolved') continue;
    const ids = step.newBrickIds?.length ? step.newBrickIds : step.highlightBrickIds ?? [];
    for (const id of ids) {
      const brick = byId.get(id);
      if (brick) for (const key of cellsOf(brick)) unresolved.add(key);
    }
  }
  return unresolved;
}

function boundsOf(bricks) {
  return bricks.reduce((bounds, brick) => ({
    minX: Math.min(bounds.minX, brick.x),
    maxX: Math.max(bounds.maxX, brick.x + brick.w - 1),
    minZ: Math.min(bounds.minZ, brick.z),
    maxZ: Math.max(bounds.maxZ, brick.z + brick.d - 1),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function containingRectangles(brick, bounds) {
  const rectangles = [];
  for (const [w, d] of ORDINARY_FOOTPRINTS) {
    if (w < brick.w || d < brick.d) continue;
    for (let x = brick.x + brick.w - w; x <= brick.x; x += 1) {
      for (let z = brick.z + brick.d - d; z <= brick.z; z += 1) {
        const left = brick.x - x;
        const right = x + w - (brick.x + brick.w);
        const front = brick.z - z;
        const back = z + d - (brick.z + brick.d);
        if (Math.max(left, right, front, back) > 2) continue;
        if (x < bounds.minX || z < bounds.minZ
          || x + w - 1 > bounds.maxX || z + d - 1 > bounds.maxZ) continue;
        rectangles.push({ x, y: brick.y, z, w, d, color: brick.color });
      }
    }
  }
  return rectangles;
}

function validate(result, options) {
  if (!result || !result.brickModel || !Array.isArray(result.brickModel.bricks)) {
    throw new TypeError('result.brickModel.bricks must be an array.');
  }
  const plan = result.assemblyPlan;
  if (!plan || !Array.isArray(plan.bricks) || !Array.isArray(plan.steps)
    || !Array.isArray(plan.graph?.components)) {
    throw new TypeError('result.assemblyPlan is incomplete.');
  }
  if (!Number.isSafeInteger(options.maxAddedCells) || options.maxAddedCells < 0) {
    throw new RangeError('maxAddedCells must be a non-negative safe integer.');
  }
  if (!Number.isSafeInteger(options.maxProposals) || options.maxProposals < 1) {
    throw new RangeError('maxProposals must be a positive safe integer.');
  }
}

function proposalOrder(a, b) {
  return a.addedCells.length - b.addedCells.length
    || b.newlyEngagedTargetCellCount - a.newlyEngagedTargetCellCount
    || a.signature.localeCompare(b.signature);
}

export function proposeAttachmentExtensions(result, { maxAddedCells, maxProposals = 48 } = {}) {
  validate(result, { maxAddedCells, maxProposals });
  const modelBricks = result.brickModel.bricks;
  const plan = result.assemblyPlan;
  const byId = new Map(plan.bricks.map((brick) => [brick.id, brick]));
  const modelIndexByKey = new Map(modelBricks.map((brick, index) => [brickKey(brick), index]));
  const planIdByKey = new Map(plan.bricks.map((brick) => [brickKey(brick), brick.id]));
  const occupancy = new Map();
  modelBricks.forEach((brick, index) => {
    for (const key of cellsOf(brick)) {
      if (occupancy.has(key)) throw new RangeError('brickModel contains overlapping placements.');
      occupancy.set(key, index);
    }
  });

  const unresolved = unresolvedCells(plan, byId);
  const targetIds = new Set();
  for (const step of plan.steps) for (const issue of step.issues ?? []) {
    if (issue.code === 'unsupported-addition') for (const id of issue.brickIds ?? []) targetIds.add(id);
  }
  for (const component of plan.graph.components) {
    if (component.grounded) continue;
    const bricks = component.brickIds.map((id) => byId.get(id)).filter(Boolean);
    if (!bricks.some((brick) => cellsOf(brick).some((key) => unresolved.has(key)))) continue;
    const lowest = Math.min(...bricks.map(({ y }) => y));
    for (const brick of bricks) if (brick.y === lowest) targetIds.add(brick.id);
  }

  const groundedIds = new Set(plan.graph.components.filter(({ grounded }) => grounded)
    .flatMap(({ brickIds }) => brickIds));
  const introducedResolvedIds = new Set(plan.steps.filter(({ kind }) => kind !== 'unresolved')
    .flatMap(({ newBrickIds }) => newBrickIds ?? []));
  const resolvedAnchorIds = new Set([...groundedIds].filter((id) => {
    const brick = byId.get(id);
    return brick && introducedResolvedIds.has(id) && !cellsOf(brick).some((key) => unresolved.has(key));
  }));
  const targetIndexes = new Map();
  for (const id of [...targetIds].sort()) {
    const index = modelIndexByKey.get(brickKey(byId.get(id) ?? {}));
    if (index !== undefined) targetIndexes.set(id, index);
  }
  const bounds = boundsOf(modelBricks);
  const proposals = new Map();
  let rectanglesConsidered = 0;

  function addProposal({ replaceIndex, after, direction, candidateTargetIds, candidateAnchorIds }) {
    rectanglesConsidered += 1;
    const before = modelBricks[replaceIndex];
    const oldCells = new Set(cellsOf(before));
    const addedKeys = cellsOf(after).filter((key) => !oldCells.has(key));
    if (!addedKeys.length || addedKeys.length > maxAddedCells || addedKeys.length > 4) return;
    if (addedKeys.some((key) => occupancy.has(key))) return;

    const engagedTargets = new Set();
    const engagedAnchors = new Set();
    let unsupportedAddedCellCount = 0;
    for (const key of addedKeys) {
      const [x, y, z] = key.split(',').map(Number);
      const adjacentKey = direction === 'covered-lower' ? cellKey(x, y + 1, z) : cellKey(x, y - 1, z);
      const adjacentIndex = occupancy.get(adjacentKey);
      if (adjacentIndex === undefined) {
        if (direction !== 'bridged-upper') return;
        unsupportedAddedCellCount += 1;
        continue;
      }
      const adjacentId = planIdByKey.get(brickKey(modelBricks[adjacentIndex]));
      if (direction === 'covered-lower') {
        if (candidateTargetIds.has(adjacentId)) engagedTargets.add(adjacentId);
      } else {
        if (!resolvedAnchorIds.has(adjacentId)) return;
        engagedAnchors.add(adjacentId);
      }
    }
    if (direction === 'covered-lower') {
      for (const id of candidateAnchorIds) engagedAnchors.add(id);
      if (!engagedTargets.size) return;
    } else {
      for (const id of candidateTargetIds) engagedTargets.add(id);
      if (!engagedAnchors.size) return;
    }
    if (direction === 'bridged-upper' && unsupportedAddedCellCount === 0) return;
    const oppositeIds = direction === 'covered-lower' ? engagedTargets : engagedAnchors;
    const oldOverlap = [...oppositeIds].some((oppositeId) => {
      const target = byId.get(oppositeId);
      return cellsOf(before).some((key) => {
        const [x, y, z] = key.split(',').map(Number);
        return target.y === y + (direction === 'covered-lower' ? 1 : -1)
          && x >= target.x && x < target.x + target.w && z >= target.z && z < target.z + target.d;
      });
    });
    if (oldOverlap) return;

    const cleanAfter = { ...after };
    const cleanBefore = { x: before.x, y: before.y, z: before.z, w: before.w, d: before.d, color: before.color };
    const signature = `${direction}:${brickKey(cleanBefore)}>${brickKey(cleanAfter)}`;
    const addedCells = addedKeys.map((key) => {
      const [x, y, z] = key.split(',').map(Number);
      return { x, y, z, color: before.color };
    }).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x || a.color.localeCompare(b.color));
    const bricks = modelBricks.map((brick, index) => index === replaceIndex ? cleanAfter : {
      x: brick.x, y: brick.y, z: brick.z, w: brick.w, d: brick.d, color: brick.color,
    }).sort(compareBricks);
    const supportedArea = after.y === 0 ? after.w * after.d : cellsOf(after).reduce((sum, key) => {
      const [x, y, z] = key.split(',').map(Number);
      const lowerIndex = occupancy.get(cellKey(x, y - 1, z));
      const lowerId = lowerIndex === undefined ? undefined : planIdByKey.get(brickKey(modelBricks[lowerIndex]));
      return sum + (resolvedAnchorIds.has(lowerId) ? 1 : 0);
    }, 0);
    const supportRatio = supportedArea / (after.w * after.d);
    if (direction === 'bridged-upper' && supportRatio < 0.25) return;
    const value = {
      targetIds: [...engagedTargets].sort(),
      anchorIds: [...engagedAnchors].sort(),
      direction,
      before: [cleanBefore],
      after: [cleanAfter],
      bricks,
      addedCells,
      supportedArea,
      supportRatio,
      newlyEngagedTargetCellCount: direction !== 'covered-lower' ? addedKeys.filter((key) => {
        const [x, y, z] = key.split(',').map(Number);
        const lowerIndex = occupancy.get(cellKey(x, y - 1, z));
        const lowerId = lowerIndex === undefined ? undefined : planIdByKey.get(brickKey(modelBricks[lowerIndex]));
        return resolvedAnchorIds.has(lowerId);
      }).length : engagedTargets.size ? addedKeys.filter((key) => {
          const [x, y, z] = key.split(',').map(Number);
          return [...engagedTargets].some((id) => {
            const target = byId.get(id);
            return target.y === y + 1 && x >= target.x && x < target.x + target.w
              && z >= target.z && z < target.z + target.d;
          });
        }).length : 0,
      signature,
    };
    const existing = proposals.get(signature);
    if (!existing) proposals.set(signature, value);
    else {
      existing.targetIds = [...new Set([...existing.targetIds, ...value.targetIds])].sort();
      existing.anchorIds = [...new Set([...existing.anchorIds, ...value.anchorIds])].sort();
      existing.newlyEngagedTargetCellCount = Math.max(existing.newlyEngagedTargetCellCount, value.newlyEngagedTargetCellCount);
    }
  }

  if (maxAddedCells > 0) for (const [targetId, targetIndex] of targetIndexes) {
    const target = modelBricks[targetIndex];
    if (target.y < 1) continue;
    const nearbyLowerIndexes = new Set();
    for (let x = target.x - 2; x < target.x + target.w + 2; x += 1) {
      for (let z = target.z - 2; z < target.z + target.d + 2; z += 1) {
        const index = occupancy.get(cellKey(x, target.y - 1, z));
        if (index !== undefined) nearbyLowerIndexes.add(index);
      }
    }
    for (const lowerIndex of [...nearbyLowerIndexes].sort((a, b) => a - b)) {
      const lower = modelBricks[lowerIndex];
      const anchorId = planIdByKey.get(brickKey(lower));
      if (!resolvedAnchorIds.has(anchorId)) continue;
      for (const after of containingRectangles(lower, bounds)) addProposal({
        replaceIndex: lowerIndex, after, direction: 'covered-lower',
        candidateTargetIds: targetIds, candidateAnchorIds: new Set([anchorId]),
      });
    }
    for (const after of containingRectangles(target, bounds)) addProposal({
      replaceIndex: targetIndex, after, direction: 'seated-upper',
      candidateTargetIds: new Set([targetId]), candidateAnchorIds: resolvedAnchorIds,
    });
    for (const lowerIndex of [...nearbyLowerIndexes].sort((a, b) => a - b)) {
      const lower = modelBricks[lowerIndex];
      const anchorId = planIdByKey.get(brickKey(lower));
      if (!resolvedAnchorIds.has(anchorId)) continue;
      const corridor = {
        minX: Math.min(target.x, lower.x),
        maxX: Math.max(target.x + target.w - 1, lower.x + lower.w - 1),
        minZ: Math.min(target.z, lower.z),
        maxZ: Math.max(target.z + target.d - 1, lower.z + lower.d - 1),
      };
      for (const after of containingRectangles(target, bounds)) {
        if (after.x < corridor.minX || after.z < corridor.minZ
          || after.x + after.w - 1 > corridor.maxX || after.z + after.d - 1 > corridor.maxZ) continue;
        addProposal({
          replaceIndex: targetIndex, after, direction: 'bridged-upper',
          candidateTargetIds: new Set([targetId]), candidateAnchorIds: new Set([anchorId]),
        });
      }
    }
  }

  const all = [...proposals.values()].sort(proposalOrder);
  const returned = all.slice(0, maxProposals);
  return {
    proposals: returned,
    stats: {
      targetCount: targetIndexes.size,
      resolvedAnchorCount: resolvedAnchorIds.size,
      rectanglesConsidered,
      legalProposalCount: all.length,
      returnedProposalCount: returned.length,
      maxProposals,
      truncated: all.length > returned.length,
      limitations: 'Deterministic geometric attachment proposals only. Bridged upper replacements require nominal support under at least 25% of their total footprint inside the endpoint corridor; this threshold is not a strength claim. Selection, structural guards, balance, and physical buildability are evaluated elsewhere.',
    },
  };
}
