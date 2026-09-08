export const VOXEL_PALETTE = Object.freeze({
  K: 'black',
  W: 'white',
  L: 'lightGray',
  D: 'darkGray',
  R: 'red',
  Y: 'yellow',
  B: 'blue',
  G: 'green',
  T: 'tan',
  N: 'brown',
  O: 'orange',
});

const COLOR_NAMES = new Set(Object.values(VOXEL_PALETTE));
const MAX_AXIS = 64;
const MAX_CELLS = 50_000;
const MAX_LATTICE = 262_144;
const key = (x, y, z) => `${x},${y},${z}`;
const directions = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

function result(errors, warnings, stats) {
  return { valid: errors.length === 0, errors, warnings, stats, checks: { schema: errors.length === 0 } };
}

export function expandLayers(source, meta = {}) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.layers) || source.layers.length === 0) {
    throw new TypeError('layers must be a nonempty array.');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('meta must be an object.');

  let width;
  let depth;
  let height = 0;
  let occupiedCount = 0;
  for (const [layerIndex, layer] of source.layers.entries()) {
    if (!layer || typeof layer !== 'object' || !Number.isSafeInteger(layer.repeat) || layer.repeat <= 0) {
      throw new TypeError(`Layer ${layerIndex} repeat must be a positive safe integer.`);
    }
    if (!Array.isArray(layer.rows) || layer.rows.length === 0 || layer.rows.some((row) => typeof row !== 'string')) {
      throw new TypeError(`Layer ${layerIndex} rows must be a nonempty array of strings.`);
    }
    const layerDepth = layer.rows.length;
    const layerWidth = layer.rows[0].length;
    if (layerWidth === 0 || layer.rows.some((row) => row.length !== layerWidth)) throw new TypeError(`Layer ${layerIndex} rows must have one nonzero fixed width.`);
    width ??= layerWidth;
    depth ??= layerDepth;
    if (layerWidth !== width || layerDepth !== depth) throw new TypeError(`Layer ${layerIndex} dimensions do not match earlier layers.`);
    height += layer.repeat;
    if (!Number.isSafeInteger(height) || width > MAX_AXIS || depth > MAX_AXIS || height > MAX_AXIS) throw new RangeError(`Voxel dimensions must not exceed ${MAX_AXIS} on any axis.`);
    let occupiedInLayer = 0;
    for (const [rowIndex, row] of layer.rows.entries()) for (const symbol of row) {
      if (symbol !== '.' && !Object.hasOwn(VOXEL_PALETTE, symbol)) throw new TypeError(`Layer ${layerIndex} row ${rowIndex} contains unknown symbol ${JSON.stringify(symbol)}.`);
      if (symbol !== '.') occupiedInLayer += 1;
    }
    occupiedCount += occupiedInLayer * layer.repeat;
    if (!Number.isSafeInteger(occupiedCount) || occupiedCount > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
  }

  const latticeSize = width * depth * height;
  if (!Number.isSafeInteger(latticeSize) || latticeSize > MAX_LATTICE) throw new RangeError(`Voxel lattice exceeds the ${MAX_LATTICE}-cell limit.`);
  if (occupiedCount === 0) throw new RangeError('Expanded voxel model must contain at least one occupied cell.');

  const cells = [];
  let y = 0;
  for (const layer of source.layers) {
    for (let copy = 0; copy < layer.repeat; copy += 1, y += 1) {
      for (let z = 0; z < depth; z += 1) for (let x = 0; x < width; x += 1) {
        const symbol = layer.rows[z][x];
        if (symbol === '.') continue;
        cells.push({ x, y, z, color: VOXEL_PALETTE[symbol] });
      }
    }
  }
  return { version: 1, kind: 'voxels', cells, meta: { ...meta } };
}

export function expandVoxelProgram(source, meta = {}) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.operations) || source.operations.length === 0) {
    throw new TypeError('operations must be a nonempty array.');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('meta must be an object.');

  let visitedLatticeCells = 0;
  for (const [index, operation] of source.operations.entries()) {
    if (!operation || typeof operation !== 'object' || Array.isArray(operation)) throw new TypeError(`Operation ${index} must be an object.`);
    if (!['box', 'ellipsoid', 'taper'].includes(operation.type)) throw new TypeError(`Operation ${index} has unknown type ${String(operation.type)}.`);
    for (const field of ['x', 'y', 'z', 'w', 'h', 'd']) {
      if (!Number.isSafeInteger(operation[field])) throw new TypeError(`Operation ${index} ${field} must be a safe integer.`);
    }
    if (operation.x < 0 || operation.y < 0 || operation.z < 0 || operation.w <= 0 || operation.h <= 0 || operation.d <= 0) {
      throw new RangeError(`Operation ${index} origin must be nonnegative and extents must be positive.`);
    }
    if (operation.x + operation.w > MAX_AXIS || operation.y + operation.h > MAX_AXIS || operation.z + operation.d > MAX_AXIS) {
      throw new RangeError(`Operation ${index} exceeds the ${MAX_AXIS}-voxel axis bounds.`);
    }
    if (!COLOR_NAMES.has(operation.color)) throw new TypeError(`Operation ${index} uses unknown color ${String(operation.color)}.`);
    if (operation.type === 'taper') {
      if (!Number.isSafeInteger(operation.topW) || !Number.isSafeInteger(operation.topD) || operation.topW <= 0 || operation.topD <= 0) {
        throw new TypeError(`Operation ${index} taper topW and topD must be positive safe integers.`);
      }
      if (operation.topW > operation.w || operation.topD > operation.d) throw new RangeError(`Operation ${index} taper top must fit within its centered base bounds.`);
    }
    const volume = operation.w * operation.h * operation.d;
    visitedLatticeCells += volume;
    if (!Number.isSafeInteger(visitedLatticeCells) || visitedLatticeCells > MAX_LATTICE) {
      throw new RangeError(`Voxel program expansion exceeds the ${MAX_LATTICE}-cell lattice-work limit.`);
    }
    if (operation.type === 'box' && volume > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
  }

  const occupied = new Map();
  for (const operation of source.operations) {
    for (let dy = 0; dy < operation.h; dy += 1) for (let dz = 0; dz < operation.d; dz += 1) for (let dx = 0; dx < operation.w; dx += 1) {
      if (!primitiveContains(operation, dx, dy, dz)) continue;
      const cell = { x: operation.x + dx, y: operation.y + dy, z: operation.z + dz, color: operation.color };
      occupied.set(key(cell.x, cell.y, cell.z), cell);
      if (occupied.size > MAX_CELLS) throw new RangeError(`Occupied voxel count exceeds the ${MAX_CELLS}-cell limit.`);
    }
  }
  if (occupied.size === 0) throw new RangeError('Expanded voxel model must contain at least one occupied cell.');
  return { version: 1, kind: 'voxels', cells: [...occupied.values()], meta: { ...meta } };
}

export function expandVoxelTuples(source, meta = {}) {
  if (!source || typeof source !== 'object' || !Array.isArray(source.ops) || source.ops.length === 0) {
    throw new TypeError('ops must be a nonempty array.');
  }
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new TypeError('meta must be an object.');

  const operations = source.ops.map((tuple, index) => {
    if (!Array.isArray(tuple)) throw new TypeError(`Tuple ${index} must be an array.`);
    const [opcode, x, y, z, w, h, d, symbol, topW, topD] = tuple;
    const type = { b: 'box', e: 'ellipsoid', t: 'taper' }[opcode];
    if (!type) throw new TypeError(`Tuple ${index} has unknown opcode ${String(opcode)}.`);
    const expectedArity = opcode === 't' ? 10 : 8;
    if (tuple.length !== expectedArity) throw new TypeError(`Tuple ${index} must contain exactly ${expectedArity} values.`);
    if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
      throw new TypeError(`Tuple ${index} uses unknown palette symbol ${String(symbol)}.`);
    }
    const operation = { type, x, y, z, w, h, d, color: VOXEL_PALETTE[symbol] };
    if (type === 'taper') Object.assign(operation, { topW, topD });
    return operation;
  });

  return expandVoxelProgram({ operations }, meta);
}

