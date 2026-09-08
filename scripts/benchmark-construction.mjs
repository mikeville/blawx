import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { convertToBricks } from '../src/construction.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const SHAPES = Object.freeze([42, 43, 44, 45, 46, 47]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableTimestamp(date = new Date()) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function structuralSummary(diagnostics) {
  return {
    valid: diagnostics.valid,
    checks: diagnostics.checks,
    stats: diagnostics.stats,
    warnings: diagnostics.warnings,
    errors: diagnostics.errors,
  };
}

async function runConversion(rawModel, options) {
  try {
    const result = convertToBricks({ rawModel, sourceProgram: null, ...options });
    return {
      status: 'completed',
      metrics: result.metrics,
      diagnostics: structuralSummary(result.diagnostics),
      adjustments: result.adjustments,
      brickModelSha256: sha256(JSON.stringify(result.brickModel)),
    };
  } catch (error) {
    return {
      status: 'failed',
      error: { name: error?.name ?? 'Error', message: error?.message ?? String(error) },
    };
  }
}

export async function benchmarkConstruction({ now = new Date(), verifyCompactPlacements = false, referenceReportPath = null, dataRoot } = {}) {
  const indexPath = join(ROOT, 'public', 'examples', 'index.json');
  const converterPath = join(ROOT, 'src', 'construction.js');
  const outputDirectory = join(resolvePrivateDataRoot({ sourceRoot: ROOT, dataRoot }), 'construction-benchmark');
  const latestPath = join(outputDirectory, 'latest.json');
  const [indexSource, converterSource] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(converterPath),
  ]);
  const index = JSON.parse(indexSource);
  let previousLatest = null;
  let previousByShape = null;
  if (verifyCompactPlacements) {
    if (!referenceReportPath) throw new Error('verifyCompactPlacements requires an explicit referenceReportPath.');
    previousLatest = { report: referenceReportPath };
    const previousReport = JSON.parse(await readFile(referenceReportPath, 'utf8'));
    previousByShape = new Map(previousReport.results.map((result) => [result.shapeNumber, result]));
  }
  const results = [];

  for (const shapeNumber of SHAPES) {
    const entry = index.find(item => item.shape === shapeNumber);
    if (!entry) throw new Error(`Stable Shape ${shapeNumber} is missing from public/examples/index.json.`);
    const relativeSourcePath = entry.url.replace(/^\//, 'public/');
    const sourcePath = join(ROOT, relativeSourcePath);
    const sourceBytes = await readFile(sourcePath);
    const rawModel = JSON.parse(sourceBytes.toString('utf8'));
    const conversions = {
      compact: {
        baseline: await runConversion(rawModel, { adjustments: false }),
        adjusted: await runConversion(rawModel, { adjustments: true }),
      },
    };
    if (verifyCompactPlacements) {
      const previousCompact = previousByShape.get(shapeNumber)?.conversions?.compact;
      if (!previousCompact) throw new Error(`Previous benchmark ${previousLatest.report} has no compact receipt for Shape ${shapeNumber}.`);
      for (const variant of ['baseline', 'adjusted']) {
        const previousHash = previousCompact[variant]?.brickModelSha256;
        const currentHash = conversions.compact[variant]?.brickModelSha256;
        if (!previousHash || currentHash !== previousHash) {
          throw new Error(`Compact ${variant} brick model changed for Shape ${shapeNumber}: expected ${previousHash ?? 'missing hash'}, received ${currentHash ?? 'missing hash'}.`);
        }
      }
    }
    results.push({
      shapeNumber,
      id: entry.id,
      label: entry.label,
      source: {
        path: relativeSourcePath,
        sha256: sha256(sourceBytes),
        sourceProgramAvailable: false,
      },
      physicalStatus: 'Unresolved: diagnostics are bounded digital stud-contact checks, not physical stability, catalog, or assembly proof.',
      correctionScope: 'Opt-in corrections only consider local same-color vertical diagonal links at whole-source-voxel granularity; unsupported protrusions and unrelated components are left explicit.',
      conversions,
    });
  }

  const createdAt = now.toISOString();
  const filename = `${stableTimestamp(now)}-benchmark.json`;
  const report = {
    version: 1,
    kind: 'construction-benchmark',
    createdAt,
    stableShapes: SHAPES,
    sourceProgramMode: 'raw-only (public saved models do not include sourceProgram)',
    converter: {
      path: 'src/construction.js',
      sha256: sha256(converterSource),
    },
    compactPlacementFreeze: verifyCompactPlacements ? {
      status: 'matched',
      referenceReport: previousLatest.report,
      comparedShapeCount: SHAPES.length,
      comparedConversionCount: SHAPES.length * 2,
      field: 'brickModelSha256',
    } : { status: 'not-requested' },
    limitations: [
      'Compact mapping rounds source-layer boundaries to 5/6 of a brick course and measures resulting geometry and color differences.',
      'Packing uses a bounded ordinary rectangular footprint palette and stud-contact heuristics; exact part/color catalog, stability, and assembly order remain unverified.',
      'Baseline and adjusted timings are separate sequential local runs and are not generation or browser-render timings.',
    ],
    results,
  };

  await ensurePrivateDirectory(outputDirectory);
  const reportPath = join(outputDirectory, filename);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  const latest = {
    version: 1,
    kind: 'construction-benchmark-latest',
    createdAt,
    report: filename,
    converterSha256: report.converter.sha256,
    stableShapes: SHAPES,
  };
  await writeFile(latestPath, `${JSON.stringify(latest, null, 2)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  return { report, reportPath, latestPath };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const verifyCompactPlacements = process.argv.includes('--verify-compact-freeze');
  const referenceIndex = process.argv.indexOf('--reference-report');
  const result = await benchmarkConstruction({ verifyCompactPlacements, referenceReportPath: referenceIndex === -1 ? null : resolve(process.argv[referenceIndex + 1]) });
  console.log(`Wrote ${basename(result.reportPath)} and latest.json for Shapes ${SHAPES.join(', ')}.`);
}
