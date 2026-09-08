export const PALETTE = Object.freeze({
  black: '#111111',
  white: '#f4f4f4',
  lightGray: '#a0a5a9',
  darkGray: '#545955',
  red: '#c91a09',
  yellow: '#f2cd37',
  blue: '#0055bf',
  green: '#237841',
  tan: '#e4cd9e',
  brown: '#583927',
  orange: '#fe8a18',
});

const BASE_FOOTPRINTS = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 6], [1, 8], [2, 2], [2, 3], [2, 4], [2, 6], [2, 8]];
export const FOOTPRINTS = Object.freeze(BASE_FOOTPRINTS.flatMap(([w, d]) =>
  w === d ? [Object.freeze({ w, d })] : [Object.freeze({ w, d }), Object.freeze({ w: d, d: w })],
));

const FOOTPRINT_KEYS = new Set(FOOTPRINTS.map(({ w, d }) => `${w}x${d}`));
const CELL_VISIT_LIMIT = 250_000;
const COORDINATE_LIMIT = 10_000;
const VALIDATION_BRICK_LIMIT = 5_000;

const key = (x, y, z) => `${x},${y},${z}`;
const isInteger = Number.isSafeInteger;

function coordinatesWithinBounds(x, y, z, w = 1, h = 1, d = 1) {
  return Math.abs(x) <= COORDINATE_LIMIT
    && Math.abs(z) <= COORDINATE_LIMIT
    && y >= 0 && y <= COORDINATE_LIMIT
    && Number.isSafeInteger(x + w - 1) && x + w - 1 <= COORDINATE_LIMIT
    && Number.isSafeInteger(z + d - 1) && z + d - 1 <= COORDINATE_LIMIT
    && Number.isSafeInteger(y + h - 1) && y + h - 1 <= COORDINATE_LIMIT;
}

