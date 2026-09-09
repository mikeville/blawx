const FOOTPRINTS = Object.freeze([
  [2, 4], [4, 2], [2, 2], [2, 3], [3, 2], [1, 4], [4, 1],
  [1, 3], [3, 1], [1, 2], [2, 1], [1, 1],
]);
const MAX_PATCH_VISITS = 256;
const MAX_SEARCH_NODES = 20_000;
const MAX_TILINGS_PER_REGION = 24;
const MAX_ADDITION_COMBINATIONS = 4_096;

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
  const cells = new Set();
  for (const step of plan.steps) {
    if (step.kind !== 'unresolved') continue;
    const ids = step.newBrickIds?.length ? step.newBrickIds : step.highlightBrickIds ?? [];
    for (const id of ids) {
      const brick = byId.get(id);
      if (brick) for (const key of cellsOf(brick)) cells.add(key);
    }
  }
  return cells;
}

function validate(result, options) {
  if (!result?.brickModel || !Array.isArray(result.brickModel.bricks)) {
    throw new TypeError('result.brickModel.bricks must be an array.');
  }
  if (!result.assemblyPlan || !Array.isArray(result.assemblyPlan.bricks)
    || !Array.isArray(result.assemblyPlan.steps) || !Array.isArray(result.assemblyPlan.graph?.components)) {
    throw new TypeError('result.assemblyPlan is incomplete.');
  }
  for (const [name, value, minimum] of [
    ['maxAddedCells', options.maxAddedCells, 0],
    ['maxProposals', options.maxProposals, 1],
    ['maxAdditionalParts', options.maxAdditionalParts, 0],
  ]) if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a ${minimum ? 'positive' : 'non-negative'} safe integer.`);
  }
}

function boundsOf(bricks) {
  return bricks.reduce((bounds, brick) => ({
    minX: Math.min(bounds.minX, brick.x), maxX: Math.max(bounds.maxX, brick.x + brick.w - 1),
    minZ: Math.min(bounds.minZ, brick.z), maxZ: Math.max(bounds.maxZ, brick.z + brick.d - 1),
  }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
}

function faceAdjacent(a, b) {
  if (a.y !== b.y) return false;
  const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
  const zOverlap = a.z < b.z + b.d && b.z < a.z + a.d;
  return xOverlap && (a.z + a.d === b.z || b.z + b.d === a.z)
    || zOverlap && (a.x + a.w === b.x || b.x + b.w === a.x);
}

function patchWithinLimits(bricks) {
  const cells = bricks.flatMap(cellsOf);
  if (cells.length > 24) return false;
  const xs = bricks.flatMap(({ x, w }) => [x, x + w - 1]);
  const zs = bricks.flatMap(({ z, d }) => [z, z + d - 1]);
  return Math.max(...xs) - Math.min(...xs) + 1 <= 6 && Math.max(...zs) - Math.min(...zs) + 1 <= 6;
}

function iconicCount(bricks) {
  return bricks.filter(({ w, d }) => {
    const short = Math.min(w, d);
    const long = Math.max(w, d);
    return short === 2 && (long === 2 || long === 4);
  }).length;
}

function tileRegion({ region, y, color, maxParts, anchorCells, addedKeys, state }) {
  const results = [];
  const remaining = new Set(region);
  const placed = [];
  const visit = () => {
    if (results.length >= MAX_TILINGS_PER_REGION || state.searchNodes >= MAX_SEARCH_NODES) return;
    state.searchNodes += 1;
    if (!remaining.size) {
      if (placed.some((brick) => {
        const keys = cellsOf(brick);
        return keys.some((key) => anchorCells.has(key)) && keys.some((key) => addedKeys.has(key));
      })) results.push(placed.map((brick) => ({ ...brick })));
      return;
    }
    if (placed.length >= maxParts) return;
    const first = [...remaining].sort()[0];
    const [firstX, , firstZ] = first.split(',').map(Number);
    for (const [w, d] of FOOTPRINTS) {
      for (let x = firstX + 1 - w; x <= firstX; x += 1) {
        for (let z = firstZ + 1 - d; z <= firstZ; z += 1) {
          const brick = { x, y, z, w, d, color };
          const keys = cellsOf(brick);
          if (!keys.includes(first) || keys.some((key) => !remaining.has(key))) continue;
          for (const key of keys) remaining.delete(key);
          placed.push(brick);
          visit();
          placed.pop();
          for (const key of keys) remaining.add(key);
          if (results.length >= MAX_TILINGS_PER_REGION || state.searchNodes >= MAX_SEARCH_NODES) return;
        }
      }
    }
  };
  visit();
  return results;
}

function proposalOrder(a, b) {
  const benefitRatio = b.estimatedResolvedCellCount * a.addedCells.length
    - a.estimatedResolvedCellCount * b.addedCells.length;
  return benefitRatio
    || a.addedCells.length - b.addedCells.length
    || a.additionalPartCount - b.additionalPartCount
    || b.iconicBrickGain - a.iconicBrickGain
    || a.changedBrickCount - b.changedBrickCount
    || a.signature.localeCompare(b.signature);
}

function changedPlacements(before, after) {
  const beforeByKey = new Map(before.map((brick) => [brickKey(brick), brick]));
  const afterByKey = new Map(after.map((brick) => [brickKey(brick), brick]));
  return {
    before: before.filter((brick) => !afterByKey.has(brickKey(brick))).sort(compareBricks),
    after: after.filter((brick) => !beforeByKey.has(brickKey(brick))).sort(compareBricks),
  };
}

export function proposeAttachmentPatches(result, {
  maxAddedCells,
  maxProposals = 24,
  maxAdditionalParts = 0,
} = {}) {
  validate(result, { maxAddedCells, maxProposals, maxAdditionalParts });
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
  const componentByBrickId = new Map(plan.graph.components.flatMap((component) =>
    component.brickIds.map((id) => [id, component])));
  const targetIds = new Set();
  for (const step of plan.steps) for (const issue of step.issues ?? []) {
    if (issue.code === 'unsupported-addition') for (const id of issue.brickIds ?? []) targetIds.add(id);
  }
  for (const component of plan.graph.components) {
    if (component.grounded) continue;
    const bricks = component.brickIds.map((id) => byId.get(id)).filter(Boolean);
    if (!bricks.some((brick) => cellsOf(brick).some((key) => unresolved.has(key)))) continue;
    const minY = Math.min(...bricks.map(({ y }) => y));
    for (const brick of bricks) if (brick.y === minY) targetIds.add(brick.id);
  }
  const groundedIds = new Set(plan.graph.components.filter(({ grounded }) => grounded).flatMap(({ brickIds }) => brickIds));
  const introduced = new Set(plan.steps.filter(({ kind }) => kind !== 'unresolved')
    .flatMap(({ newBrickIds }) => newBrickIds ?? []));
  const resolvedAnchorIds = new Set([...groundedIds].filter((id) => {
    const brick = byId.get(id);
    return brick && introduced.has(id) && !cellsOf(brick).some((key) => unresolved.has(key));
  }));
  const bounds = boundsOf(modelBricks);
  const sameCourseNeighbors = modelBricks.map((brick, index) => modelBricks
    .map((candidate, candidateIndex) => ({ candidate, candidateIndex }))
    .filter(({ candidate, candidateIndex }) => candidateIndex !== index && candidate.color === brick.color
      && faceAdjacent(brick, candidate)).map(({ candidateIndex }) => candidateIndex));
  const state = {
    patchVisits: 0,
    searchNodes: 0,
    additionCombinationCount: 0,
    additionCombinationLimitReached: false,
  };
  const proposals = new Map();

  function patchesFrom(anchorIndex, minSize, maxSize) {
    const found = new Map();
    const extend = (indexes) => {
      if (state.patchVisits >= MAX_PATCH_VISITS) return;
      const sorted = [...indexes].sort((a, b) => a - b);
      const key = sorted.join(',');
      const bricks = sorted.map((index) => modelBricks[index]);
      if (sorted.length >= minSize) {
        state.patchVisits += 1;
        if (!found.has(key) && patchWithinLimits(bricks)) found.set(key, sorted);
      }
      if (sorted.length >= maxSize) return;
      const next = new Set(sorted.flatMap((index) => sameCourseNeighbors[index]));
      for (const index of [...next].sort((a, b) => a - b)) if (!indexes.has(index)) {
        extend(new Set([...indexes, index]));
        if (state.patchVisits >= MAX_PATCH_VISITS) return;
      }
    };
    extend(new Set([anchorIndex]));
    return [...found.values()];
  }

  const targetEntries = [...targetIds].map((targetId) => {
    const target = byId.get(targetId);
    const targetComponent = componentByBrickId.get(targetId);
    const estimatedResolvedCellCount = new Set((targetComponent?.brickIds ?? [targetId])
      .flatMap((id) => cellsOf(byId.get(id) ?? {})).filter((key) => unresolved.has(key))).size;
    return { targetId, target, targetComponent, estimatedResolvedCellCount };
  }).filter(({ target }) => target).sort((a, b) => b.estimatedResolvedCellCount - a.estimatedResolvedCellCount
    || a.targetId.localeCompare(b.targetId));

  const searchPasses = [[1, 1], [2, 3]];
  if (maxAddedCells > 0) for (const [minPatchSize, maxPatchSize] of searchPasses) {
    for (const { targetId, target, targetComponent, estimatedResolvedCellCount } of targetEntries) {
      if (state.patchVisits >= MAX_PATCH_VISITS || state.searchNodes >= MAX_SEARCH_NODES
        || state.additionCombinationLimitReached) break;
      const targetIndex = modelIndexByKey.get(brickKey(target));
      if (targetIndex === undefined || target.y < 1) continue;
      const componentTargets = (targetComponent?.brickIds ?? [targetId]).map((id) => byId.get(id))
        .filter((brick) => brick?.y === target.y && targetIds.has(brick.id));
      const lowerIndexes = new Set();
      for (let x = target.x - 1; x < target.x + target.w + 1; x += 1) {
        for (let z = target.z - 1; z < target.z + target.d + 1; z += 1) {
          const index = occupancy.get(cellKey(x, target.y - 1, z));
          if (index !== undefined) lowerIndexes.add(index);
        }
      }
      for (const anchorIndex of [...lowerIndexes].sort((a, b) => a - b)) {
      if (state.additionCombinationLimitReached) break;
      const anchor = modelBricks[anchorIndex];
      const anchorId = planIdByKey.get(brickKey(anchor));
      if (!resolvedAnchorIds.has(anchorId)) continue;
      const oldTargetOverlap = cellsOf(anchor).some((key) => {
        const [x, y, z] = key.split(',').map(Number);
        return target.y === y + 1 && x >= target.x && x < target.x + target.w
          && z >= target.z && z < target.z + target.d;
      });
      if (oldTargetOverlap) continue;
      for (const patchIndexes of patchesFrom(anchorIndex, minPatchSize, maxPatchSize)) {
        if (state.searchNodes >= MAX_SEARCH_NODES || state.additionCombinationLimitReached) break;
        const before = patchIndexes.map((index) => modelBricks[index]).sort(compareBricks);
        const patchCells = new Set(before.flatMap(cellsOf));
        const anchorCells = new Set(cellsOf(anchor));
        const patchXs = before.flatMap(({ x, w }) => [x, x + w - 1]);
        const patchZs = before.flatMap(({ z, d }) => [z, z + d - 1]);
        const corridor = {
          minX: Math.min(Math.min(...patchXs), target.x),
          maxX: Math.max(Math.max(...patchXs), target.x + target.w - 1),
          minZ: Math.min(Math.min(...patchZs), target.z),
          maxZ: Math.max(Math.max(...patchZs), target.z + target.d - 1),
        };
        const available = [];
        for (let x = corridor.minX; x <= corridor.maxX; x += 1) for (let z = corridor.minZ; z <= corridor.maxZ; z += 1) {
          const key = cellKey(x, target.y - 1, z);
          if (occupancy.has(key) || x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) continue;
          const adjacent = [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
            .some(([nearX, nearZ]) => patchCells.has(cellKey(nearX, target.y - 1, nearZ)));
          if (adjacent) available.push(key);
        }
        available.sort();
        const coveredCandidates = new Set(available.filter((key) => {
          const [x, , z] = key.split(',').map(Number);
          return componentTargets.some((componentTarget) => x >= componentTarget.x
            && x < componentTarget.x + componentTarget.w && z >= componentTarget.z
            && z < componentTarget.z + componentTarget.d);
        }));
        const candidateKeys = available.filter((key) => {
          if (coveredCandidates.has(key)) return true;
          const [x, y, z] = key.split(',').map(Number);
          return [[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
            .some(([nearX, nearZ]) => coveredCandidates.has(cellKey(nearX, y, nearZ)));
        });
        const additions = [];
        const choose = (start, selected) => {
          if (state.additionCombinationCount >= MAX_ADDITION_COMBINATIONS) {
            state.additionCombinationLimitReached = true;
            return;
          }
          if (selected.length) {
            state.additionCombinationCount += 1;
            additions.push([...selected]);
          }
          if (selected.length >= Math.min(4, maxAddedCells)) return;
          for (let index = start; index < candidateKeys.length; index += 1) {
            selected.push(candidateKeys[index]);
            choose(index + 1, selected);
            selected.pop();
            if (state.additionCombinationLimitReached) return;
          }
        };
        choose(0, []);
        for (const addition of additions) {
          if (addition.length > maxAddedCells || state.searchNodes >= MAX_SEARCH_NODES) continue;
          const coveredKeys = addition.filter((key) => {
            const [x, , z] = key.split(',').map(Number);
            return componentTargets.some((componentTarget) => x >= componentTarget.x
              && x < componentTarget.x + componentTarget.w && z >= componentTarget.z
              && z < componentTarget.z + componentTarget.d);
          });
          if (coveredKeys.length < addition.length - 1) continue;
          const coveredSet = new Set(coveredKeys);
          if (addition.some((key) => !coveredSet.has(key) && (() => {
            const [x, y, z] = key.split(',').map(Number);
            return ![[x - 1, z], [x + 1, z], [x, z - 1], [x, z + 1]]
              .some(([nearX, nearZ]) => coveredSet.has(cellKey(nearX, y, nearZ)));
          })())) continue;
          const addedKeys = new Set(addition);
          const region = new Set([...patchCells, ...addedKeys]);
          const maxParts = Math.min(4, before.length + maxAdditionalParts);
          const tilings = tileRegion({
            region, y: anchor.y, color: anchor.color, maxParts, anchorCells, addedKeys, state,
          });
          for (const after of tilings) {
            if (after.length > before.length + maxAdditionalParts) continue;
            const replacementIndexes = new Set(patchIndexes);
            const fullBefore = before.map(({ x, y, z, w, d, color }) => ({ x, y, z, w, d, color }));
            const fullAfter = after.sort(compareBricks);
            const { before: cleanBefore, after: cleanAfter } = changedPlacements(fullBefore, fullAfter);
            if (!cleanBefore.length || !cleanAfter.length) continue;
            const signature = `covered-patch:${cleanBefore.map(brickKey).join('|')}>${cleanAfter.map(brickKey).join('|')}`;
            if (proposals.has(signature)) {
              const existing = proposals.get(signature);
              existing.targetIds = [...new Set([...existing.targetIds, targetId])].sort();
              existing.estimatedResolvedCellCount = Math.max(existing.estimatedResolvedCellCount, estimatedResolvedCellCount);
              continue;
            }
            const bricks = modelBricks.filter((_, index) => !replacementIndexes.has(index))
              .map(({ x, y, z, w, d, color }) => ({ x, y, z, w, d, color }))
              .concat(fullAfter).sort(compareBricks);
            const addedCells = addition.map((key) => {
              const [x, y, z] = key.split(',').map(Number);
              return { x, y, z, color: anchor.color };
            }).sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
            proposals.set(signature, {
              targetIds: [targetId], anchorIds: [anchorId], direction: 'covered-patch',
              before: cleanBefore, after: cleanAfter, bricks, addedCells,
              additionalPartCount: fullAfter.length - fullBefore.length,
              iconicBrickGain: iconicCount(fullAfter) - iconicCount(fullBefore),
              changedBrickCount: cleanBefore.length + cleanAfter.length,
              estimatedResolvedCellCount, signature,
            });
          }
        }
      }
      }
    }
  }
  const all = [...proposals.values()].sort(proposalOrder);
  const returned = all.slice(0, maxProposals);
  return {
    proposals: returned,
    stats: {
      targetCount: targetIds.size,
      resolvedAnchorCount: resolvedAnchorIds.size,
      patchVisits: state.patchVisits,
      patchVisitLimit: MAX_PATCH_VISITS,
      searchNodes: state.searchNodes,
      searchNodeLimit: MAX_SEARCH_NODES,
      additionCombinationCount: state.additionCombinationCount,
      additionCombinationLimit: MAX_ADDITION_COMBINATIONS,
      additionCombinationLimitReached: state.additionCombinationLimitReached,
      legalProposalCount: all.length,
      returnedProposalCount: returned.length,
      maxProposals,
      truncated: all.length > returned.length || state.patchVisits >= MAX_PATCH_VISITS
        || state.searchNodes >= MAX_SEARCH_NODES || state.additionCombinationLimitReached,
      limitations: 'Bounded same-color course retiling proposes small covered interfaces only; selection, assembly replay, strength, balance, and physical buildability are evaluated elsewhere.',
    },
  };
}
