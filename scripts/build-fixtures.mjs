import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { compileProgram, validateModel } from '../src/geometry.js';

const here = dirname(fileURLToPath(import.meta.url));
const created = '2026-09-06';

const box = (x, y, z, w, h, d, color) => ({ type: 'box', x, y, z, w, h, d, color });
const ellipsoid = (x, y, z, w, h, d, color) => ({ type: 'ellipsoid', x, y, z, w, h, d, color });
const taper = (x, y, z, w, h, d, topW, topD, color) => ({ type: 'taper', x, y, z, w, h, d, topW, topD, color });

function program(prompt, id, maxBricks, limitations, operations) {
  return {
    operations,
    meta: {
      id,
      prompt,
      method: 'construction',
      provenance: 'authored-fixture',
      created,
      generationMs: null,
      maxBricks,
      limitations,
    },
  };
}

function cat() {
  const fur = 'orange';
  return program('cat', 'cat-construction', 800,
    'Manually authored compiler study; not a text-generation result. Preliminary digital geometry only: exact part/color availability, stability, assembly order, and physical buildability are unverified.', [
      // Seated silhouette: broad haunches behind a narrow upright chest.
      ellipsoid(2, 0, 3, 6, 5, 6, fur),
      taper(3, 3, 3, 4, 7, 4, 3, 3, fur),
      box(3, 0, 0, 2, 2, 5, fur), box(6, 0, 0, 2, 2, 5, fur),
      box(3, 0, 0, 2, 1, 2, 'white'), box(6, 0, 0, 2, 1, 2, 'white'),
      // Head, cheeks, muzzle, ears, and brow give readable feline planes.
      ellipsoid(2, 9, 2, 7, 6, 6, fur),
      taper(2, 14, 2, 3, 4, 3, 1, 1, fur), taper(6, 14, 2, 3, 4, 3, 1, 1, fur),
      box(3, 17, 3, 1, 1, 1, 'tan'), box(7, 17, 3, 1, 1, 1, 'tan'),
      box(2, 11, 1, 2, 2, 2, fur), box(7, 11, 1, 2, 2, 2, fur),
      box(4, 10, 0, 3, 2, 2, 'white'),
      box(5, 11, 0, 1, 1, 1, 'brown'), box(4, 10, 0, 1, 1, 1, 'white'), box(6, 10, 0, 1, 1, 1, 'white'),
      box(3, 13, 0, 1, 1, 1, 'green'), box(7, 13, 0, 1, 1, 1, 'green'),
      box(3, 13, -1, 1, 1, 1, 'black'), box(7, 13, -1, 1, 1, 1, 'black'),
      // White bib and a raised, hooked tail complete the side/rear read.
      taper(4, 3, 1, 3, 7, 2, 2, 1, 'white'),
      box(8, 2, 6, 5, 2, 2, fur), box(11, 4, 6, 2, 4, 2, fur),
      box(10, 7, 6, 3, 2, 2, fur), box(9, 8, 6, 2, 2, 2, fur),
    ]);
}

function composition() {
  const ops = [
    // Layered surf is both scene context and honest support for the airborne arc.
    box(0, 0, 0, 34, 1, 22, 'blue'),
    box(2, 1, 2, 8, 1, 3, 'white'), box(20, 1, 16, 11, 1, 3, 'white'),
    box(10, 1, 9, 5, 2, 4, 'blue'), box(14, 1, 10, 4, 4, 3, 'blue'),
    box(17, 1, 11, 4, 7, 3, 'blue'), box(20, 1, 12, 4, 10, 3, 'blue'),
    // Giant squid sits low and wide beneath the leap.
    ellipsoid(2, 2, 6, 10, 7, 9, 'red'),
    ellipsoid(4, 6, 8, 6, 5, 6, 'orange'),
    box(3, 7, 6, 2, 2, 2, 'white'), box(9, 7, 6, 2, 2, 2, 'white'),
    box(3, 7, 5, 1, 1, 1, 'black'), box(10, 7, 5, 1, 1, 1, 'black'),
    box(2, 2, 13, 2, 2, 7, 'red'), box(5, 2, 14, 2, 2, 7, 'red'),
    box(8, 2, 14, 2, 2, 7, 'red'), box(11, 2, 12, 2, 2, 8, 'red'),
    box(0, 1, 18, 4, 2, 2, 'red'), box(12, 1, 18, 4, 2, 2, 'red'),
    // Shark climbs rightward; tail, dorsal fin, belly, snout, and eyes stay distinct.
    taper(18, 10, 7, 14, 6, 7, 9, 5, 'darkGray'),
    taper(29, 12, 8, 6, 4, 5, 2, 3, 'darkGray'),
    taper(14, 11, 8, 6, 4, 5, 2, 3, 'darkGray'),
    taper(13, 14, 6, 5, 7, 3, 1, 1, 'darkGray'), taper(13, 14, 11, 5, 7, 3, 1, 1, 'darkGray'),
    box(20, 10, 7, 10, 2, 7, 'white'),
    taper(23, 15, 9, 5, 5, 3, 1, 1, 'darkGray'),
    box(29, 14, 7, 1, 1, 1, 'black'), box(29, 14, 14, 1, 1, 1, 'black'),
    box(32, 12, 9, 2, 1, 3, 'white'),
    // Small riding cat: four gripping paws bridge visibly into the shark's back.
    box(21, 16, 8, 2, 2, 2, 'orange'), box(27, 16, 8, 2, 2, 2, 'orange'),
    ellipsoid(21, 18, 8, 8, 6, 5, 'orange'),
    ellipsoid(22, 23, 8, 7, 5, 5, 'orange'),
    taper(22, 27, 8, 3, 3, 2, 1, 1, 'orange'), taper(26, 27, 8, 3, 3, 2, 1, 1, 'orange'),
    box(23, 25, 7, 1, 1, 1, 'green'), box(27, 25, 7, 1, 1, 1, 'green'),
    box(24, 23, 7, 3, 2, 1, 'white'), box(25, 24, 6, 1, 1, 1, 'brown'),
    box(21, 20, 12, 7, 2, 2, 'orange'), box(20, 21, 12, 2, 4, 2, 'orange'),
  ];
  return program('cat riding a shark jumping over a giant squid', 'cat-shark-squid-construction', 1800,
    'Manually authored compiler study with visible water-column supports; not a text-generation result. Connections are geometric adjacency only, not proof of stability, assembly order, exact part/color availability, or physical buildability.', ops);
}

