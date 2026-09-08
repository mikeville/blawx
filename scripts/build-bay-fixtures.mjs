import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileDetailTuples, expandDetailProgram } from '../src/detail-program.js';
import { validateVoxels } from '../src/voxels.js';

const here = dirname(fileURLToPath(import.meta.url));
const created = '2026-09-06';
const color = 'D';
const limitations = 'Authored bays study; not automatic generation or buildability proof. Digital voxel geometry only; stability, assembly order, exact parts, and physical construction are unverified.';
const box = (x, y, z, w, h, d) => ['b', x, y, z, w, h, d, color];
const bays = (x, y, z, axis) => ({ type: 'bays', x, y, z, axis, columns: 4, rows: 2, bayW: 4, bayH: 5, pier: 2, beam: 2, depth: 3, color });

function fixture(id, label, prompt, detailStudy, source) {
  return { id, label, source, meta: { id, prompt, method: 'authored-bays-study', provenance: 'authored-fixture', created, detailStudy, limitations } };
}

const fixtures = [
  fixture('bay-panel-solid', 'architectural panel · solid bays control',
    'authored paired study: a heavy architectural wall with a solid inset panel',
    'solid-panel control for repeated architectural bays',
    { ops: [box(5, 0, 10, 26, 3, 5), box(5, 3, 11, 26, 16, 3)] }),
  fixture('bay-panel-open', 'architectural panel · open repeated bays',
    'authored paired study: a structural architectural wall with repeated open bays',
    'perforated-panel treatment with owned through-apertures',
    { ops: [box(5, 0, 10, 26, 3, 5), bays(5, 3, 11, 'z')] }),
  fixture('bay-mechanical-grille', 'mechanical grille · horizontal repeated bays',
    'authored reuse study: an open horizontal mechanical grille made from repeated bays',
    'same bays vocabulary reused as an open horizontal mechanical grille on perimeter support rails',
    { ops: [
      box(5, 5, 10, 26, 2, 2), box(5, 5, 24, 26, 2, 2),
      box(5, 5, 12, 2, 2, 12), box(29, 5, 12, 2, 2, 12),
      bays(5, 7, 10, 'y'),
    ] }),
];

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex === -1 || !process.argv[outputIndex + 1]) throw new Error('Usage: node scripts/build-bay-fixtures.mjs --output-dir DIR');
const outDir = resolve(process.argv[outputIndex + 1]);
const indexPath = join(outDir, 'index.json');
await mkdir(outDir, { recursive: true });
const previousIndex = JSON.parse(await readFile(indexPath, 'utf8'));
if (!Array.isArray(previousIndex) || previousIndex.length < 7) throw new Error('Expected the existing Prepared A-G fixture index.');
const retained = previousIndex.filter((entry) => !fixtures.some((fixtureItem) => fixtureItem.id === entry.id));
const report = { created, scope: 'bounded authored bays vocabulary study; no generation timing claim', fixtures: [] };

for (const fixtureItem of fixtures) {
  const tuples = compileDetailTuples(fixtureItem.source);
  const model = expandDetailProgram(fixtureItem.source, fixtureItem.meta);
  const validation = validateVoxels(model);
  if (!validation.valid) throw new Error(`${fixtureItem.id} failed validation: ${validation.errors.join('; ')}`);
  await writeFile(join(outDir, `${fixtureItem.id}.detail.json`), `${JSON.stringify(fixtureItem.source, null, 2)}\n`);
  await writeFile(join(outDir, `${fixtureItem.id}.json`), `${JSON.stringify(model, null, 2)}\n`);
  await writeFile(join(outDir, `${fixtureItem.id}.validation.json`), `${JSON.stringify(validation, null, 2)}\n`);
  report.fixtures.push({ id: fixtureItem.id, macroCount: fixtureItem.source.ops.filter((operation) => !Array.isArray(operation)).length, expandedOperations: tuples.length, cells: model.cells.length });
  retained.push({ id: fixtureItem.id, label: fixtureItem.label, url: `/fixtures/${fixtureItem.id}.json` });
  console.log(`${fixtureItem.id}: ${tuples.length} expanded operations; ${model.cells.length} cells`);
}

await writeFile(join(outDir, 'bay-study.report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(indexPath, `${JSON.stringify(retained, null, 2)}\n`);
}
