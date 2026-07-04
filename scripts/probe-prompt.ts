// Hardened probe prompt builder: solid-fill rule, declared bounds line,
// explicit per-axis consistency rules, and a worked example generated from
// an Exemplar (see exemplars.ts). Shared by make-probe-prompts.ts and
// make-probe2-prompts.ts so the prompt text stays in sync across probes.

import type { Exemplar } from './exemplars.ts';

const fence = '```';

export function buildPrompt(noun: string, size: number, exemplar: Exemplar): string {
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

Each row is exactly ${size} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${size} rows.

Worked example on an ${exemplar.front.length}x${exemplar.front.length} grid — a ${exemplar.label}: solid, grounded, side profile
(body along x, so the front mask shows the profile):

${exemplar.bounds}

${fence}front
${exemplar.front.join('\n')}
${fence}

${fence}side
${exemplar.side.join('\n')}
${fence}

${fence}top
${exemplar.top.join('\n')}
${fence}

Output the bounds line, then exactly three fenced code blocks labeled
front, side, top. No other text.`;
}
