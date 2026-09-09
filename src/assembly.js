import { FOOTPRINTS, PALETTE } from './geometry.js';
import { createRectangularLayerGroups } from './rectangular-layer-groups.js';

const MAX_BRICKS = 5_000;
const MAX_FOOTPRINT_CELLS = 1_500_000;
const MAX_PROJECTED_OVERLAP_PAIRS = 1_500_000;
const MAX_PLAN_REFERENCES = 500_000;
const COORDINATE_LIMIT = 10_000;
const MAX_STEP_BRICKS = 6;
const MAX_COHERENT_STEP_BRICKS = 12;
const MAX_STEP_PART_TYPES = 4;
const MAX_STEP_LOCAL_SPAN = 24;
const MAX_DETAIL_BRICKS = 12;
const MAX_FOUNDATION_LOOKAHEAD_GAP = 2;
const FOOTPRINT_KEYS = new Set(FOOTPRINTS.map(({ w, d }) => `${w}x${d}`));

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

class DisjointSet {
  constructor(size) {
    this.parent = Int32Array.from({ length: size }, (_, index) => index);
    this.rank = new Uint8Array(size);
  }

  find(value) {
    let root = value;
    while (this.parent[root] !== root) root = this.parent[root];
    while (this.parent[value] !== value) {
      const next = this.parent[value];
      this.parent[value] = root;
      value = next;
    }
    return root;
  }

  union(a, b) {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return;
    if (this.rank[rootA] < this.rank[rootB]) [rootA, rootB] = [rootB, rootA];
    this.parent[rootB] = rootA;
    if (this.rank[rootA] === this.rank[rootB]) this.rank[rootA] += 1;
  }
}

function compareBricks(a, b) {
  return a.y - b.y || a.z - b.z || a.x - b.x || a.w - b.w || a.d - b.d
    || a.color.localeCompare(b.color) || a.inputIndex - b.inputIndex;
}

function cellKey(x, z) {
  return `${x},${z}`;
}

