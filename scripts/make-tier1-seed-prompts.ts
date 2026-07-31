// Generate the Tier-1 seed packet: probe8 prompt v2 (verbatim buildPrompt)
// over the 50 Tier-1 terms NOT already in the seed4 cached library —
// data/seed-pool/tier1.txt from `dog` onward. Full-authorship, noun-only,
// no front mask. Batched ~10/round so contact-sheet QA runs between batches.
//
// Usage: npx tsx scripts/make-tier1-seed-prompts.ts
//
// One batch = one runs/tier1-16char-bN/ dir with prompts/ + run.json.
// Subscription subagents design the three views ($0 API), validate via
// scripts/retry-feedback.ts --max-depth=6 (single-shot + 1 retry), and the
// final response text lands in responses/<term>.txt for convert-response.ts.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG_Z } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;
const DEPTH_CAP = 6;

// The 50 Tier-1 terms not in the seed4 library (tier1.txt from `dog` onward),
// grouped into ~10-term batches for between-batch eyeball QA. Slugs are
// hyphenated; prompted as words.
const BATCHES: Record<string, string[]> = {
  b1: ['dog', 'coffee-cup', 'birthday-cake', 'fire-truck', 'dinosaur', 'rose', 'castle', 'airplane', 'train', 'boat'],
  b2: ['truck', 'bus', 'bicycle', 'motorcycle', 'helicopter', 'tractor', 'submarine', 'elephant', 'bear', 'rabbit'],
  b3: ['lion', 'tiger', 'monkey', 'whale', 'shark', 'dolphin', 'turtle', 'owl', 'butterfly', 'bee'],
  b4: ['crab', 'snowman', 'pumpkin', 'flower', 'sun', 'star', 'apple', 'banana', 'pizza', 'hamburger'],
  b5: ['guitar', 'camera', 'skyscraper', 'bridge', 'windmill', 'crown', 'key', 'umbrella', 'teddy-bear', 'eiffel-tower'],
};

const fence = '```';

// Verbatim probe8 prompt v2 (make-probe8-prompts.ts / make-improve1-prompts.ts)
// — the validated full-authorship recipe.
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

for (const [batch, terms] of Object.entries(BATCHES)) {
  const runId = `tier1-16char-${batch}`;
  const runDir = join(RUNS, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });
  mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
  mkdirSync(join(runDir, 'responses'), { recursive: true });
  for (const term of terms) {
    const noun = term.replace(/-/g, ' ');
    writeFileSync(join(runDir, 'prompts', `${term}.md`), buildPrompt(noun));
  }
  const manifest = {
    id: runId,
    label: `tier1 seed ${batch.toUpperCase()} · authored-front, noun-only`,
    date: '2026-07-21',
    pipeline:
      'Pre-seed Tier-1 library: probe8 full-authorship prompt v2 (DOG_Z exemplar, noun only, no source mask) for Tier-1 terms not in the seed4 library. Subscription subagents design all three views ($0 API, Sonnet-5 adaptive thinking); single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6); strict hull lift via convert-response.ts. Contact-sheet eyeball QA between batches.',
    conditions: {
      grid: String(SIZE),
      encoding: 'char',
      model: 'claude-sonnet-5',
      prompt: 'full-authorship v2 (probe8 verbatim)',
      source: 'none — noun only',
      method:
        'single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6); run via subscription subagents ($0, adaptive thinking)',
    },
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${terms.length} prompts + run.json → runs/${runId}/`);
}
