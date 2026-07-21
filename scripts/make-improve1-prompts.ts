// Generate the improve1 packet: probe8 prompt v2 (verbatim buildPrompt) over
// the 25 terms the judge1 composite gate flagged in the live cache, in two
// identical arms (-a / -b) so each term gets two independently sampled
// challengers. Challenger vs incumbent ranking happens downstream.
//
// Usage: npx tsx scripts/make-improve1-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG_Z } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;
const DEPTH_CAP = 6;

// judge1-cache-eval composite gate: struct-flag ∪ rubric-judge "bad".
const TERMS = [
  'apple', 'bowl', 'candy-cane', 'castle', 'cat', 'dragon', 'duck', 'frog',
  'grapes', 'helicopter', 'ice-cream-cone', 'lighthouse', 'mug', 'octopus',
  'palm-tree', 'pants', 'peanut', 'rainbow', 'robot', 'sailboat', 'snail',
  'spider', 'squid', 'star', 'submarine',
];

const fence = '```';

// Verbatim probe8 prompt v2 (make-probe8-prompts.ts) — the validated
// full-authorship recipe. Hyphenated cache slugs are prompted as words.
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

for (const arm of ['a', 'b'] as const) {
  const runId = `improve1-16char-${arm}`;
  const runDir = join(RUNS, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });
  mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
  mkdirSync(join(runDir, 'responses'), { recursive: true });
  for (const term of TERMS) {
    const noun = term.replace(/-/g, ' ');
    writeFileSync(join(runDir, 'prompts', `${term}.md`), buildPrompt(noun));
  }
  const manifest = {
    id: runId,
    label: `improve1 challengers arm ${arm.toUpperCase()} · judge1-flagged terms`,
    date: '2026-07-20',
    pipeline:
      'H-D background improver: probe8 full-authorship prompt v2 over the 25 cache terms flagged by the judge1 composite gate (structure ∪ rubric-judge). Two identical arms give each term two independent challengers; blind composite ranking vs the cached incumbent decides replacement. Subscription subagents, $0 API.',
    conditions: {
      grid: String(SIZE),
      encoding: 'char',
      model: 'claude-sonnet-5',
      prompt: 'full-authorship v2 (probe8 verbatim)',
      source: 'none — noun only',
      method:
        'single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6), agent-local loop; run via subscription subagents ($0, adaptive thinking)',
    },
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${TERMS.length} prompts + run.json → runs/${runId}/`);
}
