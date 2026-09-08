const MAX_PATCH_CELLS = 24;
const MAX_PATCH_BRICKS = 6;
const MAX_PATCH_SPAN = 6;
const MAX_INPUT_BRICKS = 5_000;
const MAX_COORDINATE = 10_000;
const ORDINARY_FOOTPRINTS = Object.freeze([
  { w: 2, d: 4 }, { w: 4, d: 2 },
  { w: 2, d: 3 }, { w: 3, d: 2 },
  { w: 2, d: 2 },
  { w: 1, d: 4 }, { w: 4, d: 1 },
  { w: 1, d: 3 }, { w: 3, d: 1 },
  { w: 1, d: 2 }, { w: 2, d: 1 },
  { w: 1, d: 1 },
]);
const ORDINARY_FOOTPRINT_KEYS = new Set(ORDINARY_FOOTPRINTS.map(({ w, d }) => `${w}x${d}`));

const cellKey = (x, y, z) => `${x},${y},${z}`;
const patchKey = (indexes) => [...indexes].sort((a, b) => a - b).join(',');
const rectangleKey = ({ x, y, z, w, d, color }) => `${y}:${color}:${x},${z}:${w}x${d}`;

function compareBricks(a, b) {
  return a.y - b.y || a.z - b.z || a.x - b.x || b.w * b.d - a.w * a.d
    || a.w - b.w || a.d - b.d || a.color.localeCompare(b.color);
}

function footprintCells(brick) {
  const cells = [];
  for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
    cells.push(cellKey(brick.x + dx, brick.y, brick.z + dz));
  }
  return cells;
}

