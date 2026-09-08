#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertFile } from './mesh-to-voxels.mjs';
import { validateVoxels } from '../src/voxels.js';
import { resolvePrivateDataRoot } from '../server/private-data-root.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1];
}

export function convertMeshToPrivateVoxels({ inputPath, outputDirectory, resolution = 24 }) {
  if (!inputPath || !outputDirectory) throw new Error('Explicit inputPath and outputDirectory are required.');
  const input = path.resolve(inputPath);
  const output = resolvePrivateDataRoot({ sourceRoot: ROOT, dataRoot: outputDirectory });
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const modelPath = path.join(output, 'model.json');
  const reportPath = path.join(output, 'conversion-report.json');
  for (const target of [modelPath, reportPath]) if (fs.existsSync(target)) throw new Error('Refusing to overwrite an existing private output.');

  const { result, texture, sourceHash, conversionMs, rasterizationMs } = convertFile(input, resolution);
  const model = {
    version: 1,
    kind: 'voxels',
    cells: result.cells,
    meta: { label: 'Prepared mesh conversion', method: 'local-mesh-conversion', resolution },
  };
  const validation = validateVoxels(model);
  if (!validation.valid) throw new Error(`Converted model failed validation: ${validation.errors.join(' ')}`);
  const report = {
    status: 'completed', sourceSha256: sourceHash, resolution, texture, conversionMs, rasterizationMs,
    validation, surfaceCount: result.surfaceCount, interiorCount: result.interiorCount,
    totalCount: result.cells.length, candidateWork: result.candidateWork,
    outputBounds: result.dimensions, sourceBounds: result.sourceBounds,
    normalization: { uniformScale: result.scale, longestDimensionCells: resolution, groundedAtMinY: 0, axisOrientation: 'preserved' },
    algorithm: 'Per-triangle clamped voxel AABB candidates; triangle-box intersection; nearest-point barycentric UV sampling; deterministic palette matching; boundary flood fill; 6-neighbor interior color inheritance.',
    limitations: ['No mesh repair, part fitting, interlocking, or physical buildability proof.'],
  };
  fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return { modelPath, reportPath, report };
}

export function runCli(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/convert-trellis-bear.mjs --input model.glb --output-dir /private/path [--resolution 24]');
    return null;
  }
  const resolution = Number(option(args, '--resolution') ?? 24);
  if (!Number.isInteger(resolution) || resolution < 1 || resolution > 64) throw new Error('Resolution must be an integer from 1 to 64.');
  const result = convertMeshToPrivateVoxels({ inputPath: option(args, '--input'), outputDirectory: option(args, '--output-dir'), resolution });
  console.log(JSON.stringify({ model: result.modelPath, report: result.reportPath, ...result.report }, null, 2));
  return result;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { runCli(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
