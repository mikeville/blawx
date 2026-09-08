import fs from 'node:fs';
import path from 'node:path';
import { convertFile } from './mesh-to-voxels.mjs';
import { validateVoxels } from '../src/voxels.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolvePrivateDataRoot } from '../server/private-data-root.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function convertPrivateTrellisResult(args = process.argv.slice(2)) {
const runDirectory = args.find(arg => !arg.startsWith('--'));
const outputDirectoryFlag = args.indexOf('--output-dir');
const outputDirectory = outputDirectoryFlag === -1 ? null : args[outputDirectoryFlag + 1];
const outputFlag = args.indexOf('--output-name');
const outputName = outputFlag >= 0 ? args[outputFlag + 1] : 'cat-trellis-01';
if (!runDirectory || !outputDirectory || (outputFlag >= 0 && !outputName)) throw new Error('Usage: node scripts/convert-trellis-live-result.mjs <private-run-directory> --output-dir <private-output-directory> [--output-name cat-trellis-03]');
if (args.includes('--publish')) throw new Error('Direct publication is disabled; review and export an allowlisted model separately.');
if (!/^cat-trellis-\d{2}$/.test(outputName)) throw new Error('Output name must match cat-trellis-NN');
const source = path.resolve(runDirectory, 'result.glb');
const outcome = JSON.parse(fs.readFileSync(path.resolve(runDirectory, 'outcome.json'), 'utf8'));
const imageRecord = JSON.parse(fs.readFileSync(path.resolve(runDirectory, 'image-record.json'), 'utf8'));
if (outcome.status !== 'downloaded-glb') throw new Error(`Run is not a downloaded GLB: ${outcome.status}`);
const localStem = outputName === 'cat-trellis-01' ? 'cat-trellis-24' : `${outputName}-24`;
const privateOutput = resolvePrivateDataRoot({ sourceRoot: ROOT, dataRoot: outputDirectory });
fs.mkdirSync(privateOutput, { recursive: true, mode: 0o700 });
const modelPath = path.join(privateOutput, `${localStem}-voxels.json`);
const reportPath = path.join(privateOutput, `${localStem}-conversion-report.json`);
for (const file of [modelPath, reportPath]) if (fs.existsSync(file)) throw new Error('Refusing to overwrite existing private output.');
const { result, texture, sourceGeometry, sourceHash, conversionMs, rasterizationMs } = convertFile(source, 24);
const generationMs = Number.isFinite(outcome.imageGenerationMs) && Number.isFinite(outcome.probeThroughDownloadMs)
  ? outcome.imageGenerationMs + outcome.probeThroughDownloadMs + conversionMs : null;
const model = {
  version: 1,
  kind: 'voxels',
  cells: result.cells,
  meta: {
    prompt: imageRecord.prompt,
    method: 'staged image-to-3D → voxels',
    provenance: 'Built-in image generation → authenticated TRELLIS.2 image-to-3D → unchanged local mesh conversion',
    generationMs,
    timingScope: 'sum of measured stages; reused image; excludes orchestration gaps and browser; not end-to-end',
    timings: { imageGenerationMs: outcome.imageGenerationMs, trellisProbeThroughDownloadMs: outcome.probeThroughDownloadMs, localConversionMs: conversionMs, rasterizationMs },
    runId: outcome.runId,
    sourceGlbSha256: sourceHash,
    resolution: 24,
  },
};
const validation = validateVoxels(model);
if (!validation.valid) throw new Error(`Converted model failed validation: ${validation.errors.join(' ')}`);
const report = {
  status: 'completed', runId: outcome.runId, source: 'result.glb', sourceSha256: sourceHash,
  resolution: 24, texture, conversionMs, rasterizationMs, stagedGenerationMs: generationMs,
  sourceGeometry,
  occupancy: { surface: result.surfaceCount, interior: result.interiorCount, total: result.cells.length },
  candidateWork: result.candidateWork, degenerateTriangleCount: result.degenerateTriangleCount,
  outputBounds: result.dimensions, sourceBounds: result.sourceBounds,
  normalization: { uniformScale: result.scale, longestDimensionCells: 24, groundedAtMinY: 0, axisOrientation: 'preserved' },
  validation,
  limitations: ['No mesh repair or color polish.', 'Conversion does not establish part assignment, interlocking, physical buildability, or browser-inclusive latency.'],
};
fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(report, null, 2));
return { modelPath, reportPath, report };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { convertPrivateTrellisResult(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