export function validateVoxels(model) {
  const errors = [];
  const warnings = [];
  const emptyStats = { cellCount: Array.isArray(model?.cells) ? model.cells.length : 0, componentCount: 0, groundedComponents: 0, bounds: null };
  if (!model || typeof model !== 'object' || Array.isArray(model)) errors.push('Voxel model must be an object.');
  if (model?.version !== 1) errors.push('Voxel model version must be 1.');
  if (model?.kind !== 'voxels') errors.push('Voxel model kind must be "voxels".');
  if (!Array.isArray(model?.cells)) errors.push('Voxel model cells must be an array.');
  if (model?.meta != null && (typeof model.meta !== 'object' || Array.isArray(model.meta))) errors.push('Voxel model meta must be an object when provided.');
  if (Array.isArray(model?.cells) && model.cells.length === 0) errors.push('Voxel model cells must not be empty.');
  if (!Array.isArray(model?.cells) || model.cells.length === 0) return result(errors, warnings, emptyStats);
  if (model.cells.length > MAX_CELLS) {
    errors.push(`Voxel model exceeds the ${MAX_CELLS}-cell limit.`);
    return result(errors, warnings, emptyStats);
  }

  const cells = new Map();
  let bounds = null;
  for (const [index, cell] of model.cells.entries()) {
    if (!cell || typeof cell !== 'object' || Array.isArray(cell)) {
      errors.push(`Cell ${index} must be an object.`);
      continue;
    }
    const invalidFields = ['x', 'y', 'z'].filter((field) => !Number.isSafeInteger(cell[field]));
    if (invalidFields.length) {
      errors.push(`Cell ${index} coordinates must be safe integers: ${invalidFields.join(', ')}.`);
      continue;
    }
    if (cell.x < 0 || cell.y < 0 || cell.z < 0 || cell.x >= MAX_AXIS || cell.y >= MAX_AXIS || cell.z >= MAX_AXIS) {
      errors.push(`Cell ${index} coordinates must be between 0 and ${MAX_AXIS - 1}.`);
      continue;
    }
    if (!COLOR_NAMES.has(cell.color)) errors.push(`Cell ${index} uses unknown color ${String(cell.color)}.`);
    const cellKey = key(cell.x, cell.y, cell.z);
    if (cells.has(cellKey)) {
      errors.push(`Cell ${index} duplicates occupied coordinate ${cellKey}.`);
      continue;
    }
    cells.set(cellKey, cell);
    bounds ??= { minX: cell.x, maxX: cell.x, minY: cell.y, maxY: cell.y, minZ: cell.z, maxZ: cell.z };
    bounds.minX = Math.min(bounds.minX, cell.x);
    bounds.maxX = Math.max(bounds.maxX, cell.x);
    bounds.minY = Math.min(bounds.minY, cell.y);
    bounds.maxY = Math.max(bounds.maxY, cell.y);
    bounds.minZ = Math.min(bounds.minZ, cell.z);
    bounds.maxZ = Math.max(bounds.maxZ, cell.z);
  }

  if (bounds) {
    const latticeSize = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) * (bounds.maxZ - bounds.minZ + 1);
    if (latticeSize > MAX_LATTICE) errors.push(`Voxel bounds span a lattice larger than ${MAX_LATTICE} cells.`);
  }
  if (errors.length) return result(errors, warnings, { ...emptyStats, bounds });

  const visited = new Set();
  let componentCount = 0;
  let groundedComponents = 0;
  let floatingComponents = 0;
  for (const [startKey, start] of cells) {
    if (visited.has(startKey)) continue;
    componentCount += 1;
    let grounded = false;
    const stack = [start];
    visited.add(startKey);
    while (stack.length) {
      const cell = stack.pop();
      grounded ||= cell.y === 0;
      for (const [dx, dy, dz] of directions) {
        const neighborKey = key(cell.x + dx, cell.y + dy, cell.z + dz);
        const neighbor = cells.get(neighborKey);
        if (neighbor && !visited.has(neighborKey)) {
          visited.add(neighborKey);
          stack.push(neighbor);
        }
      }
    }
    if (grounded) groundedComponents += 1;
    else floatingComponents += 1;
  }
  if (componentCount > 1) warnings.push(`Shape contains ${componentCount} disconnected six-neighbor regions.`);
  if (floatingComponents) warnings.push(`${floatingComponents} region(s) do not contain a cell at ground y=0.`);
  return result(errors, warnings, { cellCount: cells.size, componentCount, groundedComponents, bounds });
}
import { primitiveContains } from './geometry.js';
