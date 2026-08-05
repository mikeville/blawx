// Generate the tier1-regen1 packet: prompt v2 amended per the approved
// regen round (2026-08-05) over the 13 sets flagged by the tier1-blindpanel
// hindsight pass, in two identical arms (-a / -b) so each term gets two
// independently sampled challengers. Challenger-vs-incumbent ranking happens
// downstream via a blind 2-voter free-naming panel; ties keep the incumbent.
//
// Amendments over the tier1 prompt (each maps to a hypothesis in
// runs/tier1-blindpanel/RESULTS.md):
//   - H-CARICATURE / H-POSE / H-DEPTH: three pre-authoring declaration lines
//     (feature / pose / depth plan) required above the bounds line.
//   - H-WHEELS: a vehicle clause (wheels as proud masses) for vehicle terms.
//   - The top-view row convention stated numerically (the b4/b5 brief
//     addition that eliminated the mis-anchoring class; now in the prompt).
//
// Usage: npx tsx scripts/make-tier1-regen-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG_Z } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;
const DEPTH_CAP = 6;

// The 13 flagged sets from runs/tier1-blindpanel/RESULTS.md, with the batch
// dir holding each incumbent.
export const REGEN_TERMS: Record<string, string> = {
  banana: 'b4',
  bee: 'b3',
  camera: 'b5',
  'coffee-cup': 'b1',
  crown: 'b5',
  dog: 'b1',
  dolphin: 'b3',
  hamburger: 'b4',
  monkey: 'b3',
  motorcycle: 'b2',
  pizza: 'b4',
  shark: 'b3',
  'teddy-bear': 'b5',
};

const VEHICLES = new Set(['motorcycle']);

const fence = '```';

function buildPrompt(noun: string, isVehicle: boolean): string {
  return `Design a tiny voxel icon of: "${noun}"

You are designing ALL THREE views of one solid voxel sculpture. The FRONT
view matters most: it must be the canonical, instantly recognizable
silhouette of a ${noun} — the shape someone would draw as a flat icon.
Choose the most recognizable orientation (a side profile for most animals
and vehicles; straight-on for symmetric objects) and draw that as the front.

Views on a ${SIZE}x${SIZE} grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back (first column = the near/front edge, closest to someone looking at the front view); rows top to bottom.
- top — seen from above; columns run left to right (the same left/right as the front view); rows run BACK to FRONT: the first row is the object's far/back edge, the last row is its near/front edge. So a part at the FRONT of the object (leftmost filled columns of the side view) lands in the LAST filled rows of the top view, and a part at the BACK (rightmost side-view columns) lands in the FIRST filled rows. Numerically: top-view row r holds depth cell z = ${SIZE - 1} - r, so bounds of z:0-${DEPTH_CAP - 1} fill only top rows ${SIZE - DEPTH_CAP}-${SIZE - 1} (the last ${DEPTH_CAP} rows) and leave rows 0-${SIZE - DEPTH_CAP - 1} empty. Drawing the top view front-to-back instead is the most common mistake in this task — double-check the row direction before you answer.

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

The sculpture will be judged from a 30° isometric camera (viewer sees the
front, top and right side at once, never the front straight on), rendered
in a single gray color. All identity must live in the 3D silhouette.

Before designing any mask, commit to the design by writing three
declaration lines — they are part of your answer and go above the bounds
line:

feature: <the ONE silhouette feature that says "${noun}", and how you are
oversizing it. At this size identity lives or dies on a single exaggerated
feature — a rabbit is its tall ears, a dinosaur is its long neck. If
nothing is exaggerated the object reads as a generic blob.>
pose: <how the object is posed, and why that silhouette reads at the 30°
isometric camera — not just in the flat front view.>
depth plan: <the object's real proportions, then per-region extents: for
each major part, its depth (z) span and height (y) span. Parts must
differ — a sculpture whose every column runs the object's full height
reads as a monolithic slab in iso.>
${isVehicle
    ? `
Vehicle clause: the wheels are distinct proud masses, never notches carved
out of the body. Only the wheels touch the ground row; the body's underside
sits at least 1 cell above the ground so each wheel visibly protrudes below
the body. Round the wheels so they read as wheels in the silhouette, and
state the cab/hood/body step structure in your pose line.
`
    : ''}
Masks are SOLID silhouettes: every cell inside the object's outline is "#",
not just the border. Never draw a hollow outline.

Consistency rules — all three masks are projections of the same solid:
- Every row filled in the front mask is filled in the same row of the side mask, and vice versa (they share the object's height).
- Every column filled in the front mask is filled in the same column of the top mask, and vice versa (they share the object's width).
- Every column filled in the side mask corresponds to a filled row of the top mask (they share the object's depth).

After the declaration lines and before the masks, output one line declaring
the object's occupied extents:
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

Output the three declaration lines, then the bounds line, then exactly
three fenced code blocks labeled front, side, top. No other text.`;
}

for (const arm of ['a', 'b'] as const) {
  const runId = `tier1-regen1-16char-${arm}`;
  const runDir = join(RUNS, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });
  mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
  mkdirSync(join(runDir, 'responses'), { recursive: true });
  for (const term of Object.keys(REGEN_TERMS)) {
    const noun = term.replace(/-/g, ' ');
    writeFileSync(join(runDir, 'prompts', `${term}.md`), buildPrompt(noun, VEHICLES.has(term)));
  }
  const manifest = {
    id: runId,
    label: `tier1 regen1 challengers arm ${arm.toUpperCase()} · blindpanel-flagged terms`,
    date: '2026-08-05',
    pipeline:
      'Approved Tier-1 regen round: prompt v2 amended with pre-authoring declarations (feature / pose / depth plan), a numeric top-view row convention, and a wheels-as-proud-masses vehicle clause, over the 13 sets flagged by the tier1-blindpanel hindsight pass. Two identical arms give each term two independent challengers; a blind 2-voter free-naming panel ranks challenger vs incumbent with a structure guard, ties keep incumbent. Subscription subagents, $0 API.',
    conditions: {
      grid: String(SIZE),
      encoding: 'char',
      model: 'claude-sonnet-5',
      prompt: 'full-authorship v2 + regen1 amendments (H-DEPTH/H-CARICATURE/H-POSE/H-WHEELS)',
      source: 'none — noun only',
      method:
        'single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6) with convert-response self-check incl. median-column-depth advisory; run via subscription subagents ($0, adaptive thinking)',
    },
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${Object.keys(REGEN_TERMS).length} prompts + run.json → runs/${runId}/`);
}
