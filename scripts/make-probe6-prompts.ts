// Generate the probe6 packet: conditioned-depth drawing at Sonnet over seed4
// canonical fronts. The front silhouette (FA/FLUX sourced, the project's best
// per noun) is given VERBATIM in the prompt; the model's whole job is the
// side/top views — semantic per-part depth instead of the deterministic
// flat/inflate extrusions. This is the icon3 route re-run at n=6 with the
// tooling built after icon3 retired it (retry-feedback --trust-front,
// --max-depth, top-slab advisory).
//
// Targets span body plans: fox, duck, cat (animals — seed4 inflate),
// mug, rocket ship (round-ish objects — seed4 flat(4)), table (seed4 flat(6)).
//
// Usage: npx tsx scripts/make-probe6-prompts.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOG } from './exemplars.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;
const DEPTH_CAP = 6; // the seed2 round-depth threshold, reused by gen2's hull2cap6
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
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

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
(x = width columns, y = height with 0 at the bottom, z = depth). The x and y
ranges are fixed by the given front mask; you choose z. Then make every mask
agree exactly with those extents.

Each row is exactly ${SIZE} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${SIZE} rows.

Worked example on an ${DOG.front.length}x${DOG.front.length} grid — a ${DOG.label} whose front was given the same
way. Note the per-part depth: the body is 4 cells deep (z:2-5) but each leg
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

const runId = 'probe6-16char-sonnetdepth';
const dir = join(RUNS, runId);
mkdirSync(join(dir, 'prompts'), { recursive: true });
mkdirSync(join(dir, 'responses'), { recursive: true });
mkdirSync(join(dir, 'responses-call1'), { recursive: true });
mkdirSync(join(dir, 'feedback'), { recursive: true });

let files = 0;
for (const slug of SLUGS) {
  const noun = slug.replace(/-/g, ' ');
  writeFileSync(join(dir, 'prompts', `${slug}.md`), buildDepthPrompt(noun, loadFront(slug)));
  files += 1;
}
writeFileSync(
  join(dir, 'run.json'),
  JSON.stringify(
    {
      id: runId,
      label: 'probe6 16³ · seed4 front + sonnet-drawn depth',
      date: new Date().toISOString().slice(0, 10),
      pipeline:
        'conditioned-depth probe: seed4 canonical front mask (FA/FLUX sourced) held verbatim; Sonnet designs side/top conditioned on it (per-part depth, cap 6), single-shot + deterministic retry (retry-feedback.ts --trust-front --max-depth=6), strict lift. icon3 route at n=6 with the post-icon3 validator tooling.',
      conditions: {
        grid: String(SIZE),
        encoding: 'char',
        model: 'claude-sonnet-5',
        prompt: 'depth-draw-v2 (front given verbatim, depth cap 6, dog worked example)',
        source: `${SOURCE_RUN} fronts (FA + FLUX)`,
        method: '2-call: single-shot + 1 deterministic-feedback retry',
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${files} prompts to ${runId}`);
