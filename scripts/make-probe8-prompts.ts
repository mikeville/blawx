// Generate the probe8 packet: probe7 full authorship with PROMPT V2 — the
// top-view z-convention fix. Probe7's verdict was "works" (9/10 clean, clear
// semantic wins), but 9/10 first drafts drew the top view back-to-front
// inverted, burning the single feedback retry on a mechanical fix. Two
// changes aim to reclaim that retry for quality:
//
//   1. The worked example is DOG_Z (see exemplars.ts): its head hugs the
//      front half of the depth and its tail the back half, so the top view
//      itself demonstrates the back-to-front row convention. Probe7's DOG
//      had a front-back symmetric top that carried no z-direction signal.
//   2. The top-view convention line is sharpened: explicit back/front row
//      anchoring against the side view's columns, plus a named warning that
//      drawing the top front-to-back is the most common mistake.
//
// Everything else (nouns, grid, depth cap, front rules, call profile) is
// held identical to probe7 so the z-mirror incidence is the isolated
// variable.
//
// Usage: npx tsx scripts/make-probe8-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG_Z } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const RUN_ID = 'probe8-16char-nomask';
const SIZE = 16;
const DEPTH_CAP = 6; // parity with the probe6/probe7/live route

const NOUNS = [
  'duck',
  'fox',
  'table',
  'grapes',
  'castle',
  'crab',
  'submarine',
  'peanut',
  'helicopter',
  'skyscraper',
];

const fence = '```';

function buildPrompt(noun: string): string {
  return `Design a tiny voxel icon of: "${noun}"

You are designing ALL THREE views of one solid voxel sculpture. The FRONT
view matters most: it must be the canonical, instantly recognizable
silhouette of a ${noun} — the shape someone would draw as a flat icon.
Choose the most recognizable orientation (a side profile for most animals
and vehicles; straight-on for symmetric objects) and draw that as the front.

Views on a ${SIZE}x${SIZE} grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back (first column = the near/front edge, closest to someone looking at the front view); rows top to bottom.
- top — seen from above; columns run left to right (the same left/right as the front view); rows run BACK to FRONT: the first row is the object's far/back edge, the last row is its near/front edge. So a part at the FRONT of the object (leftmost filled columns of the side view) lands in the LAST filled rows of the top view, and a part at the BACK (rightmost side-view columns) lands in the FIRST filled rows. Drawing the top view front-to-back instead is the most common mistake in this task — double-check the row direction before you answer.

Front mask rules:

- BIG: the object spans (nearly) the full ${SIZE} cells in its longer
  dimension.
- GROUNDED: the object's lowest cells sit on the bottom row.
- ONE PIECE: every "#" cell connects to the rest edge-to-edge — this becomes
  a LEGO build and must hold together as a single object.
- Real proportions, with the identifying features exaggerated enough to
  survive ${SIZE}x${SIZE} (a duck's bill, a table's legs, a castle's
  battlements).

Design the side and top views so the object reads as a 3D-native isometric
sprite, not a flat cutout:

- Do NOT extrude the front at one constant thickness — vary the depth per
  part. A head is thinner than a body; legs are thin and can sit at
  different depths front-to-back; a handle or fin is thinner than the mass
  it attaches to.
- Keep the whole object at most ${DEPTH_CAP} cells deep front-to-back.
- The top view is the object's true footprint seen from above — it should
  taper and round where the object does, never a full-width slab.

Masks are SOLID silhouettes: every cell inside the object's outline is "#",
not just the border. Never draw a hollow outline.

Consistency rules — all three masks are projections of the same solid:
- Every row filled in the front mask is filled in the same row of the side mask, and vice versa (they share the object's height).
- Every column filled in the front mask is filled in the same column of the top mask, and vice versa (they share the object's width).
- Every column filled in the side mask corresponds to a filled row of the top mask (they share the object's depth).

Before the masks, output one line declaring the object's occupied extents:
bounds x:<min>-<max> y:<min>-<max> z:<min>-<max>
(x = width columns, y = height with 0 at the bottom, z = depth with 0 at the
near/front edge). Then make every mask agree exactly with those extents.

Each row is exactly ${SIZE} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${SIZE} rows.

Worked example on an ${DOG_Z.front.length}x${DOG_Z.front.length} grid — a dog authored the same way.
Note the per-part depth: the body is 4 cells deep (z:2-5), each leg pair is
only 1 cell deep at the near and far edges, the head hugs the near/front
half of the depth (z:2-3) and the tail the far/back half (z:4-5). Because of
that, the top view's FIRST filled rows (the back) contain the tail column at
the right edge, and its LAST filled rows (the front) contain the head
columns at the left edge — check that your own top view runs back-to-front
the same way. (At ${SIZE}x${SIZE} your top view should also taper and round
more than this tiny example has room to.)

${DOG_Z.bounds}

${fence}front
${DOG_Z.front.join('\n')}
${fence}

${fence}side
${DOG_Z.side.join('\n')}
${fence}

${fence}top
${DOG_Z.top.join('\n')}
${fence}

Output the bounds line, then exactly three fenced code blocks labeled
front, side, top. No other text.`;
}

const runDir = join(RUNS, RUN_ID);
mkdirSync(join(runDir, 'prompts'), { recursive: true });
mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
mkdirSync(join(runDir, 'responses'), { recursive: true });

for (const noun of NOUNS) {
  const slug = noun.replace(/\s+/g, '-');
  writeFileSync(join(runDir, 'prompts', `${slug}.md`), buildPrompt(noun));
}

const manifest = {
  id: RUN_ID,
  label: 'probe8 16³ · no mask, prompt v2 — top-view z-convention fix',
  date: '2026-07-19',
  pipeline:
    'probe7 rerun with prompt v2: z-asymmetric dog exemplar (head front / tail back so the top view demonstrates the back-to-front row convention) + sharpened top-view wording. Otherwise identical: no sourced front mask, Sonnet authors all three views from the noun alone, single-shot + 1 feedback retry (retry-feedback.ts --max-depth=6), strict lift. Measures whether the 9/10 top-view z-mirror first drafts disappear, reclaiming the retry for quality.',
  conditions: {
    grid: String(SIZE),
    encoding: 'char',
    model: 'claude-sonnet-5',
    prompt: 'full-authorship v2 (canonical-front rules + depth cap 6 + z-asymmetric dog exemplar + explicit top-view back-to-front anchoring)',
    source: 'none — noun only',
    method:
      'single-shot + 1 deterministic-feedback retry; run via subscription subagents ($0 actual, adaptive thinking on — same profile as probe7 for A/A comparability)',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${NOUNS.length} prompts + run.json → runs/${RUN_ID}/`);
