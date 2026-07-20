// Generate the probe12 packet: the probe6 conditioned-depth route (sourced
// front held verbatim, model designs side/top) with the probe8 prompt-v2
// top-view convention fix folded in — the DOG_Z exemplar whose top view is
// z-asymmetric, plus the explicit back-to-front row anchoring. This is the
// production-candidate depth prompt ("depth-draw-v3"): probe6 proved the
// route, probe8 proved the convention fix; probe12 exists to measure its
// real API cost and latency (tokens + wall-clock recorded by the runner).
//
// Usage: npx tsx scripts/make-probe12-prompts.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG_Z } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const RUN_ID = 'probe12-16char-depthapi';
const SIZE = 16;
const DEPTH_CAP = 6;
const SOURCE_RUN = 'seed4-16char-mixed';
const SLUGS = ['fox', 'duck', 'cat', 'mug', 'rocket-ship', 'table'];

const fence = '```';

/** Front section of a runs/<id>/masks/<slug>.txt multi-view dump. */
function loadFront(slug: string): string[] {
  const lines = readFileSync(join(RUNS, SOURCE_RUN, 'masks', `${slug}.txt`), 'utf8')
    .split('\n')
    .map((l) => l.trim());
  const frontIdx = lines.findIndex((l) => /^front$/i.test(l));
  if (frontIdx === -1) throw new Error(`${slug}.txt has no front section`);
  const rows: string[] = [];
  for (let i = frontIdx + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.length === 0 || /^(front|side|top)$/i.test(l)) break;
    rows.push(l);
  }
  if (rows.length !== SIZE) throw new Error(`${slug} front has ${rows.length} rows, expected ${SIZE}`);
  return rows;
}

function buildDepthPrompt(noun: string, front: string[]): string {
  return `Design the 3D depth of a tiny voxel icon of: "${noun}"

The FRONT silhouette is already designed and is authoritative — reproduce it
EXACTLY, cell for cell, as your front mask. Your creative job is the other
two views: give this flat silhouette real 3D character.

Views on a ${SIZE}x${SIZE} grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object). GIVEN below.
- side — seen from the object's right; columns run front to back (first column = the near/front edge, closest to someone looking at the front view); rows top to bottom.
- top — seen from above; columns run left to right (the same left/right as the front view); rows run BACK to FRONT: the first row is the object's far/back edge, the last row is its near/front edge. So a part at the FRONT of the object (leftmost filled columns of the side view) lands in the LAST filled rows of the top view, and a part at the BACK (rightmost side-view columns) lands in the FIRST filled rows. Drawing the top view front-to-back instead is the most common mistake in this task — double-check the row direction before you answer.

The given front mask (copy this verbatim into your answer):

${fence}front
${front.join('\n')}
${fence}

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
not just the border. Never draw a hollow outline. (The given front mask may
contain intentional holes — reproduce them exactly; do not fill them.)

Consistency rules — all three masks are projections of the same solid:
- Every row filled in the front mask is filled in the same row of the side mask, and vice versa (they share the object's height).
- Every column filled in the front mask is filled in the same column of the top mask, and vice versa (they share the object's width).
- Every column filled in the side mask corresponds to a filled row of the top mask (they share the object's depth).

Before the masks, output one line declaring the object's occupied extents:
bounds x:<min>-<max> y:<min>-<max> z:<min>-<max>
(x = width columns, y = height with 0 at the bottom, z = depth with 0 at the
near/front edge). The x and y ranges are fixed by the given front mask; you
choose z. Then make every mask agree exactly with those extents.

Each row is exactly ${SIZE} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${SIZE} rows.

Worked example on an ${DOG_Z.front.length}x${DOG_Z.front.length} grid — a dog whose front was given the same
way. Note the per-part depth: the body is 4 cells deep (z:2-5), each leg
pair is only 1 cell deep at the near and far edges, the head hugs the
near/front half of the depth (z:2-3) and the tail the far/back half
(z:4-5). Because of that, the top view's FIRST filled rows (the back)
contain the tail column at the right edge, and its LAST filled rows (the
front) contain the head columns at the left edge — check that your own top
view runs back-to-front the same way. (At ${SIZE}x${SIZE} your top view
should also taper and round more than this tiny example has room to.)

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

for (const slug of SLUGS) {
  const noun = slug.replace(/-/g, ' ');
  writeFileSync(join(runDir, 'prompts', `${slug}.md`), buildDepthPrompt(noun, loadFront(slug)));
}

const manifest = {
  id: RUN_ID,
  label: 'probe12 16³ · sourced front + sonnet depth — API cost/latency',
  date: '2026-07-20',
  pipeline:
    'probe6 conditioned-depth route priced at the real runtime: seed4 front held verbatim (--trust-front), Sonnet designs side/top with the depth-draw-v3 prompt (probe6 wording + probe8 v2 top-view convention fix + DOG_Z exemplar), direct API (claude-sonnet-5, adaptive thinking, default effort, max_tokens 8192), single-shot + 1 feedback retry, strict lift. Per-call tokens AND wall-clock ms in usage.json — this run exists to measure per-term cost and latency for the Worker-reshape decision.',
  conditions: {
    grid: String(SIZE),
    encoding: 'char',
    model: 'claude-sonnet-5',
    prompt: 'depth-draw-v3 (probe6 conditioned-depth + v2 top-view fix + DOG_Z)',
    source: 'seed4 verbatim front (FA icon or FLUX PNG)',
    method:
      'single-shot + 1 deterministic-feedback retry (--trust-front --max-depth=6); direct API, adaptive thinking, default effort — live spend, signed off 2026-07-20',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${SLUGS.length} prompts + run.json → runs/${RUN_ID}/`);