function buildGeometry(brickModel) {
  if (!brickModel || typeof brickModel !== 'object' || Array.isArray(brickModel) || !Array.isArray(brickModel.bricks)) {
    throw new TypeError('brickModel must contain a bricks array.');
  }
  if (brickModel.bricks.length > MAX_INPUT_BRICKS) {
    throw new RangeError(`brickModel exceeds the ${MAX_INPUT_BRICKS}-brick refinement limit.`);
  }
  const occupancy = new Map();
  brickModel.bricks.forEach((brick, index) => {
    if (!brick || typeof brick !== 'object' || !['x', 'y', 'z', 'w', 'd'].every((field) => Number.isSafeInteger(brick[field]))
      || brick.y < 0 || brick.w < 1 || brick.d < 1 || typeof brick.color !== 'string') {
      throw new TypeError(`Brick ${index} is not valid refinement geometry.`);
    }
    if (!ORDINARY_FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`)) {
      throw new RangeError(`Brick ${index} uses unsupported refinement footprint ${brick.w}x${brick.d}.`);
    }
    if (Math.abs(brick.x) > MAX_COORDINATE || Math.abs(brick.z) > MAX_COORDINATE || brick.y > MAX_COORDINATE
      || brick.x + brick.w - 1 > MAX_COORDINATE || brick.z + brick.d - 1 > MAX_COORDINATE) {
      throw new RangeError(`Brick ${index} exceeds refinement coordinate bounds.`);
    }
    for (const key of footprintCells(brick)) {
      if (occupancy.has(key)) throw new RangeError(`Brick ${index} overlaps another brick at ${key}.`);
      occupancy.set(key, index);
    }
  });

  const adjacency = brickModel.bricks.map(() => new Set());
  brickModel.bricks.forEach((brick, index) => {
    const neighbors = [];
    for (let dz = 0; dz < brick.d; dz += 1) {
      neighbors.push([brick.x - 1, brick.z + dz], [brick.x + brick.w, brick.z + dz]);
    }
    for (let dx = 0; dx < brick.w; dx += 1) {
      neighbors.push([brick.x + dx, brick.z - 1], [brick.x + dx, brick.z + brick.d]);
    }
    for (const [x, z] of neighbors) {
      const otherIndex = occupancy.get(cellKey(x, brick.y, z));
      if (otherIndex == null || otherIndex === index) continue;
      if (brickModel.bricks[otherIndex].color === brick.color) adjacency[index].add(otherIndex);
    }
  });

  const supportAreas = brickModel.bricks.map((brick) => {
    if (brick.y === 0) return brick.w * brick.d;
    let area = 0;
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      if (occupancy.has(cellKey(brick.x + dx, brick.y - 1, brick.z + dz))) area += 1;
    }
    return area;
  });
  return { occupancy, adjacency, supportAreas };
}

function targetPriority(brick, supportArea) {
  if (brick.y > 0 && supportArea === 0) return 0;
  if (brick.y > 0 && supportArea / (brick.w * brick.d) < 0.25) return 1;
  if (brick.w === 1 && brick.d === 1) return 2;
  return 3;
}

function patchBounds(indexes, bricks) {
  const selected = indexes.map((index) => bricks[index]);
  const minX = Math.min(...selected.map((brick) => brick.x));
  const maxX = Math.max(...selected.map((brick) => brick.x + brick.w));
  const minZ = Math.min(...selected.map((brick) => brick.z));
  const maxZ = Math.max(...selected.map((brick) => brick.z + brick.d));
  return { minX, maxX, minZ, maxZ, w: maxX - minX, d: maxZ - minZ };
}

function eligiblePatch(indexes, bricks) {
  if (indexes.length < 2 || indexes.length > MAX_PATCH_BRICKS) return false;
  const first = bricks[indexes[0]];
  if (indexes.some((index) => bricks[index].y !== first.y || bricks[index].color !== first.color)) return false;
  const area = indexes.reduce((sum, index) => sum + bricks[index].w * bricks[index].d, 0);
  const bounds = patchBounds(indexes, bricks);
  return area <= MAX_PATCH_CELLS && bounds.w <= MAX_PATCH_SPAN && bounds.d <= MAX_PATCH_SPAN;
}

function candidatePatches(bricks, adjacency, supportAreas, maxCandidates, targetIndexes = null) {
  const targets = bricks.map((brick, index) => ({ index, priority: targetPriority(brick, supportAreas[index]) }))
    .filter(({ index }) => targetIndexes == null || targetIndexes.has(index))
    .sort((a, b) => a.priority - b.priority || compareBricks(bricks[a.index], bricks[b.index]) || a.index - b.index);
  const patches = new Map();
  let truncated = false;
  const add = (indexes, priority) => {
    const sorted = [...new Set(indexes)].sort((a, b) => a - b);
    if (!eligiblePatch(sorted, bricks)) return;
    const key = patchKey(sorted);
    const prior = patches.get(key);
    if (!prior && patches.size >= maxCandidates) {
      truncated = true;
      return;
    }
    if (!prior || priority < prior.priority) patches.set(key, { indexes: sorted, priority });
  };

  // Direct pairs cover exact whole-brick merges and two-piece retilings cheaply.
  const directPairLimit = Math.ceil(maxCandidates / 2);
  pairLoop: for (const target of targets) for (const neighbor of [...adjacency[target.index]].sort((a, b) => a - b)) {
    add([target.index, neighbor], target.priority);
    if (patches.size >= directPairLimit) {
      truncated = true;
      break pairLoop;
    }
  }

  // Add small connected neighborhoods around difficult bricks. This is deliberately
  // bounded; the integration layer decides whether any proposal is globally safer.
  for (const target of targets) {
    if (patches.size >= maxCandidates) { truncated = true; break; }
    const queue = [[target.index]];
    const seen = new Set([String(target.index)]);
    while (queue.length) {
      const indexes = queue.shift();
      if (indexes.length >= MAX_PATCH_BRICKS) continue;
      const frontier = new Set(indexes.flatMap((index) => [...adjacency[index]]));
      for (const next of [...frontier].sort((a, b) => compareBricks(bricks[a], bricks[b]) || a - b)) {
        if (indexes.includes(next)) continue;
        const expanded = [...indexes, next].sort((a, b) => a - b);
        const key = patchKey(expanded);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!eligiblePatch(expanded, bricks)) continue;
        add(expanded, target.priority);
        queue.push(expanded);
        if (seen.size >= 32) break;
      }
      if (seen.size >= 32) break;
    }
  }

  return {
    patches: [...patches.values()].sort((a, b) => a.priority - b.priority
      || a.indexes.length - b.indexes.length
      || patchKey(a.indexes).localeCompare(patchKey(b.indexes), undefined, { numeric: true })),
    truncated,
  };
}

function localMetrics(bricks, occupancy) {
  let unsupportedBrickCount = 0;
  let weakSupportBrickCount = 0;
  let unsupportedFootprintArea = 0;
  let supportedStudCount = 0;
  for (const brick of bricks) {
    let supportArea = brick.y === 0 ? brick.w * brick.d : 0;
    if (brick.y > 0) for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      if (occupancy.has(cellKey(brick.x + dx, brick.y - 1, brick.z + dz))) supportArea += 1;
    }
    supportedStudCount += supportArea;
    if (brick.y > 0 && supportArea === 0) {
      unsupportedBrickCount += 1;
      unsupportedFootprintArea += brick.w * brick.d;
    } else if (brick.y > 0 && supportArea / (brick.w * brick.d) < 0.25) weakSupportBrickCount += 1;
  }
  return {
    brickCount: bricks.length,
    oneByOneCount: bricks.filter(({ w, d }) => w === 1 && d === 1).length,
    iconicBrickCount: bricks.filter(({ w, d }) => Math.min(w, d) === 2 && [2, 4].includes(Math.max(w, d))).length,
    unsupportedBrickCount,
    weakSupportBrickCount,
    unsupportedFootprintArea,
    supportedStudCount,
  };
}

function improvementTuple(before, after) {
  return [
    before.unsupportedFootprintArea - after.unsupportedFootprintArea,
    before.unsupportedBrickCount - after.unsupportedBrickCount,
    before.weakSupportBrickCount - after.weakSupportBrickCount,
    before.brickCount - after.brickCount,
    before.oneByOneCount - after.oneByOneCount,
    after.iconicBrickCount - before.iconicBrickCount,
  ];
}

function compareTuple(a, b) {
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
  return 0;
}

function tupleImproves(tuple) {
  return tuple.find((value) => value !== 0) > 0;
}

function exactCoverPatch(before, occupancy, budget) {
  const y = before[0].y;
  const color = before[0].color;
  const coordinates = before.flatMap((brick) => footprintCells(brick).map((key) => {
    const [x, , z] = key.split(',').map(Number);
    return { x, z, key };
  })).sort((a, b) => a.z - b.z || a.x - b.x);
  const cellIndex = new Map(coordinates.map(({ key }, index) => [key, index]));
  const fullMask = (1n << BigInt(coordinates.length)) - 1n;
  const placementsByCell = coordinates.map(() => []);
  const bounds = patchBounds(before.map((_, index) => index), before);
  for (let z = bounds.minZ; z < bounds.maxZ; z += 1) for (let x = bounds.minX; x < bounds.maxX; x += 1) {
    for (const footprint of ORDINARY_FOOTPRINTS) {
      let mask = 0n;
      const covered = [];
      let fits = true;
      for (let dz = 0; dz < footprint.d && fits; dz += 1) for (let dx = 0; dx < footprint.w; dx += 1) {
        const index = cellIndex.get(cellKey(x + dx, y, z + dz));
        if (index == null) { fits = false; break; }
        mask |= 1n << BigInt(index);
        covered.push(index);
      }
      if (!fits) continue;
      const placement = { x, y, z, w: footprint.w, d: footprint.d, color, mask };
      for (const index of covered) placementsByCell[index].push(placement);
    }
  }
  for (const placements of placementsByCell) placements.sort((a, b) => b.w * b.d - a.w * a.d
    || Number(Math.min(a.w, a.d) !== 2) - Number(Math.min(b.w, b.d) !== 2)
    || compareBricks(a, b));

  const beforeSignature = before.map(rectangleKey).sort().join('|');
  const localBefore = localMetrics(before, occupancy);
  const alternatives = new Map();
  let localSearchNodes = 0;
  function visit(mask, rectangles) {
    if (budget.exhausted || localSearchNodes >= budget.maxNodesPerPatch) {
      if (localSearchNodes >= budget.maxNodesPerPatch) budget.localLimitReached = true;
      return;
    }
    localSearchNodes += 1;
    budget.searchNodes += 1;
    if (budget.searchNodes >= budget.maxSearchNodes) {
      budget.exhausted = true;
      return;
    }
    if (mask === fullMask) {
      const after = rectangles.map(({ mask: ignored, ...brick }) => brick).sort(compareBricks);
      if (after.map(rectangleKey).sort().join('|') === beforeSignature) return;
      const localAfter = localMetrics(after, occupancy);
      if (localAfter.brickCount > localBefore.brickCount) return;
      const tuple = improvementTuple(localBefore, localAfter);
      if (!tupleImproves(tuple)) return;
      const signature = after.map(rectangleKey).join('|');
      alternatives.set(signature, { after, localAfter, tuple, signature });
      return;
    }
    if (rectangles.length > before.length) return;
    let selected = -1;
    let options = null;
    for (let index = 0; index < coordinates.length; index += 1) {
      if (mask & (1n << BigInt(index))) continue;
      const available = placementsByCell[index].filter((placement) => !(mask & placement.mask));
      if (!available.length) return;
      if (!options || available.length < options.length) {
        selected = index;
        options = available;
      }
    }
    if (selected < 0) return;
    for (const placement of options) visit(mask | placement.mask, [...rectangles, placement]);
  }
  visit(0n, []);
  return [...alternatives.values()].sort((a, b) => compareTuple(a.tuple, b.tuple) || a.signature.localeCompare(b.signature))
    .slice(0, 3).map((alternative) => ({ ...alternative, localBefore }));
}

function replacePatch(bricks, indexes, replacements) {
  const removed = new Set(indexes);
  const insertionIndex = Math.min(...indexes);
  const result = [];
  for (let index = 0; index < bricks.length; index += 1) {
    if (index === insertionIndex) result.push(...replacements);
    if (!removed.has(index)) result.push(bricks[index]);
  }
  return result;
}

function directRectangleMerges(bricks, adjacency, occupancy, targetIndexes = null) {
  const merges = [];
  for (let left = 0; left < bricks.length; left += 1) for (const right of adjacency[left]) {
    if (right <= left) continue;
    if (targetIndexes != null && !targetIndexes.has(left) && !targetIndexes.has(right)) continue;
    const before = [bricks[left], bricks[right]];
    if (!eligiblePatch([left, right], bricks)) continue;
    const bounds = patchBounds([left, right], bricks);
    const area = before.reduce((sum, brick) => sum + brick.w * brick.d, 0);
    if (area !== bounds.w * bounds.d || !ORDINARY_FOOTPRINT_KEYS.has(`${bounds.w}x${bounds.d}`)) continue;
    const after = [{ x: bounds.minX, y: before[0].y, z: bounds.minZ, w: bounds.w, d: bounds.d, color: before[0].color }];
    const localBefore = localMetrics(before, occupancy);
    const localAfter = localMetrics(after, occupancy);
    const tuple = improvementTuple(localBefore, localAfter);
    if (!tupleImproves(tuple)) continue;
    merges.push({ indexes: [left, right], before, after, localBefore, localAfter, tuple });
  }
  return merges.sort((a, b) => compareTuple(a.tuple, b.tuple)
    || a.after.map(rectangleKey).join('|').localeCompare(b.after.map(rectangleKey).join('|')));
}

function proposalFor(brickModel, indexes, before, result) {
  return {
    bricks: replacePatch(brickModel.bricks, indexes, result.after),
    before: before.map((brick) => ({ ...brick })),
    after: result.after,
    reason: result.localAfter.unsupportedFootprintArea < result.localBefore.unsupportedFootprintArea
      ? 'Retile a bounded same-color course patch to give unsupported brick area a supported placement.'
      : result.localAfter.oneByOneCount < result.localBefore.oneByOneCount
        ? 'Retile a bounded same-color course patch to avoid isolated 1x1 parts.'
        : 'Retile a bounded same-color course patch with fewer or more iconic ordinary bricks.',
    localBefore: result.localBefore,
    localAfter: result.localAfter,
  };
}

export function proposeBrickRefinements(brickModel, {
  maxPatches = 96,
  maxSearchNodes = 24_000,
  targetBricks = null,
  supportOnly = false,
} = {}) {
  if (!Number.isSafeInteger(maxPatches) || maxPatches < 0) throw new RangeError('maxPatches must be a nonnegative integer.');
  if (!Number.isSafeInteger(maxSearchNodes) || maxSearchNodes < 0) throw new RangeError('maxSearchNodes must be a nonnegative integer.');
  if (targetBricks != null && !Array.isArray(targetBricks)) throw new TypeError('targetBricks must be an array when provided.');
  if (typeof supportOnly !== 'boolean') throw new TypeError('supportOnly must be a boolean.');
  const { occupancy, adjacency, supportAreas } = buildGeometry(brickModel);
  const targetKeys = targetBricks == null ? null : new Set(targetBricks.map(rectangleKey));
  const targetIndexes = targetKeys == null ? null : new Set(brickModel.bricks
    .map((brick, index) => targetKeys.has(rectangleKey(brick)) ? index : -1).filter((index) => index >= 0));
  const candidates = candidatePatches(brickModel.bricks, adjacency, supportAreas, maxPatches * 4, targetIndexes);
  const patches = candidates.patches;
  const budget = { searchNodes: 0, maxSearchNodes, maxNodesPerPatch: 320, exhausted: maxSearchNodes === 0, localLimitReached: false };
  const proposals = [];
  const proposalSignatures = new Set();
  const visitedPatchKeys = new Set();
  let patchesVisited = 0;
  const append = (proposal) => {
    if (supportOnly && proposal.localAfter.unsupportedFootprintArea >= proposal.localBefore.unsupportedFootprintArea) return;
    const signature = proposal.bricks.map(rectangleKey).sort().join('|');
    if (proposalSignatures.has(signature)) return;
    proposalSignatures.add(signature);
    proposals.push(proposal);
  };

  // Rectangle unions require no search. Evaluate them across the model before
  // dividing the DFS budget among more ambiguous local retilings.
  for (const merge of directRectangleMerges(brickModel.bricks, adjacency, occupancy, targetIndexes)) {
    const key = patchKey(merge.indexes);
    if (!visitedPatchKeys.has(key)) {
      if (patchesVisited >= maxPatches) break;
      visitedPatchKeys.add(key);
      patchesVisited += 1;
    }
    append(proposalFor(brickModel, merge.indexes, merge.before, merge));
  }

  for (const patch of patches) {
    const key = patchKey(patch.indexes);
    if (!visitedPatchKeys.has(key)) {
      if (patchesVisited >= maxPatches) break;
      visitedPatchKeys.add(key);
      patchesVisited += 1;
    }
    if (budget.exhausted) break;
    const before = patch.indexes.map((index) => brickModel.bricks[index]);
    for (const result of exactCoverPatch(before, occupancy, budget)) {
      append(proposalFor(brickModel, patch.indexes, before, result));
    }
  }
  proposals.sort((a, b) => compareTuple(improvementTuple(a.localBefore, a.localAfter), improvementTuple(b.localBefore, b.localAfter))
    || a.after.map(rectangleKey).join('|').localeCompare(b.after.map(rectangleKey).join('|')));
  return {
    proposals,
    stats: {
      patchesVisited,
      searchNodes: Math.min(budget.searchNodes, maxSearchNodes),
      limitReached: candidates.truncated || budget.localLimitReached
        || budget.exhausted && patches.length > 0
        || patchesVisited < patches.length && patchesVisited >= maxPatches,
    },
  };
}
