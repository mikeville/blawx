import { expandLoftProgram } from '../src/loft-program.js';

const DEFAULT_MAX_ADDED_CELLS = 128;
const FACE_DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const EDGE_OFFSETS = [
  [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1],
  [0, 1, 1], [0, 1, -1],
];

const cellKey = ({ x, y, z }) => `${x},${y},${z}`;
const compareCoordinates = (left, right) => left.y - right.y || left.x - right.x || left.z - right.z;

function componentLabels(cells) {
  const byKey = new Map(cells.map(cell => [cellKey(cell), cell]));
  const labels = new Map();
  let count = 0;
  for (const start of byKey.keys()) {
    if (labels.has(start)) continue;
    const queue = [start];
    labels.set(start, count);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const cell = byKey.get(queue[cursor]);
      for (const [dx, dy, dz] of FACE_DIRECTIONS) {
        const neighbor = `${cell.x + dx},${cell.y + dy},${cell.z + dz}`;
        if (byKey.has(neighbor) && !labels.has(neighbor)) {
          labels.set(neighbor, count);
          queue.push(neighbor);
        }
      }
    }
    count += 1;
  }
  return { labels, count };
}

function diagonalCandidates(cells) {
  const byKey = new Map(cells.map(cell => [cellKey(cell), cell]));
  const candidates = new Map();
  for (const left of cells) for (const [dx, dy, dz] of EDGE_OFFSETS) {
    const right = byKey.get(`${left.x + dx},${left.y + dy},${left.z + dz}`);
    if (!right) continue;
    const changed = [['x', dx], ['y', dy], ['z', dz]].filter(([, delta]) => delta !== 0);
    for (const [axis] of changed) {
      const corner = { x: left.x + 0, y: left.y + 0, z: left.z + 0 };
      corner[axis] = right[axis];
      const key = cellKey(corner);
      if (!byKey.has(key)) candidates.set(key, corner);
    }
  }
  return [...candidates.values()].sort(compareCoordinates);
}

function repairOneLoft(cells, unavailable, remaining) {
  const working = [...cells];
  const additions = [];
  let conflicts = 0;
  let connectivity = componentLabels(working);
  if (connectivity.count <= 1 || remaining <= 0) {
    return { additions, conflicts, residualComponentCount: connectivity.count };
  }
  for (const candidate of diagonalCandidates(cells)) {
    if (additions.length >= remaining) break;
    const candidateKey = cellKey(candidate);
    if (unavailable.has(candidateKey)) {
      conflicts += 1;
      continue;
    }
    const adjacentComponents = new Set();
    for (const [dx, dy, dz] of FACE_DIRECTIONS) {
      const label = connectivity.labels.get(`${candidate.x + dx},${candidate.y + dy},${candidate.z + dz}`);
      if (label !== undefined) adjacentComponents.add(label);
    }
    if (adjacentComponents.size < 2) continue;
    additions.push(candidate);
    working.push(candidate);
    unavailable.add(candidateKey);
    connectivity = componentLabels(working);
    if (connectivity.count === 1) break;
  }
  return { additions, conflicts, residualComponentCount: connectivity.count };
}

export function repairLoftDiagonals(program, options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('options must be an object.');
  const maxAddedCells = options.maxAddedCells ?? DEFAULT_MAX_ADDED_CELLS;
  if (!Number.isSafeInteger(maxAddedCells) || maxAddedCells < 0) throw new RangeError('maxAddedCells must be a nonnegative safe integer.');

  const originalModel = expandLoftProgram(program);
  const originalByKey = new Map(originalModel.cells.map(cell => [cellKey(cell), cell]));
  const unavailable = new Set(originalByKey.keys());
  const additions = [];
  const lofts = [];

  for (const [zeroBasedIndex, tuple] of program.ops.entries()) {
    if (tuple[0] !== 'l') continue;
    const expanded = expandLoftProgram({ ops: [tuple] });
    const effectiveCells = expanded.cells.filter(cell => originalByKey.get(cellKey(cell))?.color === cell.color);
    const before = componentLabels(effectiveCells).count;
    const result = repairOneLoft(effectiveCells, unavailable, maxAddedCells - additions.length);
    const colored = result.additions.map(cell => ({ ...cell, color: expanded.cells[0].color }));
    additions.push(...colored);
    lofts.push({
      opIndex: zeroBasedIndex + 1,
      effectiveCellCount: effectiveCells.length,
      componentCountBefore: before,
      componentCountAfter: result.residualComponentCount,
      addedCellCount: colored.length,
      skippedOccupiedCandidateCount: result.conflicts,
      residualDisconnected: result.residualComponentCount > 1,
    });
  }

  const capReached = additions.length === maxAddedCells && lofts.some(loft => loft.residualDisconnected);
  const report = {
    scope: 'face-connectivity repair for internally disconnected loft operations; no physical interlock or buildability claim',
    maxAddedCells,
    addedCellCount: additions.length,
    capReached,
    residualDisconnectedLoftCount: lofts.filter(loft => loft.residualDisconnected).length,
    lofts,
  };
  const provenance = {
    transform: 'repair-loft-diagonals',
    sourceCellCount: originalModel.cells.length,
    additions: additions.map(cell => ({ ...cell })),
    report,
  };
  return {
    model: {
      ...originalModel,
      cells: [...originalModel.cells, ...additions],
      meta: { ...originalModel.meta, provenance },
    },
    additions,
    report,
  };
}
