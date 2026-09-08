import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileDetailTuples, expandDetailProgram } from '../src/detail-program.js';
import { validateVoxels } from '../src/voxels.js';

const here = dirname(fileURLToPath(import.meta.url));
const created = '2026-09-06';
const color = 'D';
const limitation = 'Authored detail study; not automatic generation or buildability proof. Digital voxel geometry only; stability, assembly order, exact parts, and physical construction are unverified.';

const box = (x, y, z, w, h, d) => ['b', x, y, z, w, h, d, color];
const profile = (x, y, z, w, d, levels, rise, insetX, insetZ, shiftX = 0, shiftZ = 0) => (
  { type: 'profile', x, y, z, w, d, levels, rise, insetX, insetZ, shiftX, shiftZ, color }
);
const frame = (x, y, z, w, h, d, axis, thickness = 1) => (
  { type: 'frame', x, y, z, w, h, d, axis, thickness, color }
);

function study(id, label, prompt, detail, ops) {
  return {
    id,
    label,
    source: { ops },
    meta: {
      id,
      prompt,
      method: 'authored-detail-study',
      provenance: 'authored-fixture',
      created,
      detailStudy: detail,
      limitations: limitation,
    },
  };
}

const studies = [
  study('detail-tower-simple', 'tower · solid/simple detail study',
    'authored paired study: a compact civic tower with solid simple massing', 'tower before: ordinary boxes only', [
      box(8, 0, 8, 20, 3, 16), box(10, 3, 9, 16, 16, 14),
      box(12, 19, 10, 12, 8, 12), box(15, 27, 13, 6, 5, 6),
      box(7, 0, 11, 3, 9, 10), box(26, 0, 11, 3, 9, 10),
    ]),
  study('detail-tower-stepped-open', 'tower · stepped/open detail study',
    'authored paired study: a compact civic tower with stepped crown and framed openings', 'tower after: profile crown and frame bays', [
      box(8, 0, 8, 20, 3, 16),
      frame(10, 3, 9, 16, 16, 3, 'z', 2), frame(10, 3, 20, 16, 16, 3, 'z', 2),
      box(10, 3, 12, 3, 16, 8), box(23, 3, 12, 3, 16, 8),
      profile(12, 19, 10, 12, 12, 4, 2, 1, 1), box(15, 27, 13, 6, 5, 6),
      frame(7, 0, 11, 3, 9, 10, 'x', 2), frame(26, 0, 11, 3, 9, 10, 'x', 2),
    ]),
  study('detail-probe-simple', 'space probe · solid/simple detail study',
    'authored paired study: a deep-space probe with a block body, panels, engine, and antenna', 'probe before: ordinary boxes only', [
      box(22, 10, 22, 14, 12, 14), box(16, 14, 25, 6, 4, 8), box(36, 14, 25, 6, 4, 8),
      box(4, 13, 23, 12, 6, 12), box(42, 13, 23, 12, 6, 12),
      box(25, 13, 14, 8, 6, 8), box(24, 12, 8, 10, 8, 6),
      box(26, 22, 26, 6, 6, 6), box(23, 28, 23, 12, 3, 12),
    ]),
  study('detail-probe-stepped-open', 'space probe · stepped/open detail study',
    'authored paired study: a deep-space probe with stepped engine collars and a hollow antenna rim', 'probe after: profile collars and frame antenna', [
      box(22, 10, 22, 14, 12, 14), box(16, 14, 25, 6, 4, 8), box(36, 14, 25, 6, 4, 8),
      box(4, 13, 23, 12, 2, 12), frame(4, 15, 23, 12, 4, 12, 'y', 2),
      box(42, 13, 23, 12, 2, 12), frame(42, 15, 23, 12, 4, 12, 'y', 2),
      profile(25, 13, 14, 8, 8, 3, 2, 1, 1, 0, -2), box(24, 12, 8, 10, 8, 6),
      box(26, 22, 26, 6, 6, 6), frame(23, 28, 23, 12, 3, 12, 'y', 2),
    ]),
];

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex === -1 || !process.argv[outputIndex + 1]) throw new Error('Usage: node scripts/build-detail-fixtures.mjs --output-dir DIR');
const outDir = resolve(process.argv[outputIndex + 1]);
const indexPath = join(outDir, 'index.json');
await mkdir(outDir, { recursive: true });
const previousIndex = JSON.parse(await readFile(indexPath, 'utf8'));
if (!Array.isArray(previousIndex) || previousIndex.length < 3) throw new Error('Expected the existing Prepared A-C fixture index.');
const retained = previousIndex.filter((entry) => !studies.some((studyItem) => studyItem.id === entry.id));
const report = { created, scope: 'bounded authored detail vocabulary study; local compile timing is not a speed guarantee', fixtures: [] };

for (const studyItem of studies) {
  const started = process.hrtime.bigint();
  const tuples = compileDetailTuples(studyItem.source);
  const model = expandDetailProgram(studyItem.source, studyItem.meta);
  const localCompileMs = Number(process.hrtime.bigint() - started) / 1e6;
  const validation = validateVoxels(model);
  if (!validation.valid) throw new Error(`${studyItem.id} failed validation: ${validation.errors.join('; ')}`);
  await writeFile(join(outDir, `${studyItem.id}.detail.json`), `${JSON.stringify(studyItem.source, null, 2)}\n`);
  await writeFile(join(outDir, `${studyItem.id}.json`), `${JSON.stringify(model, null, 2)}\n`);
  await writeFile(join(outDir, `${studyItem.id}.validation.json`), `${JSON.stringify(validation, null, 2)}\n`);
  const macroCount = studyItem.source.ops.filter((operation) => !Array.isArray(operation)).length;
  report.fixtures.push({ id: studyItem.id, macroCount, expandedOperations: tuples.length, cells: model.cells.length, localCompileMs });
  retained.push({ id: studyItem.id, label: studyItem.label, url: `/fixtures/${studyItem.id}.json` });
  console.log(`${studyItem.id}: ${macroCount} macros; ${tuples.length} expanded operations; ${model.cells.length} cells`);
}

await writeFile(join(outDir, 'detail-study.report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(indexPath, `${JSON.stringify(retained, null, 2)}\n`);
}
