import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandRelativeProgram, resolveRelativeProgram } from '../src/relative-program.js';
import { expandRelativeTuples, resolveRelativeTuples } from '../src/relative-tuples.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compact = (value) => JSON.stringify(value);
const cellKey = ({ x, y, z, color }) => `${x},${y},${z},${color}`;

function extractSseProgram(raw) {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.startsWith('data: ')) continue;
    const event = JSON.parse(line.slice(6));
    if (event.type === 'response.output_text.done') return JSON.parse(event.text);
  }
  throw new Error('SSE source has no response.output_text.done event.');
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
const relativeDir=value('--relative-dir'),sourceDir=value('--source-dir'),outputDir=value('--output-dir');
if(!relativeDir||!sourceDir||!outputDir) throw new Error('Usage: node scripts/audit-relative-tuples.mjs --relative-dir DIR --source-dir DIR --output-dir DIR');
await import('node:fs/promises').then(({mkdir})=>mkdir(outputDir,{recursive:true}));
const reportPath = path.join(relativeDir, 'report.json');
const originalReportBytes = await readFile(reportPath);
const originalReport = JSON.parse(originalReportBytes);

const cases = [];
for (const baseline of originalReport.cases) {
  const verbosePath = path.join(relativeDir, `${baseline.name}.relative.json`);
  const verboseBytes = await readFile(verbosePath);
  const verbose = JSON.parse(verboseBytes);
  const sourceBytes = await readFile(path.join(sourceDir, baseline.sourcePath));
  if (sha256(sourceBytes) !== baseline.sourceSha256) throw new Error(`${baseline.name} original source hash changed.`);
  const originalProgram = baseline.sourcePath.endsWith('raw-stream.txt')
    ? extractSseProgram(sourceBytes.toString('utf8'))
    : JSON.parse(sourceBytes);
  const indexById = new Map(verbose.nodes.map((node, index) => [node.id, index]));
  const compactProgram = { ops: verbose.nodes.map((node, index) => {
    if (!node.relativeTo) return node.shape;
    const referenceIndex = indexById.get(node.relativeTo.id);
    if (referenceIndex === undefined) throw new Error(`${baseline.name} node ${index} has a missing authored reference.`);
    return ['@', referenceIndex, node.relativeTo.anchor, node.relativeTo.offset, node.shape];
  }) };

  const verboseResolved = resolveRelativeProgram(verbose);
  const compactResolved = resolveRelativeTuples(compactProgram);
  if (compact(compactResolved) !== compact(verboseResolved)) throw new Error(`${baseline.name} resolved tuple parity failed.`);
  if (compact(compactResolved) !== compact(originalProgram)) throw new Error(`${baseline.name} original tuple parity failed.`);
  const verboseCells = expandRelativeProgram(verbose).cells.map(cellKey).sort();
  const compactCells = expandRelativeTuples(compactProgram).cells.map(cellKey).sort();
  if (compact(compactCells) !== compact(verboseCells)) throw new Error(`${baseline.name} expanded cell parity failed.`);
  if (verboseCells.length !== baseline.expandedCellCount) throw new Error(`${baseline.name} no longer matches the original parity report.`);

  const compactText = `${JSON.stringify(compactProgram, null, 2)}\n`;
  await writeFile(path.join(outputDir, `${baseline.name}.relative-tuples.json`), compactText);
  const compactBytes = Buffer.byteLength(compact(compactProgram));
  cases.push({
    name: baseline.name,
    sourceSha256: baseline.sourceSha256,
    verboseRelativeSha256: sha256(verboseBytes),
    originalProgramBytes: baseline.originalProgramBytes,
    verboseRelativeBytes: baseline.authoredRelativeBytes,
    compactRelativeBytes: compactBytes,
    compactVsOriginalBytes: compactBytes - baseline.originalProgramBytes,
    compactVsVerboseBytes: compactBytes - baseline.authoredRelativeBytes,
    totalOps: compactProgram.ops.length,
    relativeOps: compactProgram.ops.filter((op) => op[0] === '@').length,
    originalTupleParity: true,
    verboseTupleParity: true,
    expandedCellParity: true,
    expandedCellCount: compactCells.length,
  });
}

if (sha256(await readFile(reportPath)) !== sha256(originalReportBytes)) throw new Error('Original relative report changed.');

const report = {
  status: 'pass',
  classification: 'manually authored compact representation demonstrations; not generated attempts or viewer fixtures',
  claim: 'Exact resolved tuple and expanded coordinate/color parity only. Byte counts are source bytes, not tokens or latency evidence.',
  originalReportSha256: sha256(originalReportBytes),
  cases,
};
await writeFile(path.join(outputDir, 'compact-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
}
