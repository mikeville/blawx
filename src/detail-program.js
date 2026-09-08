import { expandVoxelTuples, VOXEL_PALETTE } from './voxels.js';

const MAX_SOURCE_OPS = 256;
const MAX_EXPANDED_OPS = 2_048;
const MAX_AXIS = 64;
const MAX_LATTICE_WORK = 262_144;
const SOURCE_FIELDS = new Set(['ops']);
const PROFILE_FIELDS = new Set(['type', 'x', 'y', 'z', 'w', 'd', 'levels', 'rise', 'insetX', 'insetZ', 'shiftX', 'shiftZ', 'color']);
const FRAME_FIELDS = new Set(['type', 'x', 'y', 'z', 'w', 'h', 'd', 'axis', 'thickness', 'color']);
const BAYS_FIELDS = new Set(['type', 'x', 'y', 'z', 'axis', 'columns', 'rows', 'bayW', 'bayH', 'pier', 'beam', 'depth', 'color']);

function assertExactFields(value, allowed, label) {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) throw new TypeError(`${label} has unknown field ${JSON.stringify(field)}.`);
  }
  for (const field of allowed) {
    if (!(field in value)) throw new TypeError(`${label} is missing required field ${field}.`);
  }
}

function assertInteger(value, field, index) {
  if (!Number.isSafeInteger(value)) throw new TypeError(`Operation ${index} ${field} must be a safe integer.`);
}

function assertSymbol(symbol, index) {
  if (typeof symbol !== 'string' || symbol === '.' || !Object.hasOwn(VOXEL_PALETTE, symbol)) {
    throw new TypeError(`Operation ${index} uses unknown palette symbol ${String(symbol)}.`);
  }
}

function tupleVolume(tuple) {
  return tuple[4] * tuple[5] * tuple[6];
}

function assertBoxBounds(tuple, index) {
  const [, x, y, z, w, h, d] = tuple;
  for (const [field, value] of Object.entries({ x, y, z, w, h, d })) assertInteger(value, field, index);
  if (x < 0 || y < 0 || z < 0 || w <= 0 || h <= 0 || d <= 0) {
    throw new RangeError(`Operation ${index} origin must be nonnegative and extents must be positive.`);
  }
  if (x + w > MAX_AXIS || y + h > MAX_AXIS || z + d > MAX_AXIS) {
    throw new RangeError(`Operation ${index} exceeds the ${MAX_AXIS}-voxel axis bounds.`);
  }
}

function compileProfile(operation, index) {
  assertExactFields(operation, PROFILE_FIELDS, `Operation ${index} profile`);
  for (const field of ['x', 'y', 'z', 'w', 'd', 'levels', 'rise', 'insetX', 'insetZ', 'shiftX', 'shiftZ']) {
    assertInteger(operation[field], field, index);
  }
  assertSymbol(operation.color, index);
  if (operation.levels <= 0 || operation.rise <= 0) throw new RangeError(`Operation ${index} profile levels and rise must be positive.`);
  if (operation.insetX < 0 || operation.insetZ < 0) throw new RangeError(`Operation ${index} profile insets must be nonnegative.`);
  if (operation.levels > MAX_EXPANDED_OPS) throw new RangeError(`Operation ${index} profile exceeds the expanded-operation limit.`);

  const tuples = [];
  for (let tier = 0; tier < operation.levels; tier += 1) {
    const tuple = ['b',
      operation.x + tier * (operation.insetX + operation.shiftX),
      operation.y + tier * operation.rise,
      operation.z + tier * (operation.insetZ + operation.shiftZ),
      operation.w - 2 * tier * operation.insetX,
      operation.rise,
      operation.d - 2 * tier * operation.insetZ,
      operation.color,
    ];
    assertBoxBounds(tuple, index);
    tuples.push(tuple);
  }
  return tuples;
}

