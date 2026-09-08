import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { convertToBricks } from '../src/construction.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const SHAPES = Object.freeze([42, 43, 44, 45, 46, 47]);
const STRUCTURAL_FIELDS = Object.freeze([
  'componentCount',
  'groundedComponentCount',
  'groundlessComponentCount',
  'unsupportedBrickCount',
  'weakSupportBrickCount',
  'bridgingBrickCount',
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableTimestamp(date) {
  return date.toISOString().replaceAll(':', '-').replaceAll('.', '-');
}

function structuralStats(result) {
  return Object.fromEntries(STRUCTURAL_FIELDS.map((field) => [field, result.diagnostics.stats[field]]));
}

function conversionSummary(result) {
  return {
    brickModelSha256: sha256(JSON.stringify(result.brickModel)),
    conversionMs: result.metrics.conversionMs,
    brickCount: result.metrics.brickCount,
    structuralAddedVoxelCount: result.metrics.structuralAddedVoxelCount,
    structuralAddedMappedCellCount: result.metrics.structuralAddedMappedCellCount,
    geometryDifferenceRatio: result.metrics.geometryDifferenceRatio,
    colorDifferenceRatio: result.metrics.colorDifferenceRatio,
    packingStrategy: result.metrics.packingStrategy,
    adjustmentSearch: result.metrics.adjustmentSearch,
    assemblyFeedback: result.metrics.assemblyFeedback,
    structural: structuralStats(result),
    adjustments: result.adjustments,
  };
}

export async function benchmarkAssemblyRepairs({ now = new Date(), referenceReportPath, dataRoot } = {}) {
  if (!referenceReportPath) throw new Error('An explicit curated referenceReportPath is required.');
  const indexPath = join(ROOT, 'public', 'examples', 'index.json');
  const converterPath = join(ROOT, 'src', 'construction.js');
  const [indexSource, converterSource, referenceSource] = await Promise.all([
    readFile(indexPath, 'utf8'),
    readFile(converterPath),
    readFile(referenceReportPath, 'utf8'),
  ]);
  const index = JSON.parse(indexSource);
  const reference = JSON.parse(referenceSource);
  const referenceByShape = new Map(reference.results.map((result) => [result.shapeNumber, result]));
  const results = [];

  for (const shapeNumber of SHAPES) {
    const entry = index.find(item => item.shape === shapeNumber);
    if (!entry) throw new Error(`Stable Shape ${shapeNumber} is missing.`);
    const relativeSourcePath = entry.url.replace(/^\//, 'public/');
    const sourceBytes = await readFile(join(ROOT, relativeSourcePath));
    const rawModel = JSON.parse(sourceBytes.toString('utf8'));
    const inputBefore = JSON.stringify(rawModel);
    const baseline = convertToBricks({ rawModel, adjustments: false });
    const adjusted = convertToBricks({ rawModel, adjustments: true });
    const baselineSummary = conversionSummary(baseline);
    const adjustedSummary = conversionSummary(adjusted);
    const expectedBaselineHash = referenceByShape.get(shapeNumber)?.conversions?.compact?.baseline?.brickModelSha256;
    const budget = Math.min(32, Math.floor(rawModel.cells.length * 0.01));
    const assemblyBefore = adjusted.metrics.assemblyFeedback?.baseline;
    const assemblyAfter = adjusted.metrics.assemblyFeedback?.final;
    const assemblyNoWorse = assemblyBefore != null && assemblyAfter != null
      && assemblyAfter.rootFailureCount <= assemblyBefore.rootFailureCount
      && assemblyAfter.blockedJoinCount <= assemblyBefore.blockedJoinCount
      && assemblyAfter.unresolvedBrickCount * assemblyBefore.brickCount
        <= assemblyBefore.unresolvedBrickCount * assemblyAfter.brickCount;
    const graphImproved = adjusted.diagnostics.stats.groundlessComponentCount < baseline.diagnostics.stats.groundlessComponentCount
      || adjusted.diagnostics.stats.unsupportedBrickCount < baseline.diagnostics.stats.unsupportedBrickCount
      || adjusted.diagnostics.stats.weakSupportBrickCount < baseline.diagnostics.stats.weakSupportBrickCount;
    results.push({
      shapeNumber,
      id: entry.id,
      label: entry.label,
      source: { path: relativeSourcePath, sha256: sha256(sourceBytes), rawCellCount: rawModel.cells.length },
      inputPreserved: JSON.stringify(rawModel) === inputBefore,
      baselineHash: {
        expected: expectedBaselineHash ?? null,
        actual: baselineSummary.brickModelSha256,
        matchesReference: expectedBaselineHash === baselineSummary.brickModelSha256,
      },
      additionBudget: {
        limit: budget,
        accepted: adjusted.metrics.structuralAddedVoxelCount,
        withinLimit: adjusted.metrics.structuralAddedVoxelCount <= budget,
      },
      graphImproved,
      assemblyNoWorse,
      baseline: baselineSummary,
      adjusted: adjustedSummary,
    });
  }

  const createdAt = now.toISOString();
  const report = {
    version: 1,
    kind: 'assembly-repair-benchmark',
    createdAt,
    stableShapes: SHAPES,
    converter: { path: 'src/construction.js', sha256: sha256(converterSource) },
    baselineReference: 'explicit curated private reference',
    scope: 'Deterministic local packing variants and bounded whole-source-voxel support additions; no source edits, generator calls, model calls, or API calls.',
    acceptance: 'After a graph candidate passes the existing component/support non-regression gate, its assembly plan must not increase root failures, blocked joins, or the unresolved-brick ratio. At most 24 candidate assembly plans are evaluated in addition to the baseline plan.',
    limitations: [
      'Ground contact, stud connectivity, direct support, and seam bridging remain geometric heuristics rather than physical stability or clutch-strength proof.',
      'Added cells stay within the original source bounding box and use existing neighboring colors, but derived visual quality still requires human review.',
      'Timing covers synchronous converter CPU work on this machine, excluding worker startup, transfer, rendering, generation, and assembly planning.',
    ],
    checks: {
      allInputsPreserved: results.every((result) => result.inputPreserved),
      allBaselineHashesMatch: results.every((result) => result.baselineHash.matchesReference),
      allBudgetsMet: results.every((result) => result.additionBudget.withinLimit),
      allAssemblyFeedbackNonRegressing: results.every((result) => result.assemblyNoWorse),
      improvedShapeCount: results.filter((result) => result.graphImproved).length,
      unchangedShapeCount: results.filter((result) => !result.graphImproved).length,
    },
    results,
  };

  const outputDirectory = join(resolvePrivateDataRoot({ sourceRoot: ROOT, dataRoot }), 'assembly-repair-benchmark');
  await ensurePrivateDirectory(outputDirectory);
  const reportPath = join(outputDirectory, `${stableTimestamp(now)}-benchmark.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: PRIVATE_FILE_MODE });
  return { report, reportPath };
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const referenceIndex = process.argv.indexOf('--reference-report');
  const { report, reportPath } = await benchmarkAssemblyRepairs({ referenceReportPath: referenceIndex === -1 ? null : process.argv[referenceIndex + 1] });
  for (const result of report.results) {
    console.log([
      `Shape ${result.shapeNumber}`,
      `groundless ${result.baseline.structural.groundlessComponentCount}->${result.adjusted.structural.groundlessComponentCount}`,
      `unsupported ${result.baseline.structural.unsupportedBrickCount}->${result.adjusted.structural.unsupportedBrickCount}`,
      `assembly roots ${result.adjusted.assemblyFeedback.baseline.rootFailureCount}->${result.adjusted.assemblyFeedback.final.rootFailureCount}`,
      `unresolved ${result.adjusted.assemblyFeedback.baseline.unresolvedBrickCount}/${result.adjusted.assemblyFeedback.baseline.brickCount}->${result.adjusted.assemblyFeedback.final.unresolvedBrickCount}/${result.adjusted.assemblyFeedback.final.brickCount}`,
      `additions ${result.additionBudget.accepted}/${result.additionBudget.limit}`,
      `${result.adjusted.conversionMs.toFixed(1)} ms`,
    ].join(' | '));
  }
  console.log(`Wrote ${basename(reportPath)}.`);
}
