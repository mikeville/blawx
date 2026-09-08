import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { transform } from 'esbuild';
import { expandVoxelTuples } from '../src/voxels.js';
import { shape10 } from '../examples/construction/shape10.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const scenePath = 'examples/construction/shape10.mjs';
const helperPath = 'examples/construction/helpers.mjs';
const read = (path) => fs.readFile(`${root}/${path}`, 'utf8');
const byteLength = (text) => Buffer.byteLength(text, 'utf8');
const whitespaceStrippedBytes = (text) => byteLength(text.replace(/\s+/gu, ''));
const parserMinifiedBytes = async (text, sourcefile) => byteLength((await transform(text, {
  loader: 'js',
  minify: true,
  sourcefile,
})).code);
const percent = (saved, baseline) => Number(((saved / baseline) * 100).toFixed(2));

export async function auditConstructionProgram({ originalPath, outputPath }) {
if(!originalPath||!outputPath) throw new Error('Explicit originalPath and outputPath are required; historical receipts are not bundled.');
const [originalText, sceneText, helperText] = await Promise.all([fs.readFile(originalPath,'utf8'), read(scenePath), read(helperPath)]);
const original = JSON.parse(originalText);
const constructed = shape10();
const exactOperationOrder = JSON.stringify(constructed.ops) === JSON.stringify(original.ops);

const start = performance.now();
const expandedOriginal = expandVoxelTuples(original, {});
const originalExpansionMs = performance.now() - start;
const constructedStart = performance.now();
const expandedConstructed = expandVoxelTuples(constructed, {});
const constructedExpansionMs = performance.now() - constructedStart;
const cellKey = ({ x, y, z, color }) => `${x},${y},${z},${color}`;
const originalCells = expandedOriginal.cells.map(cellKey);
const constructedCells = expandedConstructed.cells.map(cellKey);
const exactExpandedCellOrder = JSON.stringify(constructedCells) === JSON.stringify(originalCells);
const constructedCellSet = new Set(constructedCells);
const coloredCellSetEquality = originalCells.length === constructedCells.length &&
  originalCells.every((cell) => constructedCellSet.has(cell));

const originalBytes = byteLength(JSON.stringify(original));
const sceneBytes = whitespaceStrippedBytes(sceneText);
const helperBytes = whitespaceStrippedBytes(helperText);
const allInBytes = sceneBytes + helperBytes;
const [sceneParserMinifiedBytes, helperParserMinifiedBytes] = await Promise.all([
  parserMinifiedBytes(sceneText, scenePath),
  parserMinifiedBytes(helperText, helperPath),
]);
const allInParserMinifiedBytes = sceneParserMinifiedBytes + helperParserMinifiedBytes;
const report = {
  kind: 'trusted-offline-authored-construction-program-audit',
  sourceProvenance: 'explicitly supplied local input',
  programSources: [scenePath, helperPath],
  countingMethod: 'All figures are UTF-8 source bytes, not tokens. Original is JSON.stringify(parsed source). Whitespace-stripped figures remove every Unicode whitespace run. Parser-minified figures use the project’s existing esbuild transform with loader js and minify true; scene and helper are minified independently, then summed for all-in.',
  bytes: {
    originalMinifiedJson: originalBytes,
    sceneWhitespaceStripped: sceneBytes,
    helperWhitespaceStripped: helperBytes,
    allInWhitespaceStripped: allInBytes,
    sceneOnlySavings: originalBytes - sceneBytes,
    sceneOnlySavingsPercent: percent(originalBytes - sceneBytes, originalBytes),
    allInSavings: originalBytes - allInBytes,
    allInSavingsPercent: percent(originalBytes - allInBytes, originalBytes),
    sceneParserMinified: sceneParserMinifiedBytes,
    helperParserMinified: helperParserMinifiedBytes,
    allInParserMinified: allInParserMinifiedBytes,
    sceneParserMinifiedSavings: originalBytes - sceneParserMinifiedBytes,
    sceneParserMinifiedSavingsPercent: percent(originalBytes - sceneParserMinifiedBytes, originalBytes),
    allInParserMinifiedSavings: originalBytes - allInParserMinifiedBytes,
    allInParserMinifiedSavingsPercent: percent(originalBytes - allInParserMinifiedBytes, originalBytes),
  },
  operations: { original: original.ops.length, constructed: constructed.ops.length, exactOrderAndValues: exactOperationOrder },
  cells: { original: originalCells.length, constructed: constructedCells.length, exactOrderAndValues: exactExpandedCellOrder, coloredSetEquality: coloredCellSetEquality },
  localExpansionTimingMs: { original: Number(originalExpansionMs.toFixed(3)), constructed: Number(constructedExpansionMs.toFixed(3)), note: 'Single local measurements; not a benchmark or generation-speed claim.' },
};

if (!exactOperationOrder || !exactExpandedCellOrder || !coloredCellSetEquality) {
  throw new Error(`Construction program mismatch: ${JSON.stringify(report)}`);
}
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
return report;
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
  const report=await auditConstructionProgram({originalPath:value('--original'),outputPath:value('--output')});
  console.log(JSON.stringify(report,null,2));
}