function compileFrame(operation, index) {
  assertExactFields(operation, FRAME_FIELDS, `Operation ${index} frame`);
  for (const field of ['x', 'y', 'z', 'w', 'h', 'd', 'thickness']) assertInteger(operation[field], field, index);
  assertSymbol(operation.color, index);
  if (!['x', 'y', 'z'].includes(operation.axis)) throw new TypeError(`Operation ${index} frame axis must be x, y, or z.`);
  const { x, y, z, w, h, d, thickness: t, color } = operation;
  if (t <= 0) throw new RangeError(`Operation ${index} frame thickness must be positive.`);
  const seed = ['b', x, y, z, w, h, d, color];
  assertBoxBounds(seed, index);

  let tuples;
  if (operation.axis === 'x') {
    if (h - 2 * t <= 0 || d - 2 * t <= 0) throw new RangeError(`Operation ${index} frame opening must be positive on both cross-section dimensions.`);
    tuples = [
      ['b', x, y, z, w, t, d, color], ['b', x, y + h - t, z, w, t, d, color],
      ['b', x, y + t, z, w, h - 2 * t, t, color], ['b', x, y + t, z + d - t, w, h - 2 * t, t, color],
    ];
  } else if (operation.axis === 'y') {
    if (w - 2 * t <= 0 || d - 2 * t <= 0) throw new RangeError(`Operation ${index} frame opening must be positive on both cross-section dimensions.`);
    tuples = [
      ['b', x, y, z, t, h, d, color], ['b', x + w - t, y, z, t, h, d, color],
      ['b', x + t, y, z, w - 2 * t, h, t, color], ['b', x + t, y, z + d - t, w - 2 * t, h, t, color],
    ];
  } else {
    if (w - 2 * t <= 0 || h - 2 * t <= 0) throw new RangeError(`Operation ${index} frame opening must be positive on both cross-section dimensions.`);
    tuples = [
      ['b', x, y, z, w, t, d, color], ['b', x, y + h - t, z, w, t, d, color],
      ['b', x, y + t, z, t, h - 2 * t, d, color], ['b', x + w - t, y + t, z, t, h - 2 * t, d, color],
    ];
  }
  return tuples;
}

function compileBays(operation, index) {
  assertExactFields(operation, BAYS_FIELDS, `Operation ${index} bays`);
  for (const field of ['x', 'y', 'z', 'columns', 'rows', 'bayW', 'bayH', 'pier', 'beam', 'depth']) {
    assertInteger(operation[field], field, index);
  }
  assertSymbol(operation.color, index);
  if (!['x', 'y', 'z'].includes(operation.axis)) throw new TypeError(`Operation ${index} bays axis must be x, y, or z.`);
  if (operation.x < 0 || operation.y < 0 || operation.z < 0) throw new RangeError(`Operation ${index} bays origin must be nonnegative.`);
  for (const field of ['columns', 'rows', 'bayW', 'bayH', 'pier', 'beam', 'depth']) {
    if (operation[field] <= 0) throw new RangeError(`Operation ${index} bays ${field} must be positive.`);
  }

  const totalU = operation.columns * operation.bayW + (operation.columns + 1) * operation.pier;
  const totalV = operation.rows * operation.bayH + (operation.rows + 1) * operation.beam;
  const tupleCount = operation.rows + 1 + (operation.columns + 1) * operation.rows;
  const work = totalU * totalV * operation.depth;
  if (![totalU, totalV, tupleCount, work].every(Number.isSafeInteger)) throw new RangeError(`Operation ${index} bays dimensions are too large.`);
  if (tupleCount > MAX_EXPANDED_OPS) throw new RangeError(`Operation ${index} bays exceeds the expanded-operation limit.`);
  if (work > MAX_LATTICE_WORK) throw new RangeError(`Operation ${index} bays exceeds the ${MAX_LATTICE_WORK}-cell lattice-work limit.`);

  const extents = operation.axis === 'z' ? [totalU, totalV, operation.depth]
    : operation.axis === 'x' ? [operation.depth, totalV, totalU]
      : [totalU, operation.depth, totalV];
  assertBoxBounds(['b', operation.x, operation.y, operation.z, ...extents, operation.color], index);

  const box = (u, v, sizeU, sizeV) => operation.axis === 'z'
    ? ['b', operation.x + u, operation.y + v, operation.z, sizeU, sizeV, operation.depth, operation.color]
    : operation.axis === 'x'
      ? ['b', operation.x, operation.y + v, operation.z + u, operation.depth, sizeV, sizeU, operation.color]
      : ['b', operation.x + u, operation.y, operation.z + v, sizeU, operation.depth, sizeV, operation.color];
  const tuples = [];
  for (let row = 0; row <= operation.rows; row += 1) {
    tuples.push(box(0, row * (operation.bayH + operation.beam), totalU, operation.beam));
  }
  for (let row = 0; row < operation.rows; row += 1) {
    const v = operation.beam + row * (operation.bayH + operation.beam);
    for (let column = 0; column <= operation.columns; column += 1) {
      tuples.push(box(column * (operation.bayW + operation.pier), v, operation.pier, operation.bayH));
    }
  }
  return { tuples, aperture: operation, work };
}

