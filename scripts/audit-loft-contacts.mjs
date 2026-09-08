#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandLoftProgram } from '../src/loft-program.js';

const DEFAULT_PAIRS = [[12, 15], [15, 16], [17, 15], [17, 16], [18, 15], [18, 16]];
const MAX_PAIR_COMPARISONS = 1_000_000;
const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cellKey = ({ x, y, z }) => `${x},${y},${z}`;

export function auditCellPair(leftCells, rightCells, maxComparisons = MAX_PAIR_COMPARISONS) {
  const comparisons = leftCells.length * rightCells.length;
  if (!Number.isSafeInteger(comparisons) || comparisons > maxComparisons) {
    throw new RangeError(`Pair requires ${comparisons} cell comparisons; limit is ${maxComparisons}.`);
  }

  const rightKeys = new Set(rightCells.map(cellKey));
  let overlapCellCount = 0;
  let sharedFaceCount = 0;
  let nearestManhattanCellDistance = null;
  for (const left of leftCells) {
    if (rightKeys.has(cellKey(left))) overlapCellCount += 1;
    for (const [dx, dy, dz] of DIRECTIONS) {
      if (rightKeys.has(`${left.x + dx},${left.y + dy},${left.z + dz}`)) sharedFaceCount += 1;
    }
    for (const right of rightCells) {
      const distance = Math.abs(left.x - right.x) + Math.abs(left.y - right.y) + Math.abs(left.z - right.z);
      nearestManhattanCellDistance = nearestManhattanCellDistance === null
        ? distance
        : Math.min(nearestManhattanCellDistance, distance);
    }
  }
  return { comparisons, overlapCellCount, sharedFaceCount, nearestManhattanCellDistance };
}

export function connectedComponents(attributedCells) {
  const cellsByKey = new Map(attributedCells.map(cell => [cellKey(cell), cell]));
  const unseen = new Set(cellsByKey.keys());
  const components = [];
  while (unseen.size > 0) {
    const start = unseen.values().next().value;
    unseen.delete(start);
    const queue = [start];
    const attribution = new Map();
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const key = queue[cursor];
      const cell = cellsByKey.get(key);
      attribution.set(cell.lastWritingOp, (attribution.get(cell.lastWritingOp) ?? 0) + 1);
      for (const [dx, dy, dz] of DIRECTIONS) {
        const neighbor = `${cell.x + dx},${cell.y + dy},${cell.z + dz}`;
        if (unseen.delete(neighbor)) queue.push(neighbor);
      }
    }
    components.push({
      cellCount: queue.length,
      lastWritingOpCellCounts: [...attribution.entries()]
        .sort(([a], [b]) => a - b)
        .map(([opIndex, cellCount]) => ({ opIndex, cellCount })),
    });
  }
  return components.sort((a, b) => b.cellCount - a.cellCount);
}

function parseArgs(argv) {
  const options = { source: null, output: null, pairs: DEFAULT_PAIRS };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--source', '--output', '--pairs'].includes(flag) || value === undefined) {
      throw new Error('Usage: node scripts/audit-loft-contacts.mjs [--source FILE] [--output FILE] [--pairs 12:15,15:16]');
    }
    index += 1;
    if (flag === '--source') options.source = value;
    else if (flag === '--output') options.output = value;
    else {
      options.pairs = value.split(',').map(pair => pair.split(':').map(Number));
      if (options.pairs.some(pair => pair.length !== 2 || pair.some(op => !Number.isSafeInteger(op) || op < 1))) {
        throw new TypeError('--pairs must be comma-separated positive 1-based pairs such as 12:15,15:16.');
      }
    }
  }
  if(!options.source||!options.output) throw new Error('Explicit --source and --output paths are required; historical artifacts are not bundled.');
  return options;
}

export async function auditProgram({ sourcePath, outputPath, pairs = DEFAULT_PAIRS }) {
  const sourceText = await readFile(sourcePath, 'utf8');
  const program = JSON.parse(sourceText);
  const finalModel = expandLoftProgram(program);
  const expandedOps = program.ops.map((tuple, index) => ({
    opIndex: index + 1,
    tuple,
    cells: expandLoftProgram({ ops: [tuple] }).cells,
  }));
  for (const pair of pairs) {
    if (pair.some(opIndex => opIndex > expandedOps.length)) throw new RangeError(`Pair ${pair.join(':')} exceeds ${expandedOps.length} operations.`);
  }

  const finalByKey = new Map();
  for (const operation of expandedOps) {
    for (const cell of operation.cells) finalByKey.set(cellKey(cell), { ...cell, lastWritingOp: operation.opIndex });
  }
  if (finalByKey.size !== finalModel.cells.length) throw new Error('Attributed final cell count does not match whole-program expansion.');

  const report = {
    status: 'completed',
    source: 'explicit-input',
    methodology: {
      coordinateUnit: 'occupied voxel cell',
      adjacency: 'six-neighbor shared face',
      distance: 'minimum Manhattan distance between occupied cell coordinates; 0 means overlap and 1 means face contact',
      pairComparisonLimit: MAX_PAIR_COMPARISONS,
      finalOwnership: 'last-writing operation at each occupied coordinate',
      scope: 'offline diagnostic only; no physical interlocking or buildability claim',
    },
    pairs: pairs.map(([leftOpIndex, rightOpIndex]) => {
      const left = expandedOps[leftOpIndex - 1];
      const right = expandedOps[rightOpIndex - 1];
      return {
        leftOpIndex,
        rightOpIndex,
        leftTuple: left.tuple,
        rightTuple: right.tuple,
        leftExpandedCellCount: left.cells.length,
        rightExpandedCellCount: right.cells.length,
        ...auditCellPair(left.cells, right.cells),
      };
    }),
    finalModel: {
      cellCount: finalByKey.size,
      componentCount: 0,
      components: connectedComponents([...finalByKey.values()]),
    },
  };
  report.finalModel.componentCount = report.finalModel.components.length;
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = parseArgs(process.argv.slice(2));
  const report = await auditProgram({
    sourcePath: path.resolve(projectRoot, options.source),
    outputPath: path.resolve(projectRoot, options.output),
    pairs: options.pairs,
  });
  console.log(JSON.stringify(report, null, 2));
}
