import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateModel } from '../src/geometry.js';

const CELL_LIMIT = 250_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = [
  'cat-construction.json',
  'cat-shark-squid-construction.json',
  'futuristic-city-construction.json',
];
const DIRECTIONS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const LATERAL_DIRECTIONS = [[1, 0, 0], [0, 0, 1]];
const cellKey = (x, y, z) => `${x},${y},${z}`;

function expandBricks(bricks) {
  let requestedCells = 0;
  for (const [index, brick] of bricks.entries()) {
    const area = brick.w * brick.d;
    if (!Number.isSafeInteger(area) || area <= 0) throw new Error(`Brick ${index} has an invalid expansion area.`);
    requestedCells += area;
    if (!Number.isSafeInteger(requestedCells) || requestedCells > CELL_LIMIT) throw new Error(`Fixture expansion exceeds the ${CELL_LIMIT}-cell limit.`);
  }

  const cells = new Map();
  for (const [brickIndex, brick] of bricks.entries()) {
    for (let dz = 0; dz < brick.d; dz += 1) for (let dx = 0; dx < brick.w; dx += 1) {
      const cell = { x: brick.x + dx, y: brick.y, z: brick.z + dz, brickIndex };
      const key = cellKey(cell.x, cell.y, cell.z);
      if (cells.has(key)) throw new Error(`Fixture contains overlapping bricks at ${key}.`);
      cells.set(key, cell);
    }
  }
  return cells;
}

function voxelComponents(cells) {
  const visited = new Set();
  const components = [];
  for (const [startKey, start] of cells) {
    if (visited.has(startKey)) continue;
    const stack = [start];
    visited.add(startKey);
    const bounds = { minX: start.x, maxX: start.x, minY: start.y, maxY: start.y, minZ: start.z, maxZ: start.z };
    let size = 0;
    let grounded = false;
    while (stack.length) {
      const cell = stack.pop();
      size += 1;
      grounded ||= cell.y === 0;
      bounds.minX = Math.min(bounds.minX, cell.x);
      bounds.maxX = Math.max(bounds.maxX, cell.x);
      bounds.minY = Math.min(bounds.minY, cell.y);
      bounds.maxY = Math.max(bounds.maxY, cell.y);
      bounds.minZ = Math.min(bounds.minZ, cell.z);
      bounds.maxZ = Math.max(bounds.maxZ, cell.z);
      for (const [dx, dy, dz] of DIRECTIONS) {
        const neighborKey = cellKey(cell.x + dx, cell.y + dy, cell.z + dz);
        const neighbor = cells.get(neighborKey);
        if (neighbor && !visited.has(neighborKey)) {
          visited.add(neighborKey);
          stack.push(neighbor);
        }
      }
    }
    components.push({ size, grounded, bounds });
  }
  return components;
}

function verticalContact(a, b) {
  if (Math.abs(a.y - b.y) !== 1) return false;
  return a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
}

function brickComponents(bricks) {
  const adjacency = bricks.map(() => []);
  for (let i = 0; i < bricks.length; i += 1) for (let j = i + 1; j < bricks.length; j += 1) {
    if (verticalContact(bricks[i], bricks[j])) {
      adjacency[i].push(j);
      adjacency[j].push(i);
    }
  }
  const componentByBrick = Array(bricks.length);
  const components = [];
  for (let start = 0; start < bricks.length; start += 1) {
    if (componentByBrick[start] !== undefined) continue;
    const id = components.length;
    const stack = [start];
    componentByBrick[start] = id;
    let grounded = false;
    let brickCount = 0;
    while (stack.length) {
      const current = stack.pop();
      brickCount += 1;
      grounded ||= bricks[current].y === 0;
      for (const neighbor of adjacency[current]) if (componentByBrick[neighbor] === undefined) {
        componentByBrick[neighbor] = id;
        stack.push(neighbor);
      }
    }
    components.push({ id, brickCount, grounded });
  }
  return { components, componentByBrick };
}

