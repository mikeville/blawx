import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandLoftProgram } from '../src/loft-program.js';
import { expandRelativeProgram, resolveRelativeProgram } from '../src/relative-program.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cases = [
  {
    name: 'shape33-cat',
    sourcePath: 'cat.raw-stream.txt',
    sourceSha256: 'f6cc51dd3c048b89da4142f39bb5a7591b54839186366486ed1c38838b2914e1',
    kind: 'sse',
    relations: {
      4: { id: 'tail-tip', relativeTo: 3, anchor: [1, 1, 1], offset: [-5, -2, -5] },
      7: { id: 'head', relativeTo: 0, anchor: [0.5, 1, 0.5], offset: [-6, -1, -8] },
      13: { id: 'muzzle-left', relativeTo: 7, anchor: [0, 0.5, 0], offset: [3, -3.5, 0] },
      14: { id: 'muzzle-right', relativeTo: 7, anchor: [1, 0.5, 0], offset: [-6, -3.5, 0] },
      21: { id: 'forehead-mark', relativeTo: 7, anchor: [0.5, 1, 0], offset: [-1, -3, 1] },
    },
  },
  {
    name: 'shape31-reef',
    sourcePath: 'reef.json',
    sourceSha256: '1caedebaa3e6746b7797c3ebc0c23a2c77e911880ebc20f4eff8a0d9ee181e28',
    kind: 'json',
    relations: {
      7: { id: 'module-band', relativeTo: 6, anchor: [0, 0.5, 0], offset: [0, -1.5, 0] },
      8: { id: 'window-front', relativeTo: 7, anchor: [0.5, 0, 0], offset: [-0.5, 0, 0] },
      9: { id: 'window-back', relativeTo: 7, anchor: [0.5, 0, 1], offset: [-0.5, 0, -1] },
      14: { id: 'mast', relativeTo: 6, anchor: [0.5, 1, 0.5], offset: [-0.5, 1, -1] },
      15: { id: 'mast-light', relativeTo: 14, anchor: [0.5, 1, 0.5], offset: [-1.5, -1, -1.5] },
    },
  },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => JSON.stringify(value);
const cellKey = ({ x, y, z, color }) => `${x},${y},${z},${color}`;

function extractSseProgram(raw) {
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === 'response.output_text.done') return JSON.parse(event.text);
  }
  throw new Error('SSE source has no response.output_text.done event.');
}

function translate(tuple, delta) {
  const result = structuredClone(tuple);
  const [dx, dy, dz] = delta;
  if (['b', 'e', 't'].includes(result[0])) {
    result[1] += dx; result[2] += dy; result[3] += dz;
  } else {
    const axis = result[1];
    const [da, du, dv] = axis === 'x' ? [dx, dy, dz] : axis === 'y' ? [dy, dx, dz] : [dz, dx, dy];
    if (result[0] === 'l') result[4] = result[4].map(([a, u, v, wu, wv]) => [a + da, u + du, v + dv, wu, wv]);
    else if (result[0] === 'r') { result[2] += da; result[4] += du; result[5] += dv; }
    else throw new Error(`Unsupported opcode ${String(result[0])}.`);
  }
  return result;
}

function bounds(tuple) {
  if (['b', 'e', 't'].includes(tuple[0])) return { min: tuple.slice(1, 4), max: [tuple[1] + tuple[4], tuple[2] + tuple[5], tuple[3] + tuple[6]] };
  const axis = tuple[1];
  let local;
  if (tuple[0] === 'l') {
    const sections = tuple[4];
    local = {
      min: [Math.min(...sections.map(s => s[0])), Math.min(...sections.map(s => s[1] - s[3] / 2)), Math.min(...sections.map(s => s[2] - s[4] / 2))],
      max: [Math.max(...sections.map(s => s[0])), Math.max(...sections.map(s => s[1] + s[3] / 2)), Math.max(...sections.map(s => s[2] + s[4] / 2))],
    };
  } else {
    local = { min: [tuple[2], tuple[4] - tuple[6], tuple[5] - tuple[6]], max: [tuple[2] + tuple[3], tuple[4] + tuple[6], tuple[5] + tuple[6]] };
  }
  const map = axis === 'x' ? [0, 1, 2] : axis === 'y' ? [1, 0, 2] : [1, 2, 0];
  return { min: map.map(i => local.min[i]), max: map.map(i => local.max[i]) };
}

