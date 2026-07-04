// Import prior-attempt voxel outputs from the sibling repo as a
// failure-reference run. Extracts ONLY the first (final) voxel grid from each
// file mechanically — the draft/critique layers preserved at the bottoms of
// those files are prior generation strategy and are deliberately not read.
//
// Usage: npx tsx scripts/import-baselines.ts [baseline-folder-name]
// Default folder: baseline-llm

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const SOURCE_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'blawx',
  'src',
  'voxel',
  'generated',
);

// Hex values from ../blawx/src/render/palette.ts (sanctioned substrate).
const PALETTE: Record<string, string> = {
  red: '#C8102E',
  yellow: '#F4C300',
  blue: '#0A3D91',
  green: '#2E7D32',
  white: '#F7F7F2',
  black: '#1A1A1A',
  lightGray: '#A4ACAE',
};

const folder = process.argv[2] ?? 'baseline-llm';
const srcDir = join(SOURCE_ROOT, folder);
const outDir = join(import.meta.dirname, '..', 'runs', folder);
mkdirSync(outDir, { recursive: true });

const files = readdirSync(srcDir).filter((f) => f.endsWith('.ts'));
let count = 0;

for (const file of files) {
  const text = readFileSync(join(srcDir, file), 'utf8');
  const gridStart = text.indexOf('const grid');
  if (gridStart === -1) {
    console.warn(`skip ${file}: no grid found`);
    continue;
  }
  const gridEnd = text.indexOf('\n};', gridStart);
  const slice = text.slice(gridStart, gridEnd === -1 ? undefined : gridEnd);

  const sizeMatch = slice.match(/size:\s*(\d+)/);
  const termMatch = text.match(/export const term = ["'](.+?)["']/);
  const noun = termMatch?.[1] ?? basename(file, '.ts');
  const size = sizeMatch ? Number(sizeMatch[1]) : 8;

  const voxels: [number, number, number][] = [];
  const colors: string[] = [];
  const re = /\{\s*x:\s*(\d+),\s*y:\s*(\d+),\s*z:\s*(\d+),\s*color:\s*['"](\w+)['"]\s*\}/g;
  for (const m of slice.matchAll(re)) {
    voxels.push([Number(m[1]), Number(m[2]), Number(m[3])]);
    colors.push(PALETTE[m[4]] ?? '#888888');
  }
  if (voxels.length === 0) {
    console.warn(`skip ${file}: no voxels matched`);
    continue;
  }

  const result = {
    noun,
    size,
    voxels,
    colors,
    meta: { notes: `prior-attempt output (${folder}), imported as failure reference` },
  };
  writeFileSync(join(outDir, `${noun.replace(/\s+/g, '-')}.json`), JSON.stringify(result));
  count += 1;
}

const manifest = {
  id: folder,
  label: `${folder} (failure reference)`,
  date: new Date().toISOString().slice(0, 10),
  pipeline: 'prior-attempt import — reference only, not a pipeline under test',
};
writeFileSync(join(outDir, 'run.json'), JSON.stringify(manifest, null, 2));
console.log(`imported ${count} objects into runs/${folder}/`);