function lateralComponentTouches(cells, componentByBrick) {
  const pairs = new Map();
  for (const cell of cells.values()) for (const [dx, dy, dz] of LATERAL_DIRECTIONS) {
    const neighbor = cells.get(cellKey(cell.x + dx, cell.y + dy, cell.z + dz));
    if (!neighbor) continue;
    const a = componentByBrick[cell.brickIndex];
    const b = componentByBrick[neighbor.brickIndex];
    if (a === b) continue;
    const pair = a < b ? [a, b] : [b, a];
    const pairKey = pair.join(':');
    const existing = pairs.get(pairKey) ?? { brickComponents: pair, lateralVoxelFaceContacts: 0 };
    existing.lateralVoxelFaceContacts += 1;
    pairs.set(pairKey, existing);
  }
  return [...pairs.values()].sort((a, b) => a.brickComponents[0] - b.brickComponents[0] || a.brickComponents[1] - b.brickComponents[1]);
}

async function diagnose(filename, fixtureDir) {
  const model = JSON.parse(await readFile(resolve(fixtureDir, filename), 'utf8'));
  const validation = validateModel(model);
  const cells = expandBricks(model.bricks);
  const voxel = voxelComponents(cells);
  const brick = brickComponents(model.bricks);
  const reconstructedGrounded = brick.components.filter(({ grounded }) => grounded).length;
  if (brick.components.length !== validation.stats.componentCount || reconstructedGrounded !== validation.stats.groundedComponents) {
    throw new Error(`${filename}: reconstructed vertical brick components disagree with validateModel.`);
  }
  return {
    id: model.meta?.id ?? filename.replace(/\.json$/, ''),
    source: `public/fixtures/${filename}`,
    occupiedCellCount: cells.size,
    voxelConnectivity: {
      componentCount: voxel.length,
      groundedComponentCount: voxel.filter(({ grounded }) => grounded).length,
      ungroundedComponents: voxel.filter(({ grounded }) => !grounded).map(({ size, bounds }) => ({ size, bounds })),
    },
    verticalBrickConnectivity: {
      componentCount: validation.stats.componentCount,
      groundedComponentCount: validation.stats.groundedComponents,
      ungroundedComponentCount: validation.stats.componentCount - validation.stats.groundedComponents,
    },
    laterallyTouchingBrickComponentPairs: lateralComponentTouches(cells, brick.componentByBrick),
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
const args = process.argv.slice(2);
const value = flag => { const index=args.indexOf(flag); return index === -1 ? null : args[index+1]; };
const fixtureDir=value('--input-dir');
const output=value('--output');
if(!fixtureDir||!output) throw new Error('Usage: node scripts/diagnose-connectivity.mjs --input-dir DIR --output FILE');
const report = {
  diagnostic: 'voxel-versus-vertical-brick-connectivity',
  generatedAt: new Date().toISOString(),
  limits: { maximumExpandedCellsPerFixture: CELL_LIMIT },
  definitions: {
    voxelConnectivity: 'Six-neighbor face adjacency between occupied stud-layer cells, including lateral and vertical neighbors.',
    verticalBrickConnectivity: 'Validator connectivity through vertical stud-footprint adjacency only; lateral body contact is not a stud connection.',
    lateralPairs: 'Pairs of vertical brick components whose occupied cells share one or more lateral faces.',
  },
  caveats: [
    'Voxel continuity shows geometric face contact, not a legal LEGO connection, stable construction, or assembly sequence.',
    'A lateral pair identifies where brick partitioning lacks vertical interlock; it does not prove that repacking can repair the connection within the allowed palette or budget.',
    'These are authored fixtures and do not measure automatic prompt generation quality.',
  ],
  models: await Promise.all(FIXTURES.map(filename=>diagnose(filename,resolve(fixtureDir)))),
};

const outputPath=resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`Wrote ${outputPath}`);
for (const model of report.models) {
  console.log(`${model.id}: voxels=${model.voxelConnectivity.componentCount}, vertical-brick=${model.verticalBrickConnectivity.componentCount}, lateral-pairs=${model.laterallyTouchingBrickComponentPairs.length}`);
}
}