function city() {
  const ops = [
    box(0, 0, 0, 46, 1, 38, 'darkGray'),
    // Two orthogonal luminous transit spines divide four legible districts.
    box(0, 1, 17, 46, 1, 4, 'lightGray'), box(21, 1, 0, 4, 1, 38, 'lightGray'),
    box(0, 2, 18, 46, 1, 2, 'blue'), box(22, 2, 0, 2, 1, 38, 'blue'),
    // Central civic tower and stepped crown.
    taper(17, 1, 13, 12, 22, 12, 7, 7, 'white'),
    taper(19, 23, 15, 8, 12, 8, 3, 3, 'lightGray'), box(22, 35, 18, 2, 7, 2, 'blue'),
    box(18, 9, 12, 10, 1, 1, 'blue'), box(18, 16, 12, 10, 1, 1, 'blue'),
    // Northwest paired towers with a high skybridge.
    taper(3, 1, 3, 8, 18, 8, 5, 5, 'darkGray'), taper(12, 1, 4, 7, 14, 7, 4, 4, 'lightGray'),
    box(7, 13, 6, 8, 2, 3, 'white'), box(5, 8, 2, 4, 1, 1, 'blue'),
    // Northeast needle cluster and lower podiums.
    taper(30, 1, 3, 8, 25, 8, 3, 3, 'white'), box(33, 26, 6, 2, 8, 2, 'blue'),
    taper(39, 1, 5, 5, 15, 6, 2, 3, 'lightGray'), box(28, 1, 12, 7, 8, 4, 'darkGray'),
    box(31, 11, 5, 6, 1, 1, 'blue'), box(40, 8, 4, 3, 1, 1, 'blue'),
    // Southwest terraced cultural district.
    taper(3, 1, 24, 15, 9, 10, 9, 6, 'tan'),
    box(5, 10, 26, 11, 2, 6, 'white'), box(8, 12, 27, 5, 3, 4, 'green'),
    box(1, 2, 34, 18, 2, 3, 'blue'),
    // Southeast dense vertical district with staggered massing.
    taper(29, 1, 24, 7, 17, 7, 4, 4, 'darkGray'),
    taper(37, 1, 23, 7, 21, 8, 3, 4, 'lightGray'),
    taper(27, 1, 32, 6, 11, 5, 3, 2, 'white'),
    taper(35, 1, 33, 10, 8, 4, 6, 2, 'tan'),
    box(32, 12, 26, 8, 2, 3, 'white'), box(39, 15, 25, 4, 1, 1, 'blue'),
    // Elevated ring segments and gateway pylons make city circulation structural.
    box(7, 6, 16, 12, 2, 2, 'white'), box(25, 6, 16, 14, 2, 2, 'white'),
    box(20, 6, 5, 2, 2, 9, 'white'), box(24, 6, 24, 2, 2, 9, 'white'),
    box(1, 1, 15, 3, 7, 8, 'white'), box(42, 1, 15, 3, 7, 8, 'white'),
  ];
  return program('a massive detailed futuristic cityscape', 'futuristic-city-construction', 3000,
    'Manually authored compiler study, scaled as a compact city rather than evidence of arbitrary-detail generation. Preliminary digital geometry only: overlaps are unioned by the compiler; stability, assembly order, exact part/color availability, and physical buildability are unverified.', ops);
}

const fixtures = [cat(), composition(), city()];
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
const outputIndex = process.argv.indexOf('--output-dir');
if (outputIndex === -1 || !process.argv[outputIndex + 1]) throw new Error('Usage: node scripts/build-fixtures.mjs --output-dir DIR');
const outDir = resolve(process.argv[outputIndex + 1]);
await mkdir(outDir, { recursive: true });

const index = [];
for (const fixture of fixtures) {
  const id = fixture.meta.id;
  const compiled = compileProgram(fixture, { maxBricks: fixture.meta.maxBricks });
  const validation = validateModel(compiled);
  await writeFile(join(outDir, `${id}.program.json`), `${JSON.stringify(fixture, null, 2)}\n`);
  await writeFile(join(outDir, `${id}.json`), `${JSON.stringify(compiled, null, 2)}\n`);
  await writeFile(join(outDir, `${id}.validation.json`), `${JSON.stringify(validation, null, 2)}\n`);
  index.push({ id, label: `${fixture.meta.prompt} · authored construction`, url: `/fixtures/${id}.json` });
  console.log(`${id}: ${compiled.bricks.length} bricks; validation ${validation.valid ? 'passed' : 'failed'}`);
  for (const error of validation.errors) console.error(`  error: ${error}`);
  for (const warning of validation.warnings) console.warn(`  warning: ${warning}`);
}

await writeFile(join(outDir, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
}