function validateAndIdentify(brickModel) {
  if (!brickModel || typeof brickModel !== 'object' || Array.isArray(brickModel)) throw new TypeError('brickModel must be an object.');
  if (brickModel.version !== 1 || brickModel.kind !== 'bricks') throw new TypeError('brickModel must be a version 1 bricks model.');
  if (!Array.isArray(brickModel.bricks) || brickModel.bricks.length === 0) throw new TypeError('brickModel.bricks must be a non-empty array.');
  if (brickModel.bricks.length > MAX_BRICKS) throw new RangeError(`Assembly planning is limited to ${MAX_BRICKS} bricks.`);

  let footprintCells = 0;
  const prepared = brickModel.bricks.map((brick, inputIndex) => {
    if (!brick || typeof brick !== 'object' || Array.isArray(brick)) throw new TypeError(`Brick ${inputIndex} must be an object.`);
    for (const field of ['x', 'y', 'z', 'w', 'd']) {
      if (!Number.isSafeInteger(brick[field])) throw new TypeError(`Brick ${inputIndex} ${field} must be a safe integer.`);
    }
    if (brick.y < 0) throw new RangeError(`Brick ${inputIndex} y must be nonnegative.`);
    if (!FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`)) throw new RangeError(`Brick ${inputIndex} uses unsupported footprint ${brick.w}x${brick.d}.`);
    if (!Object.hasOwn(PALETTE, brick.color)) throw new RangeError(`Brick ${inputIndex} uses unknown color ${String(brick.color)}.`);
    if (Math.abs(brick.x) > COORDINATE_LIMIT || Math.abs(brick.z) > COORDINATE_LIMIT || brick.y > COORDINATE_LIMIT
      || !Number.isSafeInteger(brick.x + brick.w) || !Number.isSafeInteger(brick.z + brick.d)
      || brick.x + brick.w > COORDINATE_LIMIT || brick.z + brick.d > COORDINATE_LIMIT) {
      throw new RangeError(`Brick ${inputIndex} coordinates exceed assembly planning bounds.`);
    }
    footprintCells += brick.w * brick.d;
    if (!Number.isSafeInteger(footprintCells) || footprintCells > MAX_FOOTPRINT_CELLS) {
      throw new RangeError(`Assembly planning exceeds the ${MAX_FOOTPRINT_CELLS}-cell footprint limit.`);
    }
    return { ...brick, inputIndex };
  }).sort(compareBricks);

  const duplicateCounts = new Map();
  return prepared.map((brick) => {
    const coordinateKey = `${brick.x},${brick.y},${brick.z}:${brick.w}x${brick.d}:${brick.color}`;
    const duplicate = duplicateCounts.get(coordinateKey) ?? 0;
    duplicateCounts.set(coordinateKey, duplicate + 1);
    const id = `b@${coordinateKey}${duplicate ? `#${duplicate + 1}` : ''}`;
    const { inputIndex: _inputIndex, ...inputFields } = brick;
    return { ...inputFields, id };
  });
}

function buildContactGraph(bricks) {
  const layers = new Map();
  const columns = new Map();
  for (let index = 0; index < bricks.length; index += 1) {
    const brick = bricks[index];
    if (!layers.has(brick.y)) layers.set(brick.y, new Map());
    const cells = layers.get(brick.y);
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const key = cellKey(brick.x + dx, brick.z + dz);
      if (cells.has(key)) throw new RangeError(`Brick model contains a collision at ${brick.x + dx},${brick.y},${brick.z + dz}.`);
      cells.set(key, index);
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(index);
    }
  }

  const dsu = new DisjointSet(bricks.length);
  const edgesByPair = new Map();
  const below = bricks.map(() => new Map());
  const directAbove = bricks.map(() => new Map());
  for (let upper = 0; upper < bricks.length; upper += 1) {
    const brick = bricks[upper];
    const lowerLayer = layers.get(brick.y - 1);
    if (!lowerLayer) continue;
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const lower = lowerLayer.get(cellKey(brick.x + dx, brick.z + dz));
      if (lower === undefined) continue;
      below[upper].set(lower, (below[upper].get(lower) ?? 0) + 1);
    }
    for (const [lower, studs] of below[upper]) {
      const key = `${lower}:${upper}`;
      edgesByPair.set(key, { lower, upper, studs });
      directAbove[lower].set(upper, studs);
      dsu.union(lower, upper);
    }
  }

  const componentIndexes = new Map();
  for (let index = 0; index < bricks.length; index += 1) {
    const root = dsu.find(index);
    if (!componentIndexes.has(root)) componentIndexes.set(root, []);
    componentIndexes.get(root).push(index);
  }
  const components = [...componentIndexes.values()].sort((a, b) => compareBricks(bricks[a[0]], bricks[b[0]]));
  const componentObjects = components.map((indexes, index) => ({
    id: `component-${index + 1}`,
    brickIds: indexes.map((brickIndex) => bricks[brickIndex].id),
    grounded: indexes.some((brickIndex) => bricks[brickIndex].y === 0),
  }));
  const indexEdges = [...edgesByPair.values()];
  const edges = indexEdges
    .map(({ lower, upper, studs }) => ({ a: bricks[lower].id, b: bricks[upper].id, studs }))
    .sort((a, b) => a.a.localeCompare(b.a) || a.b.localeCompare(b.b));
  const overlapPairs = new Set();
  const above = bricks.map(() => new Set());
  const blocksLower = bricks.map(() => new Set());
  for (const owners of columns.values()) {
    owners.sort((a, b) => bricks[a].y - bricks[b].y || a - b);
    for (let lowerPosition = 0; lowerPosition < owners.length; lowerPosition += 1) {
      for (let upperPosition = lowerPosition + 1; upperPosition < owners.length; upperPosition += 1) {
        const lower = owners[lowerPosition];
        const upper = owners[upperPosition];
        if (bricks[lower].y === bricks[upper].y) continue;
        overlapPairs.add(lower * MAX_BRICKS + upper);
        if (overlapPairs.size > MAX_PROJECTED_OVERLAP_PAIRS) {
          throw new RangeError(`Assembly planning exceeds the ${MAX_PROJECTED_OVERLAP_PAIRS}-pair insertion-path limit.`);
        }
      }
    }
  }
  for (const pair of overlapPairs) {
    const lower = Math.floor(pair / MAX_BRICKS);
    const upper = pair % MAX_BRICKS;
    above[lower].add(upper);
    blocksLower[upper].add(lower);
  }
  return { components, componentObjects, edges, indexEdges, below, directAbove, above, blocksLower };
}

function connectedWithin(indexes, adjacency) {
  if (indexes.size <= 1) return true;
  const start = indexes.values().next().value;
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) {
    const current = stack.pop();
    for (const next of adjacency[current]) if (indexes.has(next) && !seen.has(next)) {
      seen.add(next);
      stack.push(next);
    }
  }
  return seen.size === indexes.size;
}

function regionsWithin(indexes, adjacency) {
  const allowed = indexes instanceof Set ? indexes : new Set(indexes);
  const visited = new Set();
  const regions = [];
  for (const start of allowed) {
    if (visited.has(start)) continue;
    const region = [];
    const stack = [start];
    visited.add(start);
    while (stack.length) {
      const current = stack.pop();
      region.push(current);
      for (const next of adjacency[current]) if (allowed.has(next) && !visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
    regions.push(region);
  }
  return regions;
}

function isTopAttachedRegion(region, outside, adjacency, graph) {
  const regionSet = new Set(region);
  const contacts = [];
  for (const index of region) for (const next of adjacency[index]) if (outside.has(next)) contacts.push([index, next]);
  if (!contacts.length || contacts.some(([index, lower]) => !graph.below[index].has(lower))) return false;
  for (const index of region) for (const blocker of graph.above[index]) if (outside.has(blocker)) return false;
  return true;
}

function deriveModuleGroups(bricks, graph) {
  const adjacency = bricks.map(() => new Set());
  for (const { lower, upper } of graph.indexEdges) {
    adjacency[lower].add(upper);
    adjacency[upper].add(lower);
  }

  const groups = [];
  for (let componentIndex = 0; componentIndex < graph.components.length; componentIndex += 1) {
    const component = graph.components[componentIndex];
    const grounded = component.some((index) => bricks[index].y === 0);
    if (!grounded) {
      groups.push({ indexes: [...component], kind: 'floating', componentIndex });
      continue;
    }

    const remaining = new Set(component);
    const branchGroups = [];
    const detailGroups = [];

    // Look for a few substantial upper branches joined through a narrow neck.
    // These are geometry-derived work areas, never semantic labels.
    const cuts = [...new Set(component.map((index) => bricks[index].y))].sort((a, b) => a - b).slice(1);
    const branchCandidates = [];
    for (const cut of cuts) {
      const upper = new Set(component.filter((index) => bricks[index].y >= cut));
      for (const region of regionsWithin(upper, adjacency)) {
        if (region.length < 12 || region.length > component.length * 0.45) continue;
        const regionSet = new Set(region);
        const outside = new Set(component.filter((index) => !regionSet.has(index)));
        if (!connectedWithin(outside, adjacency) || !isTopAttachedRegion(region, outside, adjacency, graph)) continue;
        let interfaceEdges = 0;
        let interfaceStuds = 0;
        for (const { lower, upper: upperIndex, studs } of graph.indexEdges) if (regionSet.has(upperIndex) && outside.has(lower)) {
          interfaceEdges += 1;
          interfaceStuds += studs;
        }
        const neckLimit = Math.max(4, Math.ceil(Math.sqrt(region.length)));
        if (interfaceEdges > neckLimit || interfaceStuds > neckLimit * 4) continue;
        branchCandidates.push({ region: region.sort((a, b) => compareBricks(bricks[a], bricks[b])), interfaceEdges });
      }
    }
    branchCandidates.sort((a, b) => b.region.length - a.region.length || a.interfaceEdges - b.interfaceEdges
      || compareBricks(bricks[a.region[0]], bricks[b.region[0]]));
    for (const { region } of branchCandidates) {
      if (branchGroups.length >= 3 || !region.every((index) => remaining.has(index))) continue;
      const proposed = new Set([...remaining].filter((index) => !region.includes(index)));
      if (!proposed.size || !connectedWithin(proposed, adjacency) || !isTopAttachedRegion(region, proposed, adjacency, graph)) continue;
      for (const index of region) remaining.delete(index);
      branchGroups.push(region);
    }

    const colorRegions = [];
    const colorVisited = new Set();
    for (const start of remaining) {
      if (colorVisited.has(start)) continue;
      const color = bricks[start].color;
      const region = [];
      const stack = [start];
      colorVisited.add(start);
      while (stack.length) {
        const current = stack.pop();
        region.push(current);
        for (const next of adjacency[current]) if (remaining.has(next) && !colorVisited.has(next) && bricks[next].color === color) {
          colorVisited.add(next);
          stack.push(next);
        }
      }
      colorRegions.push(region.sort((a, b) => compareBricks(bricks[a], bricks[b])));
    }
    const detailCandidates = colorRegions
      .filter((region) => {
        const regionSet = new Set(region);
        if (region.length > MAX_DETAIL_BRICKS
          || region.length > Math.max(2, Math.floor(component.length * 0.25))
          || region.some((index) => bricks[index].y === 0)) return false;
        const outside = new Set([...remaining].filter((index) => !regionSet.has(index)));
        return isTopAttachedRegion(region, outside, adjacency, graph);
      })
      .sort((a, b) => a.length - b.length || compareBricks(bricks[a[0]], bricks[b[0]]));

    for (const region of detailCandidates) {
      const proposed = new Set([...remaining].filter((index) => !region.includes(index)));
      if (!proposed.size || !connectedWithin(proposed, adjacency) || !isTopAttachedRegion(region, proposed, adjacency, graph)) continue;
      for (const index of region) remaining.delete(index);
      detailGroups.push(region);
    }

    groups.push({ indexes: [...remaining].sort((a, b) => compareBricks(bricks[a], bricks[b])), kind: 'grounded', componentIndex });
    for (const indexes of branchGroups) groups.push({ indexes, kind: 'detail', groupType: 'branch', componentIndex });
    for (const indexes of detailGroups) groups.push({ indexes, kind: 'detail', groupType: 'color', componentIndex });
  }
  return groups;
}

function studAdjacency(brickCount, graph) {
  const adjacency = Array.from({ length: brickCount }, () => new Set());
  for (const { lower, upper } of graph.indexEdges) {
    adjacency[lower].add(upper);
    adjacency[upper].add(lower);
  }
  return adjacency;
}

function splitWorkSurfaceGroup(groups, brickIds, bricks, graph, orderPolicy) {
  if (!Array.isArray(brickIds)) throw new TypeError('workSurfaceBrickIds must be an array when provided.');
  if (brickIds.length < 2) throw new RangeError('workSurfaceBrickIds must contain at least two brick IDs.');
  if (brickIds.some((id) => typeof id !== 'string') || new Set(brickIds).size !== brickIds.length) {
    throw new RangeError('workSurfaceBrickIds must contain unique brick ID strings.');
  }
  const indexById = new Map(bricks.map(({ id }, index) => [id, index]));
  const indexes = brickIds.map((id) => {
    const index = indexById.get(id);
    if (index === undefined) throw new RangeError(`Unknown work-surface brick ID ${id}.`);
    return index;
  });
  const selected = new Set(indexes);
  const ownerIndex = groups.findIndex((group) => group.kind === 'grounded'
    && indexes.every((index) => group.indexes.includes(index)));
  if (ownerIndex < 0) {
    throw new RangeError('Work-surface bricks must all belong to one existing derived grounded module.');
  }
  const owner = groups[ownerIndex];
  const adjacency = studAdjacency(bricks.length, graph);
  if (!connectedWithin(selected, adjacency)) {
    throw new RangeError('Work-surface bricks must be internally stud-connected.');
  }
  const floorY = Math.min(...indexes.map((index) => bricks[index].y));
  if (floorY <= 0) throw new RangeError('A work-surface band floor must be above course zero.');
  const lowerIndexes = owner.indexes.filter((index) => bricks[index].y < floorY);
  if (!lowerIndexes.length) throw new RangeError('A work-surface band requires a nonempty lower remainder.');
  const continuationIndexes = owner.indexes.filter((index) => !selected.has(index) && bricks[index].y >= floorY);
  const replacement = [
    { ...owner, indexes: lowerIndexes },
    {
      ...owner,
      indexes: indexes.slice().sort((a, b) => compareBricks(bricks[a], bricks[b])),
      kind: 'detail',
      groupType: 'work-surface',
      buildContext: {
        kind: 'work-surface',
        floorY,
        ...(orderPolicy !== 'course-first' ? { orderPolicy } : {}),
      },
    },
  ];
  if (continuationIndexes.length) replacement.push({
    ...owner,
    indexes: continuationIndexes,
    kind: 'grounded',
    groupType: 'continuation',
  });
  return [...groups.slice(0, ownerIndex), ...replacement, ...groups.slice(ownerIndex + 1)];
}

function replayModuleGroups(moduleReplay, bricks, graph) {
  if (!Array.isArray(moduleReplay)) throw new TypeError('moduleReplay must be an array when provided.');
  if (!moduleReplay.length) throw new RangeError('moduleReplay must contain at least one module.');
  const indexById = new Map(bricks.map(({ id }, index) => [id, index]));
  const componentByBrickIndex = new Map();
  graph.components.forEach((indexes, componentIndex) => {
    for (const index of indexes) componentByBrickIndex.set(index, componentIndex);
  });
  const adjacency = studAdjacency(bricks.length, graph);
  const moduleIds = new Set();
  const ownedIndexes = new Set();
  let priorWasWorkSurface = false;
  const groups = moduleReplay.map((descriptor, descriptorIndex) => {
    if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
      throw new TypeError(`moduleReplay entry ${descriptorIndex + 1} must be an object.`);
    }
    if (typeof descriptor.id !== 'string' || !descriptor.id || moduleIds.has(descriptor.id)) {
      throw new RangeError('moduleReplay module IDs must be unique nonempty strings.');
    }
    moduleIds.add(descriptor.id);
    if (typeof descriptor.label !== 'string' || !descriptor.label) {
      throw new TypeError(`moduleReplay module ${descriptor.id} must have a nonempty label.`);
    }
    if (!['grounded', 'detail', 'floating'].includes(descriptor.kind)) {
      throw new RangeError(`moduleReplay module ${descriptor.id} has invalid kind ${String(descriptor.kind)}.`);
    }
    if (!Array.isArray(descriptor.brickIds) || !descriptor.brickIds.length
      || new Set(descriptor.brickIds).size !== descriptor.brickIds.length
      || descriptor.brickIds.some((id) => typeof id !== 'string')) {
      throw new RangeError(`moduleReplay module ${descriptor.id} must contain unique brick ID strings.`);
    }
    const indexes = descriptor.brickIds.map((id) => {
      const index = indexById.get(id);
      if (index === undefined) throw new RangeError(`moduleReplay module ${descriptor.id} references unknown brick ${id}.`);
      if (ownedIndexes.has(index)) throw new RangeError(`moduleReplay brick ${id} belongs to multiple modules.`);
      ownedIndexes.add(index);
      return index;
    });
    if (!Array.isArray(descriptor.brickOrder) || descriptor.brickOrder.length !== descriptor.brickIds.length
      || new Set(descriptor.brickOrder).size !== descriptor.brickOrder.length
      || descriptor.brickOrder.some((id) => !descriptor.brickIds.includes(id))) {
      throw new RangeError(`moduleReplay module ${descriptor.id} brickOrder must exactly match its brickIds.`);
    }
    const replayRank = new Map(descriptor.brickOrder.map((id, rank) => [indexById.get(id), rank]));
    const allowedGroupTypes = new Set(['branch', 'color', 'detached-parts', 'work-surface', 'continuation']);
    if (descriptor.groupType !== undefined && !allowedGroupTypes.has(descriptor.groupType)) {
      throw new RangeError(`moduleReplay module ${descriptor.id} has invalid groupType ${String(descriptor.groupType)}.`);
    }
    const internallyConnected = connectedWithin(new Set(indexes), adjacency);
    const componentIndexes = [...new Set(indexes.map((index) => componentByBrickIndex.get(index)))].sort((a, b) => a - b);
    const containsGround = indexes.some((index) => bricks[index].y === 0);
    const globallyGrounded = componentIndexes.length === 1 && graph.componentObjects[componentIndexes[0]].grounded;
    let kind = descriptor.kind;
    let label = descriptor.label;
    if (kind === 'floating' && internallyConnected && globallyGrounded && !containsGround) {
      kind = 'detail';
      if (/^Unresolved (?:cluster\b|detached parts$)/.test(label)) label = `Assembly ${descriptorIndex + 1}`;
    }
    if (kind === 'grounded' && descriptor.groupType !== 'continuation' && !containsGround) {
      throw new RangeError(`moduleReplay grounded module ${descriptor.id} must contain a ground-course brick.`);
    }
    if (kind === 'grounded'
      && componentIndexes.some((componentIndex) => !graph.componentObjects[componentIndex].grounded)) {
      throw new RangeError(`moduleReplay grounded module ${descriptor.id} cannot include a groundless stud component.`);
    }
    if (kind !== 'grounded' && !internallyConnected
      && !(kind === 'floating' && descriptor.groupType === 'detached-parts')) {
      throw new RangeError(`moduleReplay handled module ${descriptor.id} must be internally stud-connected.`);
    }
    if (descriptor.groupType === 'detached-parts' && !internallyConnected && kind !== 'floating') {
      throw new RangeError(`moduleReplay detached review module ${descriptor.id} must remain floating.`);
    }
    if (descriptor.groupType === 'continuation') {
      if (kind !== 'grounded' || !priorWasWorkSurface) {
        throw new RangeError(`moduleReplay continuation ${descriptor.id} must immediately follow a work-surface module.`);
      }
    }
    const isWorkSurface = descriptor.groupType === 'work-surface';
    if (isWorkSurface) {
      const context = descriptor.buildContext;
      const orderPolicy = context?.orderPolicy ?? 'course-first';
      if (kind !== 'detail' || context?.kind !== 'work-surface'
        || !Number.isSafeInteger(context.floorY) || context.floorY <= 0
        || context.floorY !== Math.min(...indexes.map((index) => bricks[index].y))
        || !['course-first', 'connected-patches', 'rectangular-layers'].includes(orderPolicy)) {
        throw new RangeError(`moduleReplay work-surface module ${descriptor.id} has invalid build context.`);
      }
      const contextKeys = Object.keys(context);
      if (contextKeys.some((key) => !['kind', 'floorY', 'orderPolicy'].includes(key))) {
        throw new RangeError(`moduleReplay work-surface module ${descriptor.id} has unsupported build context fields.`);
      }
    } else if (descriptor.buildContext !== undefined) {
      throw new RangeError(`moduleReplay module ${descriptor.id} has buildContext outside a work-surface module.`);
    }
    priorWasWorkSurface = isWorkSurface;
    return {
      id: descriptor.id,
      label,
      indexes,
      kind,
      groupType: descriptor.groupType,
      ...(descriptor.buildContext ? { buildContext: structuredClone(descriptor.buildContext) } : {}),
      componentIndex: componentIndexes[0],
      componentIndexes,
      internallyConnected,
      replayRank,
    };
  });
  if (ownedIndexes.size !== bricks.length) throw new RangeError('Every brick must belong to exactly one moduleReplay module.');
  return groups;
}

function inventoryFor(bricks) {
  const groups = new Map();
  for (const brick of bricks) {
    const w = Math.min(brick.w, brick.d);
    const d = Math.max(brick.w, brick.d);
    const key = `${w}x${d}:${brick.color}`;
    const current = groups.get(key) ?? { key, w, d, color: brick.color, count: 0 };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => a.w - b.w || a.d - b.d || a.color.localeCompare(b.color));
}

function issue(code, message, brickIds, severity = 'warning') {
  return { code, severity, message, brickIds: [...brickIds] };
}

function reserveStepReferences(budget, step) {
  budget.used += step.newBrickIds.length + step.visibleBrickIds.length + step.highlightBrickIds.length;
  if (budget.used > MAX_PLAN_REFERENCES) {
    throw new RangeError(`Assembly instructions exceed the ${MAX_PLAN_REFERENCES}-reference output limit.`);
  }
}

function closestCandidate(candidates, bricks, anchor) {
  return orderedCandidates(candidates, bricks, anchor)[0];
}

function orderedCandidates(candidates, bricks, anchor) {
  return [...candidates].sort((a, b) => {
    if (anchor !== null) {
      const aa = bricks[a];
      const bb = bricks[b];
      const distanceA = Math.abs(aa.x - bricks[anchor].x) + Math.abs(aa.z - bricks[anchor].z) + Math.abs(aa.y - bricks[anchor].y);
      const distanceB = Math.abs(bb.x - bricks[anchor].x) + Math.abs(bb.z - bricks[anchor].z) + Math.abs(bb.y - bricks[anchor].y);
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    return compareBricks(bricks[a], bricks[b]);
  });
}

function lowestCourseFirst(candidates, bricks) {
  return [...candidates].sort((a, b) => bricks[a].y - bricks[b].y);
}

function selectWorkSurfacePatchTarget({ remaining, validPlaced, moduleSet, floorY, bricks, graph }) {
  const hasBondedCourse = [...validPlaced].some((index) => bricks[index].y > floorY);
  const targets = [...remaining].flatMap((index) => {
    if (bricks[index].y !== floorY + 1) return [];
    const directLower = [...graph.below[index].keys()].filter((lower) => moduleSet.has(lower));
    if (!directLower.length) return [];
    const missingBlockers = [...graph.blocksLower[index]].filter((lower) => remaining.has(lower));
    if (missingBlockers.some((lower) => !moduleSet.has(lower) || bricks[lower].y !== floorY)) return [];
    const attachedContacts = directLower.filter((lower) => validPlaced.has(lower)).length;
    if (hasBondedCourse && attachedContacts === 0) return [];
    if ([...graph.above[index]].some((upper) => validPlaced.has(upper))) return [];
    return [{ index, missingBlockers, attachedContacts, directContactCount: directLower.length }];
  });
  targets.sort((a, b) => a.missingBlockers.length - b.missingBlockers.length
    || b.attachedContacts - a.attachedContacts
    || b.directContactCount - a.directContactCount
    || compareBricks(bricks[a.index], bricks[b.index]));
  return targets[0]?.index ?? null;
}

function insertionBlockers(index, solidIndexes, graph) {
  return [...graph.above[index]].filter((otherIndex) => solidIndexes.has(otherIndex));
}

function recoverableUnderAttachment({
  upperIndex, moduleSet, remaining, placed, validPlaced, stepStartValid, priorScene, bricks, graph,
}) {
  const unfinishedLower = [...graph.blocksLower[upperIndex]].filter((index) => remaining.has(index));
  if (unfinishedLower.length !== 1) return null;
  const lowerIndex = unfinishedLower[0];
  const lower = bricks[lowerIndex];
  if (!moduleSet.has(lowerIndex) || lower.y < 1 || !graph.below[upperIndex].has(lowerIndex)) return null;
  if (graph.blocksLower[lowerIndex].size > 0) return null;
  const independentSupports = [...graph.below[upperIndex].keys()]
    .filter((index) => index !== lowerIndex && stepStartValid.has(index));
  if (!independentSupports.length) return null;
  const failedSupports = [...graph.below[upperIndex].keys()]
    .filter((index) => placed.has(index) && !validPlaced.has(index));
  if (failedSupports.length) return null;
  const solidIndexes = new Set([...priorScene, ...validPlaced]);
  if (insertionBlockers(upperIndex, solidIndexes, graph).length) return null;
  return lowerIndex;
}

function partTypeKey(brick) {
  return `${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}:${brick.color}`;
}

function fitsStepBatch(batch, index, bricks) {
  if (!batch.length) return true;
  const candidates = [...batch, index].map((brickIndex) => bricks[brickIndex]);
  if (candidates.some((brick) => brick.y !== candidates[0].y)) return false;
  if (new Set(candidates.map(partTypeKey)).size > MAX_STEP_PART_TYPES) return false;
  const minX = Math.min(...candidates.map((brick) => brick.x));
  const maxX = Math.max(...candidates.map((brick) => brick.x + brick.w));
  const minZ = Math.min(...candidates.map((brick) => brick.z));
  const maxZ = Math.max(...candidates.map((brick) => brick.z + brick.d));
  return maxX - minX <= MAX_STEP_LOCAL_SPAN && maxZ - minZ <= MAX_STEP_LOCAL_SPAN;
}

function footprintsFaceTouch(a, b) {
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const zOverlap = Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z);
  return (a.x + a.w === b.x || b.x + b.w === a.x) && zOverlap > 0
    || (a.z + a.d === b.z || b.z + b.d === a.z) && xOverlap > 0;
}

function fitsLocalProgressBatch(batch, index, bricks) {
  if (!fitsStepBatch(batch, index, bricks)) return false;
  if (!batch.length) return true;
  const candidate = bricks[index];
  return batch.every((brickIndex) => bricks[brickIndex].color === candidate.color)
    && batch.some((brickIndex) => footprintsFaceTouch(bricks[brickIndex], candidate));
}

function footprintDistance(a, b) {
  const xGap = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const zGap = Math.max(0, a.z - (b.z + b.d), b.z - (a.z + a.d));
  return xGap + zGap + Math.abs(a.y - b.y);
}

function horizontalFootprintGap(a, b) {
  const xGap = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const zGap = Math.max(0, a.z - (b.z + b.d), b.z - (a.z + a.d));
  return xGap + zGap;
}

function orderedLocalCandidates(candidates, bricks, anchor, assembled, graph, insertionDirectionFor, preferLocalFoundations) {
  const engagedStuds = (index) => {
    const contacts = insertionDirectionFor(index) === 'up' ? graph.directAbove[index] : graph.below[index];
    return [...contacts].reduce((sum, [other, studs]) => sum + (assembled.has(other) ? studs : 0), 0);
  };
  const lowCourseBricks = [...assembled].filter((index) => bricks[index].y <= 1);
  const nearbyFoundation = (index) => preferLocalFoundations && bricks[index].y === 0
    && lowCourseBricks.some((other) => horizontalFootprintGap(bricks[index], bricks[other]) <= MAX_FOUNDATION_LOOKAHEAD_GAP);
  return [...candidates].sort((a, b) => {
    const engagementA = engagedStuds(a);
    const engagementB = engagedStuds(b);
    const foundationA = nearbyFoundation(a);
    const foundationB = nearbyFoundation(b);
    if (foundationA !== foundationB) return foundationA ? -1 : 1;
    if (Boolean(engagementA) !== Boolean(engagementB)) return engagementB - engagementA;
    if (anchor !== null) {
      const distanceA = footprintDistance(bricks[a], bricks[anchor]);
      const distanceB = footprintDistance(bricks[b], bricks[anchor]);
      if (distanceA !== distanceB) return distanceA - distanceB;
    }
    if (!engagementA && !engagementB) {
      const areaA = bricks[a].w * bricks[a].d;
      const areaB = bricks[b].w * bricks[b].d;
      if (areaA !== areaB) return areaB - areaA;
    }
    if (engagementA !== engagementB) return engagementB - engagementA;
    return compareBricks(bricks[a], bricks[b]);
  });
}

function planModuleBuild({
  module, bricks, graph, priorScene, nextStepId, referenceBudget, allowUnderAttachments, preferLocalProgress,
  preferLocalFoundations,
}) {
  const moduleSet = new Set(module.indexes);
  const remaining = new Set(module.indexes);
  const placed = new Set();
  const validPlaced = new Set();
  const steps = [];
  const offline = module.kind !== 'grounded';
  const workSurfaceFloor = module.buildContext?.kind === 'work-surface' ? module.buildContext.floorY : null;
  const connectedPatchOrder = module.buildContext?.orderPolicy === 'connected-patches';
  const rectangularLayerOrder = module.buildContext?.orderPolicy === 'rectangular-layers';
  const buildsOnPriorScene = module.groupType === 'continuation';
  const completesFoundationByCourse = (workSurfaceFloor !== null && !connectedPatchOrder) || buildsOnPriorScene;
  const useLocalProgress = preferLocalProgress && !offline;
  const localFloor = Math.min(...module.indexes.map((index) => bricks[index].y));
  let anchor = null;
  let unresolved = false;
  let activeWorkSurfaceBond = null;
  const indexByBrickId = new Map(bricks.map(({ id }, index) => [id, index]));
  const rectangularGroups = rectangularLayerOrder
    ? createRectangularLayerGroups(module.indexes.map((index) => bricks[index]), {
      maxBricks: MAX_COHERENT_STEP_BRICKS,
      maxSpan: MAX_STEP_LOCAL_SPAN,
      maxPartTypes: MAX_STEP_PART_TYPES,
    }).map(({ brickIds }) => brickIds.map((id) => indexByBrickId.get(id)))
    : [];
  let rectangularGroupCursor = 0;
  const pendingUnderAttachments = new Map();

  while (remaining.size) {
    while (rectangularGroupCursor < rectangularGroups.length
      && rectangularGroups[rectangularGroupCursor].every((index) => !remaining.has(index))) {
      rectangularGroupCursor += 1;
    }
    const rectangularGroup = rectangularLayerOrder
      ? rectangularGroups[rectangularGroupCursor].filter((index) => remaining.has(index))
      : [];
    const rectangularGroupSet = new Set(rectangularGroup);
    const rectangularRank = new Map(rectangularGroup.map((index, rank) => [index, rank]));
    const batch = [];
    const batchIssues = [];
    let batchKind = null;
    let batchDirection = null;
    const stepStartValid = new Set(validPlaced);
    while (batch.length < MAX_COHERENT_STEP_BRICKS && remaining.size) {
      const awaitsNextStep = [...pendingUnderAttachments]
        .some(([lowerIndex, upperIndex]) => remaining.has(lowerIndex)
          && validPlaced.has(upperIndex) && !stepStartValid.has(upperIndex));
      if (batch.length && awaitsNextStep) break;
      const downwardSupported = [...remaining].filter((index) => {
        const internalBelow = [...graph.below[index].keys()].filter((lower) => moduleSet.has(lower));
        return internalBelow.some((lower) => stepStartValid.has(lower))
          || (buildsOnPriorScene && [...graph.below[index].keys()].some((lower) => priorScene.has(lower)))
          || (!offline && bricks[index].y === 0)
          || (offline && internalBelow.length === 0
            && (workSurfaceFloor === null || bricks[index].y === workSurfaceFloor));
      });
      const upwardSupported = !offline && allowUnderAttachments ? [...remaining].filter((index) => {
        const upperIndex = pendingUnderAttachments.get(index);
        return upperIndex !== undefined && stepStartValid.has(upperIndex)
          && graph.directAbove[index].has(upperIndex) && graph.blocksLower[index].size === 0;
      }) : [];
      const supported = [...new Set([...downwardSupported, ...upwardSupported])];
      if (supported.length === 0 && batch.length && batchKind === 'build') break;
      const pathPreserving = supported.filter((index) => ![...graph.blocksLower[index]].some((unfinished) => remaining.has(unfinished)));
      const recoverableBridges = new Map();
      if (!offline && allowUnderAttachments && pathPreserving.length === 0) for (const upperIndex of downwardSupported) {
        const lowerIndex = recoverableUnderAttachment({
          upperIndex, moduleSet, remaining, placed, validPlaced, stepStartValid, priorScene, bricks, graph,
        });
        if (lowerIndex !== null) recoverableBridges.set(upperIndex, lowerIndex);
      }
      const lowerObstacles = new Set();
      if (supported.length && !pathPreserving.length && !recoverableBridges.size) for (const index of supported) {
        for (const lower of graph.blocksLower[index]) if (remaining.has(lower)) lowerObstacles.add(lower);
      }
      let forced = supported.length === 0 || lowerObstacles.size > 0;
      let closesFuturePath = !forced && pathPreserving.length === 0 && recoverableBridges.size === 0;
      const candidates = pathPreserving.length ? pathPreserving : recoverableBridges.size ? recoverableBridges.keys()
        : lowerObstacles.size ? lowerObstacles : forced ? remaining : supported;
      let patchCandidates = [...candidates];
      if (connectedPatchOrder) {
        if (activeWorkSurfaceBond !== null && !remaining.has(activeWorkSurfaceBond)) activeWorkSurfaceBond = null;
        if (activeWorkSurfaceBond === null) {
          activeWorkSurfaceBond = selectWorkSurfacePatchTarget({
            remaining,
            validPlaced,
            moduleSet,
            floorY: workSurfaceFloor,
            bricks,
            graph,
          });
        }
        if (activeWorkSurfaceBond !== null) {
          const missingFloor = [...graph.blocksLower[activeWorkSurfaceBond]]
            .filter((lower) => remaining.has(lower) && bricks[lower].y === workSurfaceFloor);
          if (missingFloor.length) {
            const prerequisiteSet = new Set(missingFloor);
            patchCandidates = patchCandidates.filter((candidate) => prerequisiteSet.has(candidate));
          } else {
            patchCandidates = patchCandidates.filter((candidate) => candidate === activeWorkSurfaceBond);
          }
          if (!patchCandidates.length) {
            if (batch.length) break;
            activeWorkSurfaceBond = null;
            patchCandidates = [...candidates];
          }
        }
      }
      if (rectangularLayerOrder) {
        const scheduled = patchCandidates.filter((candidate) => rectangularGroupSet.has(candidate));
        if (scheduled.length) {
          patchCandidates = scheduled;
        } else {
          if (batch.length) break;
          patchCandidates = rectangularGroup;
          forced = true;
          closesFuturePath = false;
        }
      }
      const insertionDirectionFor = (candidate) => upwardSupported.includes(candidate) ? 'up' : 'down';
      const directionCandidates = batchDirection === null ? patchCandidates
        : patchCandidates.filter((candidate) => insertionDirectionFor(candidate) === batchDirection);
      const assembled = offline ? stepStartValid : new Set([...priorScene, ...stepStartValid]);
      const useLocalBatch = useLocalProgress && batchKind !== 'unresolved';
      const heuristicOrder = rectangularLayerOrder
        ? [...directionCandidates].sort((a, b) => rectangularRank.get(a) - rectangularRank.get(b))
        : useLocalBatch
        ? orderedLocalCandidates(directionCandidates, bricks, anchor, assembled, graph, insertionDirectionFor, preferLocalFoundations)
        : orderedCandidates(directionCandidates, bricks, anchor);
      const heuristicRank = new Map(heuristicOrder.map((index, rank) => [index, rank]));
      const locallyOrdered = module.replayRank
        ? [...directionCandidates].sort((a, b) => module.replayRank.get(a) - module.replayRank.get(b)
          || heuristicRank.get(a) - heuristicRank.get(b))
        : heuristicOrder;
      const sameDirection = completesFoundationByCourse ? lowestCourseFirst(locallyOrdered, bricks) : locallyOrdered;
      if (batch.length && sameDirection.length === 0) break;
      const coherent = batch.length ? sameDirection.filter((candidate) => (useLocalBatch
        ? fitsLocalProgressBatch(batch, candidate, bricks) : fitsStepBatch(batch, candidate, bricks))) : sameDirection;
      if (batch.length && useLocalBatch && coherent.length === 0) break;
      if (batch.length && connectedPatchOrder && coherent.length === 0) break;
      if (!useLocalBatch && batch.length >= MAX_STEP_BRICKS && coherent.length === 0) break;
      const index = (coherent.length ? coherent : sameDirection)[0];
      const completesWorkSurfaceBond = connectedPatchOrder && index === activeWorkSurfaceBond;
      const brick = bricks[index];
      const insertionDirection = insertionDirectionFor(index);
      const blockers = insertionDirection === 'up' ? [...graph.blocksLower[index]]
        .filter((otherIndex) => (offline ? validPlaced : new Set([...priorScene, ...validPlaced])).has(otherIndex))
        : insertionBlockers(index, offline ? validPlaced : new Set([...priorScene, ...validPlaced]), graph);
      const additionIssues = [];
      let additionKind = 'build';

      if (blockers.length) {
        additionKind = 'unresolved';
        additionIssues.push(issue('blocked-insertion', 'A previously placed brick blocks the bounded vertical insertion path.', [brick.id, ...blockers.map((blocker) => bricks[blocker].id)], 'error'));
      } else if (forced) {
        additionKind = 'unresolved';
        const internalBelow = [...graph.below[index].keys()].filter((lower) => moduleSet.has(lower));
        const code = internalBelow.length ? 'unresolved-prerequisite' : 'unsupported-addition';
        const message = internalBelow.length
          ? 'This brick depends on an earlier unresolved addition, so it cannot be shown as successfully supported.'
          : 'No already assembled brick provides stud support for this elevated addition.';
        additionIssues.push(issue(code, message, [brick.id, ...internalBelow.map((lower) => bricks[lower].id)], 'error'));
      } else if (closesFuturePath) {
        additionKind = 'unresolved';
        additionIssues.push(issue('future-path-blocked', 'Every currently supported choice would close a vertical path needed by an unfinished lower brick.', [brick.id], 'error'));
      } else if ([...graph.below[index].keys()].some((lower) => moduleSet.has(lower) && placed.has(lower) && !validPlaced.has(lower))) {
        const failedSupports = [...graph.below[index].keys()].filter((lower) => moduleSet.has(lower) && placed.has(lower) && !validPlaced.has(lower));
        additionKind = 'unresolved';
        additionIssues.push(issue('unresolved-prerequisite', 'This addition contacts an earlier unresolved support and cannot be shown as successfully captured.', [brick.id, ...failedSupports.map((lower) => bricks[lower].id)], 'error'));
      } else if (offline && workSurfaceFloor === null
        && ![...graph.below[index].keys()].some((lower) => moduleSet.has(lower))) {
        additionIssues.push(issue('temporary-hold', 'Start this handled module on a flat work surface or hold its base; stability is not verified.', [brick.id]));
      } else if (brick.y > 0) {
        const contacts = insertionDirection === 'up' ? graph.directAbove[index] : graph.below[index];
        const supports = buildsOnPriorScene ? new Set([...priorScene, ...stepStartValid]) : stepStartValid;
        const engagedStuds = [...contacts].reduce((sum, [support, studs]) => sum + (supports.has(support) ? studs : 0), 0);
        if (engagedStuds > 0 && engagedStuds / (brick.w * brick.d) < 0.25) {
          additionIssues.push(issue('limited-support', 'This step engages less than one quarter of the brick footprint; strength is not verified.', [brick.id]));
        }
      }

      if (batchKind !== null && (batchKind !== additionKind || batchDirection !== insertionDirection)) break;
      batchKind = additionKind;
      batchDirection = insertionDirection;
      batch.push(index);
      batchIssues.push(...additionIssues);
      remaining.delete(index);
      placed.add(index);
      if (additionKind === 'build') validPlaced.add(index);
      if (additionKind === 'build' && recoverableBridges.has(index)) {
        pendingUnderAttachments.set(recoverableBridges.get(index), index);
      }
      if (insertionDirection === 'up') pendingUnderAttachments.delete(index);
      anchor = index;
      if (additionKind === 'unresolved') unresolved = true;
      if (completesWorkSurfaceBond) {
        activeWorkSurfaceBond = null;
        break;
      }
      if (rectangularLayerOrder && rectangularGroup.every((candidate) => !remaining.has(candidate))) break;
    }

    const newBrickIds = batch.map((index) => bricks[index].id);
    const visibleBrickIds = [...(buildsOnPriorScene ? priorScene : []), ...placed].map((index) => bricks[index].id);
    const step = {
      id: `step-${nextStepId()}`,
      moduleId: module.id,
      label: `${module.label} · add ${newBrickIds.length} ${newBrickIds.length === 1 ? 'brick' : 'bricks'}`,
      kind: batchKind,
      newBrickIds,
      visibleBrickIds,
      highlightBrickIds: newBrickIds,
      issues: batchIssues,
      ...(batchDirection === 'up' ? { insertionDirection: 'up' } : {}),
    };
    reserveStepReferences(referenceBudget, step);
    steps.push(step);
  }
  return { steps, unresolved, validIndexes: validPlaced };
}

function errorSignature(step) {
  return [...new Set(step.issues.filter(({ severity }) => severity === 'error').map(({ code }) => code))].sort().join(',');
}

function coalesceGroundedSteps(steps, module, bricks, preferLocalProgress) {
  if (module.kind !== 'grounded') return steps;
  const indexById = new Map(bricks.map((brick, index) => [brick.id, index]));
  const paced = [];
  for (const step of steps) {
    const prior = paced.at(-1);
    const combinedIds = prior ? [...prior.newBrickIds, ...step.newBrickIds] : [];
    const combinedIndexes = combinedIds.map((id) => indexById.get(id));
    const courses = new Set(combinedIndexes.map((index) => bricks[index].y));
    const requireConnectedPatch = preferLocalProgress && step.kind !== 'unresolved';
    const withinLocalBounds = combinedIndexes.every((index, position) => (requireConnectedPatch
      ? fitsLocalProgressBatch(combinedIndexes.slice(0, position), index, bricks)
      : fitsStepBatch(combinedIndexes.slice(0, position), index, bricks)));
    const mergeable = prior
      && (step.kind === 'build' || step.kind === 'unresolved')
      && prior.kind === step.kind
      && (prior.insertionDirection ?? 'down') === (step.insertionDirection ?? 'down')
      && (step.kind !== 'unresolved' || errorSignature(prior) === errorSignature(step))
      && combinedIds.length <= MAX_COHERENT_STEP_BRICKS
      && courses.size === 1
      && withinLocalBounds;
    if (!mergeable) {
      paced.push({ ...step });
      continue;
    }
    prior.newBrickIds = combinedIds;
    prior.visibleBrickIds = step.visibleBrickIds;
    prior.highlightBrickIds = combinedIds;
    prior.issues = [...prior.issues, ...step.issues];
    prior.label = `${module.label} · add ${combinedIds.length} bricks`;
  }
  return paced;
}

function joinAssessment(module, bricks, graph, priorScene) {
  const moduleSet = new Set(module.indexes);
  const crossingEdges = graph.indexEdges.filter(({ lower, upper }) => {
    if (moduleSet.has(lower) === moduleSet.has(upper)) return false;
    const outside = moduleSet.has(lower) ? upper : lower;
    return priorScene.has(outside);
  });
  let downwardCrossingEdges = module.buildContext?.kind === 'work-surface'
    ? graph.indexEdges.filter(({ lower, upper }) => !moduleSet.has(lower) && moduleSet.has(upper) && priorScene.has(lower))
    : crossingEdges;
  let supportGroups = [];
  if (module.buildContext?.kind === 'work-surface') {
    const adjacency = studAdjacency(bricks.length, graph);
    const contacted = new Set(downwardCrossingEdges.map(({ lower }) => lower));
    const assigned = new Set();
    for (const start of [...contacted].sort((a, b) => a - b)) {
      if (assigned.has(start)) continue;
      const component = new Set([start]);
      const pending = [start];
      assigned.add(start);
      while (pending.length) {
        const current = pending.pop();
        for (const next of adjacency[current]) if (priorScene.has(next) && !assigned.has(next)) {
          assigned.add(next);
          component.add(next);
          pending.push(next);
        }
      }
      if (![...component].some((index) => bricks[index].y === 0)) continue;
      const contacts = downwardCrossingEdges.filter(({ lower }) => component.has(lower));
      supportGroups.push({
        brickIds: [...component].sort((a, b) => a - b).map((index) => bricks[index].id),
        contacts: contacts.map(({ lower, upper, studs }) => ({
          supportBrickId: bricks[lower].id,
          bandBrickId: bricks[upper].id,
          studs,
        })),
      });
    }
    const groundedContactIds = new Set(supportGroups.flatMap(({ contacts }) => contacts.map(({ supportBrickId }) => supportBrickId)));
    downwardCrossingEdges = downwardCrossingEdges.filter(({ lower }) => groundedContactIds.has(bricks[lower].id));
  }
  const blockers = new Set();
  for (const index of module.indexes) for (const blocker of insertionBlockers(index, priorScene, graph)) blockers.add(blocker);
  const internallyConnected = module.buildContext?.kind !== 'work-surface'
    || connectedWithin(new Set(module.indexes), studAdjacency(bricks.length, graph));
  const studs = downwardCrossingEdges.reduce((sum, edge) => sum + edge.studs, 0);
  return { crossingEdges: downwardCrossingEdges, blockers: [...blockers], internallyConnected, studs, supportGroups };
}

function addJoinStep({ module, bricks, graph, priorScene, visibleScene, buildResolved, nextStepId, referenceBudget }) {
  const assessment = joinAssessment(module, bricks, graph, priorScene);
  if (module.buildContext?.kind === 'work-surface') module.joinContext = {
    direction: 'down',
    supportGroups: assessment.supportGroups,
    requiresAlignment: assessment.supportGroups.length > 1,
  };
  const moduleIds = module.indexes.map((index) => bricks[index].id);
  const visibleBrickIds = [...visibleScene].map((index) => bricks[index].id).concat(moduleIds);
  const issues = [];
  let kind = 'join';
  if (module.componentIndexes.length > 1 || module.internallyConnected === false) {
    kind = 'unresolved';
    issues.push(issue('disconnected-clusters', 'This review group contains multiple detached stud components; it is not a proposed handled subassembly.', moduleIds, 'error'));
  }
  if (!assessment.internallyConnected) {
    kind = 'unresolved';
    issues.push(issue('disconnected-work-surface', 'The work-surface band is not one internally stud-connected assembly.', moduleIds, 'error'));
  }
  if (!buildResolved) {
    kind = 'unresolved';
    issues.push(issue('unresolved-prerequisite', 'The module has unresolved build additions and cannot be shown as successfully joined.', moduleIds, 'error'));
  }
  if (assessment.studs === 0) {
    kind = 'unresolved';
    issues.push(issue('no-stud-engagement', 'No stud connection joins this handled module to the assembled model.', moduleIds, 'error'));
  }
  if (assessment.blockers.length) {
    kind = 'unresolved';
    issues.push(issue('blocked-module-insertion', 'The assembled model blocks this module from moving vertically into its final position.', [...moduleIds, ...assessment.blockers.map((index) => bricks[index].id)], 'error'));
  }
  const step = {
      id: `step-${nextStepId()}`,
      moduleId: module.id,
      label: kind === 'join' ? `Join ${module.label}` : `Unresolved join · ${module.label}`,
      kind,
      newBrickIds: [],
      visibleBrickIds,
      highlightBrickIds: moduleIds,
      issues,
      ...(module.joinContext ? { joinContext: structuredClone(module.joinContext) } : {}),
  };
  reserveStepReferences(referenceBudget, step);
  return {
    step,
    resolved: kind === 'join',
    studs: assessment.studs,
    blocked: assessment.blockers.length > 0,
  };
}

export function createAssemblyPlan({
  brickModel,
  rawModel = null,
  sourceProgram = null,
  allowUnderAttachments = false,
  preferLocalProgress = false,
  preferLocalFoundations = false,
  workSurfaceBrickIds = null,
  workSurfaceOrder = 'course-first',
  moduleReplay = null,
} = {}) {
  const started = now();
  void rawModel;
  void sourceProgram;
  if (typeof allowUnderAttachments !== 'boolean') throw new TypeError('allowUnderAttachments must be a boolean.');
  if (typeof preferLocalProgress !== 'boolean') throw new TypeError('preferLocalProgress must be a boolean.');
  if (typeof preferLocalFoundations !== 'boolean') throw new TypeError('preferLocalFoundations must be a boolean.');
  if (workSurfaceBrickIds !== null && !Array.isArray(workSurfaceBrickIds)) {
    throw new TypeError('workSurfaceBrickIds must be an array when provided.');
  }
  if (moduleReplay !== null && workSurfaceBrickIds !== null) {
    throw new RangeError('moduleReplay cannot be combined with workSurfaceBrickIds.');
  }
  if (!['course-first', 'connected-patches', 'rectangular-layers'].includes(workSurfaceOrder)) {
    throw new RangeError("workSurfaceOrder must be 'course-first', 'connected-patches', or 'rectangular-layers'.");
  }
  const bricks = validateAndIdentify(brickModel);
  const graphData = buildContactGraph(bricks);
  let groups;
  if (moduleReplay !== null) {
    groups = replayModuleGroups(moduleReplay, bricks, graphData);
  } else {
    const derivedGroups = deriveModuleGroups(bricks, graphData);
    const smallFloating = derivedGroups.filter((group) => group.kind === 'floating' && group.indexes.length <= 8);
    groups = derivedGroups.filter((group) => !smallFloating.includes(group));
    if (smallFloating.length) groups.push({
      indexes: smallFloating.flatMap(({ indexes }) => indexes).sort((a, b) => compareBricks(bricks[a], bricks[b])),
      kind: 'floating',
      groupType: 'detached-parts',
      componentIndex: Math.min(...smallFloating.map(({ componentIndex }) => componentIndex)),
      componentIndexes: smallFloating.map(({ componentIndex }) => componentIndex),
    });
    groups.sort((a, b) => {
      const groundedA = graphData.componentObjects[a.componentIndex].grounded;
      const groundedB = graphData.componentObjects[b.componentIndex].grounded;
      if (groundedA !== groundedB) return groundedA ? -1 : 1;
      if (!groundedA && !groundedB) return b.indexes.length - a.indexes.length
        || compareBricks(bricks[a.indexes[0]], bricks[b.indexes[0]]);
      const familySizeA = graphData.components[a.componentIndex].length;
      const familySizeB = graphData.components[b.componentIndex].length;
      if (familySizeA !== familySizeB) return familySizeB - familySizeA;
      if (a.componentIndex !== b.componentIndex) return a.componentIndex - b.componentIndex;
      const coreA = a.kind === 'grounded';
      const coreB = b.kind === 'grounded';
      if (coreA !== coreB) return coreA ? -1 : 1;
      if (a.groupType !== b.groupType) return a.groupType === 'branch' ? -1 : 1;
      return b.indexes.length - a.indexes.length || compareBricks(bricks[a.indexes[0]], bricks[b.indexes[0]]);
    });
    if (workSurfaceBrickIds !== null) {
      groups = splitWorkSurfaceGroup(groups, workSurfaceBrickIds, bricks, graphData, workSurfaceOrder);
    }
  }
  let moduleNumber = 0;
  let buildAreaNumber = 0;
  let branchNumber = 0;
  let detailNumber = 0;
  let floatingNumber = 0;
  let workSurfaceNumber = 0;
  const modules = groups.map((group) => {
    moduleNumber += 1;
    if (group.kind === 'grounded' && group.groupType !== 'continuation') buildAreaNumber += 1;
    if (group.groupType === 'branch') branchNumber += 1;
    if (group.groupType === 'color') detailNumber += 1;
    if (group.kind === 'floating') floatingNumber += 1;
    if (group.groupType === 'work-surface') workSurfaceNumber += 1;
    const label = group.label ?? (group.groupType === 'branch' ? `Upper section ${branchNumber}`
      : group.groupType === 'color' ? `Color detail ${detailNumber}`
      : group.groupType === 'detached-parts' ? 'Unresolved detached parts'
      : group.groupType === 'work-surface' ? `Work-surface section ${workSurfaceNumber}`
      : group.groupType === 'continuation' ? `Continue build area ${buildAreaNumber}`
      : group.kind === 'floating' ? `Unresolved cluster ${floatingNumber}`
        : `Build area ${buildAreaNumber}`);
    return {
      id: group.id ?? `module-${moduleNumber}`,
      label,
      brickIds: group.indexes.map((index) => bricks[index].id),
      status: group.kind === 'floating' ? 'unresolved' : 'ready',
      kind: group.kind,
      indexes: group.indexes,
      componentIndex: group.componentIndex,
      componentIndexes: group.componentIndexes ?? [group.componentIndex],
      internallyConnected: group.internallyConnected,
      replayRank: group.replayRank,
      groupType: group.groupType,
      ...(group.buildContext ? { buildContext: { ...group.buildContext } } : {}),
      componentIds: (group.componentIndexes ?? [group.componentIndex]).map((index) => graphData.componentObjects[index].id),
    };
  });

  let stepNumber = 0;
  const nextStepId = () => ++stepNumber;
  const referenceBudget = { used: 0 };
  const steps = [];
  const visibleScene = new Set();
  const validScene = new Set();
  let validJoinCount = 0;
  let blockedJoinCount = 0;
  let joinStudCount = 0;

  for (const module of modules) {
    const build = planModuleBuild({
      module,
      bricks,
      graph: graphData,
      priorScene: validScene,
      nextStepId,
      referenceBudget,
      allowUnderAttachments,
      preferLocalProgress,
      preferLocalFoundations,
    });
    steps.push(...coalesceGroundedSteps(build.steps, module, bricks, preferLocalProgress));
    if (build.unresolved) module.status = 'unresolved';

    if (module.kind === 'grounded') {
      for (const index of module.indexes) visibleScene.add(index);
      for (const index of build.validIndexes) validScene.add(index);
      continue;
    }
    const joined = addJoinStep({
      module,
      bricks,
      graph: graphData,
      priorScene: validScene,
      visibleScene,
      buildResolved: !build.unresolved,
      nextStepId,
      referenceBudget,
    });
    steps.push(joined.step);
    joinStudCount += joined.studs;
    if (joined.resolved && !build.unresolved) validJoinCount += 1;
    else module.status = 'unresolved';
    if (joined.blocked) blockedJoinCount += 1;
    for (const index of module.indexes) visibleScene.add(index);
    if (joined.resolved && !build.unresolved) for (const index of module.indexes) validScene.add(index);
  }

  const introduced = new Map();
  for (const step of steps) for (const id of step.newBrickIds) introduced.set(id, (introduced.get(id) ?? 0) + 1);
  const coverageComplete = bricks.every((brick) => introduced.get(brick.id) === 1)
    && [...introduced.keys()].every((id) => bricks.some((brick) => brick.id === id));
  const unresolvedIds = new Set();
  for (const step of steps) if (step.kind === 'unresolved') {
    for (const id of step.newBrickIds) unresolvedIds.add(id);
    if (step.newBrickIds.length === 0) for (const id of step.highlightBrickIds) unresolvedIds.add(id);
  }
  const temporaryHoldStepCount = steps.filter((step) => step.issues.some(({ code }) => code === 'temporary-hold')).length;
  const naiveBottomUpSupportViolationCount = graphData.below.filter((contacts, index) => bricks[index].y > 0 && contacts.size === 0).length;

  const publicModules = modules.map(({
    indexes: _indexes,
    componentIndex: _componentIndex,
    componentIndexes: _componentIndexes,
    internallyConnected: _internallyConnected,
    replayRank: _replayRank,
    groupType,
    ...module
  }) => ({
    ...module,
    ...((workSurfaceBrickIds !== null || moduleReplay !== null) && groupType ? { groupType } : {}),
  }));
  return {
    version: 1,
    inventory: inventoryFor(bricks),
    bricks,
    modules: publicModules,
    steps,
    graph: { edges: graphData.edges, components: graphData.componentObjects },
    stats: {
      brickCount: bricks.length,
      stepCount: steps.length,
      moduleCount: modules.length,
      unresolvedStepCount: steps.filter((step) => step.kind === 'unresolved').length,
      unresolvedBrickCount: unresolvedIds.size,
      coverageComplete,
      studConnectionCount: graphData.edges.length,
      componentCount: graphData.components.length,
      validJoinCount,
      blockedJoinCount,
      joinStudCount,
      temporaryHoldStepCount,
      upwardInsertionBrickCount: steps.reduce((sum, step) => sum
        + (step.insertionDirection === 'up' ? step.newBrickIds.length : 0), 0),
      rootFailureCount: steps.filter((step) => step.issues.some(({ code }) => code === 'unsupported-addition'))
        .reduce((sum, step) => sum + step.issues.filter(({ code }) => code === 'unsupported-addition')
          .reduce((issueSum, entry) => issueSum + entry.brickIds.length, 0), 0),
      dependentUnresolvedCount: steps.reduce((sum, step) => sum
        + step.issues.filter(({ code }) => code === 'unresolved-prerequisite').length, 0),
      naiveBottomUpSupportViolationCount,
      maxBricksPerStep: MAX_COHERENT_STEP_BRICKS,
      planReferenceCount: steps.reduce((sum, step) => sum
        + step.newBrickIds.length + step.visibleBrickIds.length + step.highlightBrickIds.length, 0),
      planningMs: now() - started,
    },
    limitations: [
      'Module names are deterministic geometry/color labels; source operations are not treated as semantic names.',
      'Separate grounded groups can represent separate objects or unjoined decoration; subject intent is not verified.',
      'Small detached stud components may be collected into one unresolved review group; that grouping is not a freestanding-module claim.',
      'Only upright bricks and bounded vertical insertion are planned; other motions remain unresolved.',
      ...(allowUnderAttachments ? ['Upward under-attachments require a clear floor-to-target sweep and an independently supported upper brick; hand clearance and clutch strength remain unverified.'] : []),
      ...((workSurfaceBrickIds !== null || modules.some(({ buildContext }) => buildContext?.kind === 'work-surface')) ? [
        'A selected work-surface band may begin only at its lowest course on a flat table; its validated downward join still does not establish hand clearance, clutch strength, or physical stability.',
        'The lower work-surface remainder may contain independently positioned grounded supports; it is not represented as one rigid subassembly.',
      ] : []),
      'Temporary holding and work-surface assumptions are reported but physical stability and strength are not verified.',
      'Footprint and color inventory entries are geometric groups, not claims of catalog availability.',
      'The planner does not modify the raw model, source program, accepted shape, scale, colors, or brick placements.',
    ],
  };
}
