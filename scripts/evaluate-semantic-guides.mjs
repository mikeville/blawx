import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { completeConstruction } from '../src/complete-construction.js';
import { createGuideSections } from '../src/guide-sections.js';
import { deriveGuidePresentation } from '../src/guide-presentation.js';
import { createGuideNumbering } from '../src/guide-numbering.js';
import { createSemanticGuideInput, applySemanticGuide } from '../src/semantic-guide.js';
import { createSemanticGuideService } from '../server/semantic-guide-service.js';
import { SETS } from '../mockups/feed/shared.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

export async function evaluateSemanticGuides({ args = process.argv.slice(2), dataRoot } = {}) {
const root = new URL('../', import.meta.url);
const live = args.includes('--live');
const paired = args.includes('--paired');
const maxCalls = Number(args.find(arg => arg.startsWith('--max-calls='))?.split('=')[1] ?? 0);
const requestedVariant = args.find(arg => arg.startsWith('--variant='))?.split('=')[1];
if (requestedVariant && !['frozen-layout', 'current-adjusted'].includes(requestedVariant)) throw new Error('Unknown guide variant.');
if (paired && requestedVariant) throw new Error('Paired evaluation compares both variants.');
if (live && (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 12)) {
  throw new Error('Live evaluation requires an explicit --max-calls=1..12; application retries are disabled.');
}
const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const sourceRoot = new URL('.', root).pathname;
const privateRoot = resolvePrivateDataRoot({ sourceRoot, dataRoot });
const outputPath = join(privateRoot, 'semantic-evaluation', stamp);
await ensurePrivateDirectory(outputPath);
const directory = pathToFileURL(`${outputPath}/`);
const shapes = JSON.parse(await readFile(new URL('public/examples/index.json', root), 'utf8'));
const service = createSemanticGuideService({ dataRoot: privateRoot });
const report = {
  createdAt: new Date().toISOString(), live, paired, maximumCalls: maxCalls, calls: 0,
  scope: 'Six saved Shapes42–47, frozen layout guides and current adjusted guides. Semantic names are model inferences; coverage checks do not establish name accuracy or buildability. No raw generation or paid API calls.',
  files: {}, results: [],
};
for (const path of ['src/assembly.js', 'src/assembly-diagrams.js', 'src/complete-construction.js', 'src/refine-construction.js', 'src/root-refinement.js', 'src/brick-refinement.js', 'src/guide-sections.js', 'src/guide-presentation.js', 'src/semantic-guide.js', 'server/semantic-guide-service.js']) {
  report.files[path] = hash(await readFile(new URL(path, root), 'utf8'));
}

async function prepareTarget(set, variant) {
    const entry = shapes.find(item => item.shape === set.shape);
    if (!entry) throw new Error(`Curated Shape ${set.shape} is unavailable.`);
    const sourcePath = `public${entry.url}`;
    const bytes = await readFile(new URL(sourcePath, root), 'utf8');
    const rawModel = JSON.parse(bytes);
    const rawBefore = hash(rawModel);
    const started = performance.now();
    const result = variant === 'frozen-layout'
      ? JSON.parse(await readFile(new URL(`mockups/feed/round2/data/${set.id}.json`, root), 'utf8'))
      : completeConstruction({ rawModel, adjustments: true });
    const preparationMs = performance.now() - started;
    const plan = result.instructionPlan ?? result.assemblyPlan;
    const guide = result.guide ?? createGuideSections(plan);
    const subject = rawModel.meta?.prompt ?? set.prompt;
    const input = createSemanticGuideInput({ plan, guide, subject });
    const before = deriveGuidePresentation({ plan, guide, subject });
    const planBefore = hash(plan);
    const guideBefore = hash(guide);
    const sourcePlanBefore = hash(result.assemblyPlan);
    const inputFile = `${set.shape}-${variant}-input.json`;
    await writeFile(new URL(inputFile, directory), `${JSON.stringify(input, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
    const row = {
      shape: set.shape, set: set.id, variant, subject, fingerprint: input.fingerprint,
      inputFile, inputBytes: Buffer.byteLength(JSON.stringify(input)), sourcePath, rawHash: hash(bytes),
      preparationMs, beforeLabels: before.sections.map(section => section.label),
    };
    return { row, input, result, plan, guide, subject, rawModel, rawBefore, planBefore, guideBefore, sourcePlanBefore };
}

async function recordTarget(context, receipt, failure = null) {
    const { row, input, result, plan, guide, subject, rawModel, rawBefore, planBefore, guideBefore, sourcePlanBefore } = context;
    try {
      if (failure) throw failure;
      if (!receipt) {
        row.status = 'not-cached';
      } else {
        const semanticGuide = applySemanticGuide({ plan, guide, subject, annotation: receipt.annotation });
        const presentation = deriveGuidePresentation({ plan, guide: semanticGuide, subject });
        const numbering = createGuideNumbering(presentation.sections);
        assert.equal(hash(plan), planBefore);
        assert.equal(hash(guide), guideBefore);
        assert.equal(hash(result.assemblyPlan), sourcePlanBefore);
        assert.equal(hash(rawModel), rawBefore);
        assert.deepEqual(semanticGuide.sections.flatMap(section => section.stepIds), plan.steps.map(step => step.id));
        assert.equal(presentation.stats.coverageComplete, true);
        assert.equal(presentation.sections.flatMap(section => section.totalInventory).reduce((sum, part) => sum + part.count, 0), plan.bricks.length);
        assert.equal(semanticGuide.sections.flatMap(section => section.groups).flatMap(group => group.stepIds).length, plan.steps.length);
        row.status = 'validated';
        row.metadata = receipt.metadata;
        row.sourceOperationsPreserved = true;
        row.rawAndPlacementsPreserved = true;
        row.inventoryComplete = true;
        row.diagramCount = numbering.diagramCount;
        row.sections = presentation.sections.map(section => ({
          label: section.label, stepIds: section.stepIds, repeatCount: section.repeatCount,
          brickCount: section.brickCount, status: section.status,
          confidence: section.semanticConfidence, evidence: section.semanticEvidence,
        }));
        await writeFile(new URL(`${row.shape}-${row.variant}-annotation.json`, directory), `${JSON.stringify(receipt, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
      }
    } catch (error) {
      row.status = 'failed';
      row.error = error.message;
      row.requestId = error.requestId ?? null;
    }
    report.results.push(row);
    await writeFile(new URL('report.json', directory), `${JSON.stringify(report, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
    console.log(JSON.stringify({ shape: row.shape, variant: row.variant, status: row.status, fingerprint: input.fingerprint, labels: row.sections?.map(section => section.label), error: row.error, calls: report.calls }));
}

for (const set of [...SETS].sort((a, b) => a.shape - b.shape)) {
  const variants = requestedVariant ? [requestedVariant] : ['frozen-layout', 'current-adjusted'];
  const contexts = [];
  for (const variant of variants) contexts.push(await prepareTarget(set, variant));
  if (paired && live && report.calls < maxCalls) {
    report.calls += 1;
    try {
      const receipts = await service.annotateBatch(contexts.map(context => context.input), { refresh: true });
      assert.equal(receipts.length, contexts.length);
      for (let i = 0; i < contexts.length; i++) await recordTarget(contexts[i], receipts[i]);
    } catch (error) {
      for (const context of contexts) await recordTarget(context, null, error);
    }
    continue;
  }
  for (const context of contexts) {
    try {
      let receipt = await service.lookup(context.input.fingerprint);
      if (!receipt && live && !paired && report.calls < maxCalls) {
        report.calls += 1;
        receipt = await service.annotate(context.input);
      }
      await recordTarget(context, receipt);
    } catch (error) { await recordTarget(context, null, error); }
  }
}
await writeFile(join(privateRoot, 'semantic-evaluation', 'latest.json'), `${JSON.stringify({ report: `${stamp}/report.json` }, null, 2)}\n`, { mode: PRIVATE_FILE_MODE });
console.log(`Report: ${directory.pathname}report.json`);
if (report.results.some(result => result.status === 'failed')) process.exitCode = 1;
return report;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  evaluateSemanticGuides().catch(error => { console.error(error.message); process.exitCode = 1; });
}
