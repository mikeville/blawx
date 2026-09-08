import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expandLoftProgram } from '../src/loft-program.js';
import { validateVoxels } from '../src/voxels.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const id = 'shape30-annulus-authored-variation';
const created = '2026-09-06';
const baselineFixtureIds = [
  'cat-construction',
  'cat-shark-squid-construction',
  'futuristic-city-construction',
  'detail-tower-simple',
  'detail-tower-stepped-open',
  'detail-probe-simple',
  'detail-probe-stepped-open',
  'bay-panel-solid',
  'bay-panel-open',
  'bay-mechanical-grille',
];

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
const args=process.argv.slice(2);
const value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
const sourcePath=value('--source');
const outDir=value('--output-dir');
if(!sourcePath||!outDir) throw new Error('Usage: node scripts/build-annulus-fixture.mjs --source FILE --output-dir DIR');
const indexPath = join(resolve(outDir), 'index.json');
const originalText = await readFile(resolve(sourcePath), 'utf8');
const original = JSON.parse(originalText);
const originalSha256 = createHash('sha256').update(originalText).digest('hex');
if (originalSha256 !== '3ef84a97b4f485d9fdb70773cd1c2e8d1ecb8afa975493626ea5920762fce124') {
  throw new Error('Shape30 source changed; refusing to publish an authored variation from an unknown base.');
}
if (!Array.isArray(original.ops) || original.ops.length !== 24) throw new Error('Expected the original 24-operation Shape30 source.');

const source = {
  ops: [
    ['r', 'x', 11, 2, 4.5, 4.5, 4.5, 2.5, 'K'],
    ['r', 'x', 11, 2, 4.5, 18.5, 4.5, 2.5, 'K'],
    ...original.ops.slice(4),
  ],
};
const meta = {
  id,
  prompt: 'Authored Shape30 variation: Albert Einstein riding a bicycle with circular annulus tires',
  method: 'authored-annulus-variation',
  provenance: 'manually-edited-generated-source-fixture',
  created,
  sourceShape: 'Shape30',
  sourceSha256: originalSha256,
  transformation: 'Replaced generated operations 0–3 with two authored x-axis annuli; all remaining operations are byte-equivalent JSON values from the original parsed source.',
  limitations: 'Manually edited capability example, not an automatic generation result, latency measurement, visual-quality pass, or buildability proof. Digital voxel geometry only; stability, assembly order, exact parts, and physical construction are unverified.',
};
const model = expandLoftProgram(source, meta);
const validation = validateVoxels(model);
if (!validation.valid) throw new Error(`${id} failed validation: ${validation.errors.join('; ')}`);

const previousIndex = JSON.parse(await readFile(indexPath, 'utf8'));
if (!Array.isArray(previousIndex)) throw new Error('Expected the existing Prepared A–J fixture index.');
const retained = previousIndex.filter((entry) => entry.id !== id);
if (retained.length !== baselineFixtureIds.length || retained.some((entry, index) => entry.id !== baselineFixtureIds[index]) ||
    ![baselineFixtureIds.length, baselineFixtureIds.length + 1].includes(previousIndex.length) ||
    (previousIndex.length === baselineFixtureIds.length + 1 && previousIndex.at(-1).id !== id) ||
    new Set(previousIndex.map((entry) => entry.id)).size !== previousIndex.length) {
  throw new Error('Expected the unique Prepared A–J baseline in its established order, optionally followed by this authored variation.');
}
retained.push({ id, label: 'Shape30 annulus tires · authored variation', url: `/fixtures/${id}.json` });

await writeFile(join(resolve(outDir), `${id}.program.json`), `${JSON.stringify({ source, meta }, null, 2)}\n`);
await writeFile(join(resolve(outDir), `${id}.json`), `${JSON.stringify(model, null, 2)}\n`);
await writeFile(join(resolve(outDir), `${id}.validation.json`), `${JSON.stringify(validation, null, 2)}\n`);
await writeFile(join(resolve(outDir), 'annulus-study.report.json'), `${JSON.stringify({
  created,
  scope: 'One bounded authored annulus variation of Shape30; no automatic-generation, latency, visual-pass, or buildability claim.',
  fixture: { id, originalOperations: original.ops.length, authoredOperations: source.ops.length, replacedOriginalOperations: [0, 1, 2, 3], annulusOperations: 2, cells: model.cells.length },
}, null, 2)}\n`);
await writeFile(indexPath, `${JSON.stringify(retained, null, 2)}\n`);

console.log(`${id}: ${source.ops.length} operations; ${model.cells.length} cells; Prepared K`);
}
