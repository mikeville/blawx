const MAX_PARTITION_NODES = 10_000;
const MAX_PARTITION_DEPTH = 128;

function assertPositiveInteger(name, value) {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} must be a positive integer.`);
}

function normalizedPartType(brick) {
  return `${Math.min(brick.w, brick.d)}x${Math.max(brick.w, brick.d)}:${brick.color}`;
}

function compareAlong(brickA, brickB, longAxis) {
  const shortAxis = longAxis === 'x' ? 'z' : 'x';
  const longSize = longAxis === 'x' ? 'w' : 'd';
  const shortSize = longAxis === 'x' ? 'd' : 'w';
  return brickA[shortAxis] - brickB[shortAxis]
    || brickA[shortSize] - brickB[shortSize]
    || brickA[longAxis] - brickB[longAxis]
    || brickA[longSize] - brickB[longSize]
    || brickA.id.localeCompare(brickB.id);
}

function boundsFor(bricks) {
  const minX = Math.min(...bricks.map(({ x }) => x));
  const maxX = Math.max(...bricks.map(({ x, w }) => x + w));
  const minZ = Math.min(...bricks.map(({ z }) => z));
  const maxZ = Math.max(...bricks.map(({ z, d }) => z + d));
  return { minX, maxX, minZ, maxZ, width: maxX - minX, depth: maxZ - minZ };
}

function publicGroup(bricks, course) {
  const bounds = boundsFor(bricks);
  const occupiedArea = bricks.reduce((sum, brick) => sum + brick.w * brick.d, 0);
  return {
    brickIds: bricks.map(({ id }) => id),
    course,
    bounds,
    fillRatio: occupiedArea / (bounds.width * bounds.depth),
  };
}

function groupFits(bricks, limits) {
  const bounds = boundsFor(bricks);
  return bricks.length <= limits.maxBricks
    && bounds.width <= limits.maxSpan
    && bounds.depth <= limits.maxSpan
    && new Set(bricks.map(normalizedPartType)).size <= limits.maxPartTypes;
}

function groupPressure(bricks, limits) {
  const bounds = boundsFor(bricks);
  return Math.max(
    bricks.length / limits.maxBricks,
    bounds.width / limits.maxSpan,
    bounds.depth / limits.maxSpan,
    new Set(bricks.map(normalizedPartType)).size / limits.maxPartTypes,
  );
}

function cleanCuts(bricks, axis) {
  const size = axis === 'x' ? 'w' : 'd';
  const ordered = [...bricks].sort((a, b) => a[axis] - b[axis]
    || a[axis] + a[size] - b[axis] - b[size]
    || a.id.localeCompare(b.id));
  const cuts = new Set();
  let prefixEnd = ordered[0][axis] + ordered[0][size];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    prefixEnd = Math.max(prefixEnd, ordered[index][axis] + ordered[index][size]);
    const nextStart = ordered[index + 1][axis];
    if (prefixEnd <= nextStart) cuts.add(nextStart);
  }
  return [...cuts].sort((a, b) => a - b);
}

function spatialSweep(bricks, longAxis, limits) {
  const ordered = [...bricks].sort((a, b) => compareAlong(a, b, longAxis));
  const groups = [];
  let current = [];
  for (const brick of ordered) {
    const candidate = [...current, brick];
    if (!groupFits(candidate, limits) && current.length) {
      groups.push(current);
      current = [brick];
    } else if (!groupFits(candidate, limits)) {
      throw new RangeError(`Brick ${brick.id} cannot be placed in a bounded rectangular layer group.`);
    } else {
      current = candidate;
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

function guillotinePartition(bricks, longAxis, limits, budget, depth = 0) {
  if (groupFits(bricks, limits)) return [bricks];
  budget.used += 1;
  if (budget.used > MAX_PARTITION_NODES || depth >= MAX_PARTITION_DEPTH) {
    return spatialSweep(bricks, longAxis, limits);
  }
  const preferredCutAxis = longAxis === 'x' ? 'z' : 'x';
  const choices = [];
  for (const axis of ['x', 'z']) for (const cut of cleanCuts(bricks, axis)) {
    const size = axis === 'x' ? 'w' : 'd';
    const before = bricks.filter((brick) => brick[axis] + brick[size] <= cut);
    const after = bricks.filter((brick) => brick[axis] >= cut);
    if (!before.length || !after.length) continue;
    choices.push({
      axis,
      cut,
      before,
      after,
      groupFloor: Math.ceil(before.length / limits.maxBricks) + Math.ceil(after.length / limits.maxBricks),
      pressure: Math.max(groupPressure(before, limits), groupPressure(after, limits)),
      imbalance: Math.abs(before.length - after.length),
    });
  }
  choices.sort((a, b) => a.groupFloor - b.groupFloor
    || a.pressure - b.pressure
    || Number(a.axis !== preferredCutAxis) - Number(b.axis !== preferredCutAxis)
    || a.imbalance - b.imbalance
    || a.axis.localeCompare(b.axis)
    || a.cut - b.cut);
  if (!choices.length) return spatialSweep(bricks, longAxis, limits);
  const chosen = choices[0];
  return [
    ...guillotinePartition(chosen.before, longAxis, limits, budget, depth + 1),
    ...guillotinePartition(chosen.after, longAxis, limits, budget, depth + 1),
  ];
}

function adjoiningRectangle(a, b) {
  const boundsA = boundsFor(a);
  const boundsB = boundsFor(b);
  const sameX = boundsA.minX === boundsB.minX && boundsA.maxX === boundsB.maxX;
  const sameZ = boundsA.minZ === boundsB.minZ && boundsA.maxZ === boundsB.maxZ;
  return sameX && (boundsA.maxZ === boundsB.minZ || boundsB.maxZ === boundsA.minZ)
    || sameZ && (boundsA.maxX === boundsB.minX || boundsB.maxX === boundsA.minX);
}

function packAdjoining(groups, limits) {
  const packed = groups.map((group) => [...group]);
  let changed = true;
  while (changed) {
    changed = false;
    for (let left = 0; left < packed.length && !changed; left += 1) {
      for (let right = left + 1; right < packed.length; right += 1) {
        const combined = [...packed[left], ...packed[right]];
        if (!adjoiningRectangle(packed[left], packed[right]) || !groupFits(combined, limits)) continue;
        packed.splice(right, 1);
        packed[left] = combined;
        changed = true;
        break;
      }
    }
  }
  return packed;
}

function compareGroupPosition(a, b, longAxis) {
  const boundsA = boundsFor(a);
  const boundsB = boundsFor(b);
  const shortStartA = longAxis === 'x' ? boundsA.minZ : boundsA.minX;
  const shortStartB = longAxis === 'x' ? boundsB.minZ : boundsB.minX;
  const longStartA = longAxis === 'x' ? boundsA.minX : boundsA.minZ;
  const longStartB = longAxis === 'x' ? boundsB.minX : boundsB.minZ;
  return shortStartA - shortStartB || longStartA - longStartB
    || a.map(({ id }) => id).sort().join(',').localeCompare(b.map(({ id }) => id).sort().join(','));
}

export function createRectangularLayerGroups(bricks, {
  maxBricks = 12,
  maxSpan = 24,
  maxPartTypes = 4,
} = {}) {
  if (!Array.isArray(bricks)) throw new TypeError('bricks must be an array.');
  assertPositiveInteger('maxBricks', maxBricks);
  assertPositiveInteger('maxSpan', maxSpan);
  assertPositiveInteger('maxPartTypes', maxPartTypes);
  if (!bricks.length) return [];

  const ids = new Set();
  for (const [index, brick] of bricks.entries()) {
    if (!brick || typeof brick !== 'object' || Array.isArray(brick)) throw new TypeError(`Brick ${index} must be an object.`);
    if (typeof brick.id !== 'string' || !brick.id) throw new TypeError(`Brick ${index} id must be a nonempty string.`);
    if (ids.has(brick.id)) throw new RangeError(`Duplicate brick ID ${brick.id}.`);
    ids.add(brick.id);
    for (const field of ['x', 'y', 'z', 'w', 'd']) {
      if (!Number.isSafeInteger(brick[field])) throw new TypeError(`Brick ${index} ${field} must be a safe integer.`);
    }
    if (brick.w < 1 || brick.d < 1) throw new RangeError(`Brick ${brick.id} must have a positive footprint.`);
    if (typeof brick.color !== 'string' || !brick.color) throw new TypeError(`Brick ${index} color must be a nonempty string.`);
    if (brick.w > maxSpan || brick.d > maxSpan) {
      throw new RangeError(`Brick ${brick.id} cannot fit within the ${maxSpan}-stud group span.`);
    }
  }

  const courses = new Map();
  for (const brick of bricks) {
    if (!courses.has(brick.y)) courses.set(brick.y, []);
    courses.get(brick.y).push(brick);
  }

  const groups = [];
  const limits = { maxBricks, maxSpan, maxPartTypes };
  const partitionBudget = { used: 0 };
  for (const course of [...courses.keys()].sort((a, b) => a - b)) {
    const unsortedLayer = courses.get(course);
    const layerBounds = boundsFor(unsortedLayer);
    const longAxis = layerBounds.width >= layerBounds.depth ? 'x' : 'z';
    const layer = [...unsortedLayer].sort((a, b) => compareAlong(a, b, longAxis));
    const partition = packAdjoining(guillotinePartition(layer, longAxis, limits, partitionBudget), limits)
      .sort((a, b) => compareGroupPosition(a, b, longAxis));
    groups.push(...partition.map((group) => publicGroup(
      [...group].sort((a, b) => compareAlong(a, b, longAxis)),
      course,
    )));
  }

  const groupedIds = groups.flatMap(({ brickIds }) => brickIds);
  if (groupedIds.length !== bricks.length || new Set(groupedIds).size !== bricks.length
    || groupedIds.some((id) => !ids.has(id))) {
    throw new RangeError('Rectangular layer grouping did not preserve unique complete brick coverage.');
  }
  return groups;
}
