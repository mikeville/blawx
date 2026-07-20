// Generate the probe7 packet: FULL AUTHORSHIP at Sonnet — no sourced front
// mask at all. The model designs all three views from the noun alone. This
// probes whether the entire silhouette-sourcing apparatus (FA index, FLUX
// fallback) is still necessary: probe6 proved Sonnet can add depth to a
// known-good front; probe7 asks whether it can author the front too.
//
// Targets deliberately span today's live failure classes:
//   duck, fox, table       — comparables (good FA fronts exist in seed4/probe6)
//   grapes, castle, crab   — FA alias traps (wine-bottle / chess-rook / cancer)
//   submarine, peanut      — live-FLUX degraded results in today's cache
//   helicopter             — thin-feature disconnection class
//   skyscraper             — simple shape that's junk in today's cache
//
// Usage: npx tsx scripts/make-probe7-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const RUN_ID = 'probe7-16char-nomask';
const SIZE = 16;
const DEPTH_CAP = 6; // parity with the probe6/live route

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
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

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
(x = width columns, y = height with 0 at the bottom, z = depth). Then make
every mask agree exactly with those extents.

Each row is exactly ${SIZE} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${SIZE} rows.

Worked example on an ${DOG.front.length}x${DOG.front.length} grid — a ${DOG.label} authored the same way.
Note the per-part depth: the body is 4 cells deep (z:2-5) but each leg
pair is only 1 cell deep, set at the near and far edges of the body — that
shaping is what makes it read as 3D instead of a cardboard cutout. (Only its
top view is a plain rectangle because 8x8 leaves no room to taper — at
16x16 yours should not be.)

${DOG.bounds}

${fence}front
${DOG.front.join('\n')}
${fence}

${fence}side
${DOG.side.join('\n')}
${fence}

${fence}top
${DOG.top.join('\n')}
${fence}

Output the bounds line, then exactly three fenced code blocks labeled
front, side, top. No other text.`;
}

const runDir = join(RUNS, RUN_ID);
mkdirSync(join(runDir, 'prompts'), { recursive: true });
mkdirSync(join(runDir, 'responses'), { recursive: true });

for (const noun of NOUNS) {
  const slug = noun.replace(/\s+/g, '-');
  writeFileSync(join(runDir, 'prompts', `${slug}.md`), buildPrompt(noun));
}

const manifest = {
  id: RUN_ID,
  label: 'probe7 16³ · no mask — sonnet authors all three views',
  date: '2026-07-19',
  pipeline:
    'full-authorship probe: NO sourced front mask — Sonnet designs front, side, and top from the noun alone (front rules: big/grounded/one-piece; depth cap 6; dog worked example), single-shot + 1 feedback retry (retry-feedback.ts --max-depth=6, self-consistency), strict lift. Probes whether the FA/FLUX silhouette-sourcing stage is necessary at all.',
  conditions: {
    grid: String(SIZE),
    encoding: 'char',
    model: 'claude-sonnet-5',
    prompt: 'full-authorship v1 (canonical-front rules + depth cap 6 + dog worked example)',
    source: 'none — noun only',
    method:
      'single-shot + 1 deterministic-feedback retry; run via subscription subagents ($0 actual, adaptive thinking on — NOT the thinking-disabled runtime profile; see run notes)',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${NOUNS.length} prompts + run.json → runs/${RUN_ID}/`);