function overlaps(a, b) {
  return a.y === b.y && a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

function contactArea(upper, lower) {
  if (upper.y !== lower.y + 1) return 0;
  const x = Math.max(0, Math.min(upper.x + upper.w, lower.x + lower.w) - Math.max(upper.x, lower.x));
  const z = Math.max(0, Math.min(upper.z + upper.d, lower.z + lower.d) - Math.max(upper.z, lower.z));
  return x * z;
}

export function validateModel(model) {
  const errors = [];
  const warnings = [];
  const bricks = Array.isArray(model?.bricks) ? model.bricks : [];
  if (!model || typeof model !== 'object' || Array.isArray(model)) errors.push('Model must be an object.');
  if (model?.version !== 1) errors.push('Model version must be 1.');
  if (!Array.isArray(model?.bricks)) errors.push('Model bricks must be an array.');
  if (model?.meta != null && (typeof model.meta !== 'object' || Array.isArray(model.meta))) errors.push('Model meta must be an object when provided.');
  if (Array.isArray(model?.bricks) && model.bricks.length === 0) errors.push('Model bricks must not be empty.');
  if (bricks.length > VALIDATION_BRICK_LIMIT) errors.push(`Model exceeds the ${VALIDATION_BRICK_LIMIT}-brick validation limit.`);

  const usable = [];
  const bricksToInspect = bricks.length > VALIDATION_BRICK_LIMIT ? [] : bricks;
  bricksToInspect.forEach((brick, index) => {
    if (!brick || typeof brick !== 'object' || Array.isArray(brick)) {
      errors.push(`Brick ${index} must be an object.`);
      return;
    }
    const numeric = ['x', 'y', 'z', 'w', 'd'];
    const bad = numeric.filter((field) => !isInteger(brick[field]));
    if (bad.length) errors.push(`Brick ${index} fields must be integers: ${bad.join(', ')}.`);
    if (isInteger(brick.y) && brick.y < 0) errors.push(`Brick ${index} y must be nonnegative.`);
    if (isInteger(brick.w) && brick.w <= 0 || isInteger(brick.d) && brick.d <= 0) errors.push(`Brick ${index} dimensions must be positive.`);
    if (!bad.length && brick.w > 0 && brick.d > 0 && !coordinatesWithinBounds(brick.x, brick.y, brick.z, brick.w, 1, brick.d)) errors.push(`Brick ${index} coordinates or extent exceed the ±${COORDINATE_LIMIT} x/z and 0–${COORDINATE_LIMIT} y bounds.`);
    if (isInteger(brick.w) && isInteger(brick.d) && !FOOTPRINT_KEYS.has(`${brick.w}x${brick.d}`)) errors.push(`Brick ${index} uses unknown footprint ${brick.w}x${brick.d}.`);
    if (!Object.hasOwn(PALETTE, brick.color)) errors.push(`Brick ${index} uses unknown color ${String(brick.color)}.`);
    if (!bad.length && brick.y >= 0 && brick.w > 0 && brick.d > 0) usable.push({ ...brick, index });
  });
  const schemaErrorCount = errors.length;

  let overlapCount = 0;
  const adjacency = usable.map(() => []);
  for (let i = 0; i < usable.length; i += 1) {
    for (let j = i + 1; j < usable.length; j += 1) {
      if (overlaps(usable[i], usable[j])) {
        overlapCount += 1;
        errors.push(`Bricks ${usable[i].index} and ${usable[j].index} overlap.`);
      }
      if (contactArea(usable[i], usable[j]) || contactArea(usable[j], usable[i])) {
        adjacency[i].push(j);
        adjacency[j].push(i);
      }
    }
  }

  let componentCount = 0;
  let groundedComponents = 0;
  const visited = new Set();
  for (let i = 0; i < usable.length; i += 1) {
    if (visited.has(i)) continue;
    componentCount += 1;
    let grounded = false;
    const stack = [i];
    visited.add(i);
    while (stack.length) {
      const current = stack.pop();
      if (usable[current].y === 0) grounded = true;
      for (const next of adjacency[current]) if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
    if (grounded) groundedComponents += 1;
    else errors.push(`Connected component ${componentCount} is elevated and has no stud connection to ground.`);
  }

  let unsupportedBricks = 0;
  let weakContacts = 0;
  for (let i = 0; i < usable.length; i += 1) {
    const brick = usable[i];
    if (brick.y === 0) continue;
    let area = 0;
    for (let j = 0; j < usable.length; j += 1) area += contactArea(brick, usable[j]);
    if (area === 0) unsupportedBricks += 1;
    else if (area / (brick.w * brick.d) < 0.25) weakContacts += 1;
  }
  if (unsupportedBricks) warnings.push(`${unsupportedBricks} elevated brick(s) have no support directly below.`);
  if (weakContacts) warnings.push(`${weakContacts} brick(s) have contact under less than 25% of their footprint.`);
  warnings.push('Exact real-world part/color catalog availability has not been verified.');
  warnings.push('Connectivity and contact heuristics do not establish physical stability.');
  warnings.push('A complete legal assembly sequence has not been verified.');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats: { brickCount: bricks.length, componentCount, groundedComponents, unsupportedBricks, weakContacts, overlapCount },
    checks: {
      schema: schemaErrorCount === 0,
      noOverlaps: overlapCount === 0,
      allComponentsGrounded: componentCount === groundedComponents,
      directSupport: unsupportedBricks === 0,
      exactPartColorCatalog: false,
      physicalStability: false,
      assemblySequence: false,
    },
  };
}

function assertBoundedInteger(value, name, { positive = false, nonnegative = false } = {}) {
  if (!isInteger(value) || positive && value <= 0 || nonnegative && value < 0) throw new TypeError(`${name} must be ${positive ? 'a positive' : nonnegative ? 'a nonnegative' : 'an'} integer.`);
}

function operationVolume(operation, index) {
  for (const field of ['x', 'y', 'z', 'w', 'h', 'd']) assertBoundedInteger(operation[field], `Operation ${index} ${field}`, { positive: ['w', 'h', 'd'].includes(field), nonnegative: field === 'y' });
  if (!Object.hasOwn(PALETTE, operation.color)) throw new TypeError(`Operation ${index} has unknown color ${String(operation.color)}.`);
  if (!['box', 'ellipsoid', 'taper'].includes(operation.type)) throw new TypeError(`Operation ${index} has unknown type ${String(operation.type)}.`);
  if (operation.type === 'taper') {
    assertBoundedInteger(operation.topW, `Operation ${index} topW`, { positive: true });
    assertBoundedInteger(operation.topD, `Operation ${index} topD`, { positive: true });
    if (operation.topW > operation.w || operation.topD > operation.d) throw new RangeError(`Operation ${index} taper top must fit within its centered base bounds.`);
  }
  if (!coordinatesWithinBounds(operation.x, operation.y, operation.z, operation.w, operation.h, operation.d)) throw new RangeError(`Operation ${index} coordinates or extent exceed the ±${COORDINATE_LIMIT} x/z and 0–${COORDINATE_LIMIT} y bounds.`);
  const volume = operation.w * operation.h * operation.d;
  if (!Number.isSafeInteger(volume) || volume > CELL_VISIT_LIMIT) throw new RangeError(`Operation ${index} expansion exceeds the ${CELL_VISIT_LIMIT}-cell safety limit.`);
  return volume;
}

export function primitiveContains(operation, dx, dy, dz) {
  if (operation.type === 'box') return true;
  if (operation.type === 'ellipsoid') {
    const nx = (dx + 0.5 - operation.w / 2) / (operation.w / 2);
    const ny = (dy + 0.5 - operation.h / 2) / (operation.h / 2);
    const nz = (dz + 0.5 - operation.d / 2) / (operation.d / 2);
    return nx * nx + ny * ny + nz * nz <= 1;
  }
  // A taper is centered in its w-by-d base and linearly approaches topW-by-topD.
  const t = operation.h === 1 ? 1 : dy / (operation.h - 1);
  const layerW = operation.w + (operation.topW - operation.w) * t;
  const layerD = operation.d + (operation.topD - operation.d) * t;
  return Math.abs(dx + 0.5 - operation.w / 2) <= layerW / 2 && Math.abs(dz + 0.5 - operation.d / 2) <= layerD / 2;
}

export function compileProgram(program, { maxBricks = 3000 } = {}) {
  assertBoundedInteger(maxBricks, 'maxBricks', { positive: true });
  if (!program || typeof program !== 'object' || !Array.isArray(program.operations)) throw new TypeError('Program operations must be an array.');
  let visits = 0;
  program.operations.forEach((operation, index) => {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new TypeError(`Operation ${index} must be an object.`);
    visits += operationVolume(operation, index);
    if (!Number.isSafeInteger(visits) || visits > CELL_VISIT_LIMIT) throw new RangeError(`Program expansion exceeds the ${CELL_VISIT_LIMIT}-cell safety limit.`);
  });
  const cells = new Map();
  program.operations.forEach((operation) => {
    for (let dy = 0; dy < operation.h; dy += 1) for (let dz = 0; dz < operation.d; dz += 1) for (let dx = 0; dx < operation.w; dx += 1) {
      if (primitiveContains(operation, dx, dy, dz)) {
        const cell = { x: operation.x + dx, y: operation.y + dy, z: operation.z + dz, color: operation.color };
        cells.set(key(cell.x, cell.y, cell.z), cell);
      }
    }
  });
  return { version: 1, bricks: packVoxels([...cells.values()], { maxBricks }), meta: { ...(program.meta ?? {}), compiler: 'bounded-geometry-v1' } };
}

export function packVoxels(cells, { maxBricks = 3000 } = {}) {
  assertBoundedInteger(maxBricks, 'maxBricks', { positive: true });
  if (!Array.isArray(cells)) throw new TypeError('cells must be an array.');
  if (cells.length > CELL_VISIT_LIMIT) throw new RangeError(`Cell input exceeds the ${CELL_VISIT_LIMIT}-cell safety limit.`);
  const remaining = new Map();
  cells.forEach((cell, index) => {
    if (!cell || typeof cell !== 'object') throw new TypeError(`Cell ${index} must be an object.`);
    assertBoundedInteger(cell.x, `Cell ${index} x`);
    assertBoundedInteger(cell.y, `Cell ${index} y`, { nonnegative: true });
    assertBoundedInteger(cell.z, `Cell ${index} z`);
    if (!coordinatesWithinBounds(cell.x, cell.y, cell.z)) throw new RangeError(`Cell ${index} coordinates exceed the ±${COORDINATE_LIMIT} x/z and 0–${COORDINATE_LIMIT} y bounds.`);
    if (!Object.hasOwn(PALETTE, cell.color)) throw new TypeError(`Cell ${index} has unknown color ${String(cell.color)}.`);
    remaining.set(key(cell.x, cell.y, cell.z), { x: cell.x, y: cell.y, z: cell.z, color: cell.color });
  });
  if (remaining.size > maxBricks * 16) throw new RangeError(`Occupied volume cannot fit within the ${maxBricks}-brick budget.`);

  const candidatesByParity = [0, 1].map((parity) => [...FOOTPRINTS].sort((a, b) => {
      const area = b.w * b.d - a.w * a.d;
      if (area) return area;
      return parity === 0 ? b.w - a.w : b.d - a.d;
    }));
  const anchors = [...remaining.values()].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const bricks = [];
  let anchorIndex = 0;
  while (remaining.size) {
    while (anchorIndex < anchors.length && !remaining.has(key(anchors[anchorIndex].x, anchors[anchorIndex].y, anchors[anchorIndex].z))) anchorIndex += 1;
    const anchor = anchors[anchorIndex];
    const candidates = candidatesByParity[Math.abs(anchor.y % 2)];
    let chosen = candidates.at(-1);
    for (const candidate of candidates) {
      let fits = true;
      for (let dz = 0; dz < candidate.d && fits; dz += 1) for (let dx = 0; dx < candidate.w; dx += 1) {
        const cell = remaining.get(key(anchor.x + dx, anchor.y, anchor.z + dz));
        if (!cell || cell.color !== anchor.color) { fits = false; break; }
      }
      if (fits) { chosen = candidate; break; }
    }
    bricks.push({ x: anchor.x, y: anchor.y, z: anchor.z, w: chosen.w, d: chosen.d, color: anchor.color });
    if (bricks.length > maxBricks) throw new RangeError(`Packed model exceeds the ${maxBricks}-brick budget.`);
    for (let dz = 0; dz < chosen.d; dz += 1) for (let dx = 0; dx < chosen.w; dx += 1) remaining.delete(key(anchor.x + dx, anchor.y, anchor.z + dz));
  }
  return bricks;
}