function rewrite(program, relations) {
  const absoluteBounds = program.ops.map(bounds);
  return { nodes: program.ops.map((shape, index) => {
    const relation = relations[index];
    const id = relation?.id ?? `op-${index + 1}`;
    if (!relation) return { id, shape };
    const reference = absoluteBounds[relation.relativeTo];
    const target = relation.anchor.map((anchor, axis) => reference.min[axis] + (reference.max[axis] - reference.min[axis]) * anchor + relation.offset[axis]);
    const own = absoluteBounds[index];
    if (target.some((value, axis) => value !== own.min[axis])) throw new Error(`Authored relation for node ${index} does not preserve its declared minimum.`);
    return {
      id,
      relativeTo: { id: relations[relation.relativeTo]?.id ?? `op-${relation.relativeTo + 1}`, anchor: relation.anchor, offset: relation.offset },
      shape: translate(shape, own.min.map(value => -value)),
    };
  }) };
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
const inputDir=value('--input-dir'),outputDir=value('--output-dir');
if(!inputDir||!outputDir) throw new Error('Usage: node scripts/audit-relative-parity.mjs --input-dir DIR --output-dir DIR');
await mkdir(outputDir, { recursive: true });
const results = [];
for (const spec of cases) {
  const sourceBytes = await readFile(path.join(inputDir, spec.sourcePath));
  if (sha256(sourceBytes) !== spec.sourceSha256) throw new Error(`${spec.name} source hash changed.`);
  const program = spec.kind === 'sse' ? extractSseProgram(sourceBytes.toString('utf8')) : JSON.parse(sourceBytes);
  const relative = rewrite(program, spec.relations);
  const resolved = resolveRelativeProgram(relative);
  const originalModel = expandLoftProgram(program);
  const relativeModel = expandRelativeProgram(relative);
  const originalCells = originalModel.cells.map(cellKey).sort();
  const relativeCells = relativeModel.cells.map(cellKey).sort();
  if (compact(resolved) !== compact(program)) throw new Error(`${spec.name} coordinate/color tuple parity failed.`);
  if (compact(relativeCells) !== compact(originalCells)) throw new Error(`${spec.name} expanded cell parity failed.`);
  const relativeText = `${JSON.stringify(relative, null, 2)}\n`;
  await writeFile(path.join(outputDir, `${spec.name}.relative.json`), relativeText);
  results.push({
    name: spec.name,
    sourcePath: spec.sourcePath,
    sourceSha256: spec.sourceSha256,
    sourceArtifactBytes: sourceBytes.byteLength,
    originalProgramBytes: Buffer.byteLength(compact(program)),
    authoredRelativeBytes: Buffer.byteLength(compact(relative)),
    authoredFileBytes: Buffer.byteLength(relativeText),
    byteOverhead: Buffer.byteLength(compact(relative)) - Buffer.byteLength(compact(program)),
    changedNodes: Object.keys(spec.relations).length,
    totalNodes: program.ops.length,
    tupleParity: true,
    expandedCellParity: true,
    expandedCellCount: originalCells.length,
  });
}

const report = {
  status: 'pass',
  classification: 'manually authored representation demonstrations; not generated attempts or viewer fixtures',
  claim: 'Exact tuple and expanded coordinate/color parity only. No quality, compression, token, latency, or speed claim.',
  cases: results,
};
await writeFile(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
}