function compileDetail(source) {

  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new TypeError('Detail program must be an object.');
  assertExactFields(source, SOURCE_FIELDS, 'Detail program');
  if (!Array.isArray(source.ops) || source.ops.length === 0) throw new TypeError('ops must be a nonempty array.');
  if (source.ops.length > MAX_SOURCE_OPS) throw new RangeError(`Detail program exceeds the ${MAX_SOURCE_OPS}-source-operation limit.`);

  const tuples = [];
  const apertures = [];
  let latticeWork = 0;
  for (const [index, operation] of source.ops.entries()) {
    let next;
    let ownedWork;
    if (Array.isArray(operation)) {
      next = [operation];
    } else {
      if (!operation || typeof operation !== 'object') throw new TypeError(`Operation ${index} must be a tuple or macro object.`);
      if (operation.type === 'profile') next = compileProfile(operation, index);
      else if (operation.type === 'frame') next = compileFrame(operation, index);
      else if (operation.type === 'bays') {
        const compiled = compileBays(operation, index);
        next = compiled.tuples;
        ownedWork = compiled.work;
        apertures.push(compiled.aperture);
      }
      else throw new TypeError(`Operation ${index} has unknown macro type ${String(operation.type)}.`);
    }
    if (tuples.length + next.length > MAX_EXPANDED_OPS) throw new RangeError(`Detail program exceeds the ${MAX_EXPANDED_OPS}-expanded-operation limit.`);
    if (ownedWork !== undefined) {
      latticeWork += ownedWork;
      if (!Number.isSafeInteger(latticeWork) || latticeWork > MAX_LATTICE_WORK) {
        throw new RangeError(`Detail program expansion exceeds the ${MAX_LATTICE_WORK}-cell lattice-work limit.`);
      }
    }
    for (const tuple of next) {
      // Primitive tuple schema remains owned by expandVoxelTuples; this preflight only
      // reads valid-looking dimensions so malformed tuples fail there unchanged.
      if (Array.isArray(tuple) && tuple.length >= 7 && [tuple[4], tuple[5], tuple[6]].every(Number.isSafeInteger)) {
        const volume = tupleVolume(tuple);
        if (volume > 0 && ownedWork === undefined) {
          latticeWork += volume;
          if (!Number.isSafeInteger(latticeWork) || latticeWork > MAX_LATTICE_WORK) {
            throw new RangeError(`Detail program expansion exceeds the ${MAX_LATTICE_WORK}-cell lattice-work limit.`);
          }
        }
      }
      tuples.push(tuple);
    }
  }
  return { tuples, apertures };
}

export function compileDetailTuples(source) {
  return compileDetail(source).tuples;
}

export function expandDetailProgram(source, meta = {}) {
  const { tuples, apertures } = compileDetail(source);
  const model = expandVoxelTuples({ ops: tuples }, meta);
  const occupied = new Set(model.cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  for (const operation of apertures) {
    for (let row = 0; row < operation.rows; row += 1) for (let column = 0; column < operation.columns; column += 1) {
      const startU = operation.pier + column * (operation.bayW + operation.pier);
      const startV = operation.beam + row * (operation.bayH + operation.beam);
      for (let e = 0; e < operation.depth; e += 1) for (let v = 0; v < operation.bayH; v += 1) for (let u = 0; u < operation.bayW; u += 1) {
        const x = operation.x + (operation.axis === 'x' ? e : startU + u);
        const y = operation.y + (operation.axis === 'y' ? e : startV + v);
        const z = operation.z + (operation.axis === 'z' ? e : operation.axis === 'x' ? startU + u : startV + v);
        if (occupied.has(`${x},${y},${z}`)) throw new RangeError('Detail program obstructs a bays aperture.');
      }
    }
  }
  return model;
}
