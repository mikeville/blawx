// Generate the Phase 1b sweep packet: one prompt file per noun × condition,
// staged under runs/sweep1-<size>-<encoding>/prompts/. Mike pastes each
// prompt into a fresh Claude chat and saves the raw response to
// runs/<run-id>/responses/<noun>.txt, then runs convert-response.ts on it.
// No API calls happen anywhere in this flow.
//
// Usage:
//   npx tsx scripts/make-prompts.ts          # 12-noun stratified subset
//   npx tsx scripts/make-prompts.ts --all    # full 30-noun list

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NOUNS } from '../src/bench/nouns.ts';
import type { Encoding } from '../src/bench/encodings.ts';

const SWEEP = 'sweep1';
const SIZES = [8, 16, 32] as const;
const ENCODINGS: Encoding[] = ['char', 'rle'];

// Stratified round-one subset: 4 per category. Full list via --all.
const SUBSET = [
  'mug', 'chair', 'house', 'sailboat',
  'fox', 'bird', 'fish', 'tree',
  'octopus', 'robot', 'love', 'rocket ship',
];

const useAll = process.argv.includes('--all');
const nouns = useAll
  ? NOUNS.map((n) => n.noun)
  : NOUNS.map((n) => n.noun).filter((n) => SUBSET.includes(n));

const fence = '```';

function encodingSpec(size: number, encoding: Encoding): string {
  if (encoding === 'char') {
    return `Each row is exactly ${size} characters: "#" = filled, "." = empty.
Each mask has exactly ${size} rows.

Example masks for a 4x4 sphere:

${fence}front
.##.
####
####
.##.
${fence}`;
  }
  return `Each row is run-length encoded: count+symbol pairs that sum to exactly ${size}.
"1.2#1." means 1 empty, 2 filled, 1 empty. "${size}." is an all-empty row.
One row per line, top to bottom. Each mask has exactly ${size} lines.

Example mask for a 4x4 sphere:

${fence}front
1.2#1.
4#
4#
1.2#1.
${fence}`;
}

function prompt(noun: string, size: number, encoding: Encoding): string {
  return `Design a tiny voxel icon of: "${noun}"

Think of it as an isometric game icon, not a 3D model: one instantly
recognizable silhouette. Choose the object's most recognizable orientation
(animals: side profile). Ground it at the bottom of the grid and make it
fill most of the grid.

Output three orthographic silhouette masks of that one solid object on a
${size}x${size} grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

Consistency rule: all three masks are projections of the same solid, so they
must agree — e.g. every row that is filled in the front mask must also be
filled somewhere in the same row of the side mask.

${encodingSpec(size, encoding)}

Output exactly three fenced code blocks labeled front, side, top. No other text.`;
}

let files = 0;
for (const size of SIZES) {
  for (const encoding of ENCODINGS) {
    const runId = `${SWEEP}-${size}-${encoding}`;
    const dir = join(import.meta.dirname, '..', 'runs', runId);
    mkdirSync(join(dir, 'prompts'), { recursive: true });
    mkdirSync(join(dir, 'responses'), { recursive: true });
    for (const noun of nouns) {
      writeFileSync(
        join(dir, 'prompts', `${noun.replace(/\s+/g, '-')}.md`),
        prompt(noun, size, encoding),
      );
      files += 1;
    }
    writeFileSync(
      join(dir, 'run.json'),
      JSON.stringify(
        {
          id: runId,
          label: `${SWEEP} ${size}³ ${encoding === 'char' ? 'char-grid' : 'run-length'}`,
          date: new Date().toISOString().slice(0, 10),
          pipeline: 'sweep: direct three-view mask emission + strict hull lift',
          conditions: {
            grid: String(size),
            encoding,
            model: 'FILL IN: chat model used for the pastes',
          },
        },
        null,
        2,
      ) + '\n',
    );
  }
}
console.log(
  `wrote ${files} prompts across ${SIZES.length * ENCODINGS.length} runs (${nouns.length} nouns${useAll ? ', full list' : ', subset'})`,
);
