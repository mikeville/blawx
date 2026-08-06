// The authored-front prompt: prompt v2 as amended by the approved regen round
// (2026-08-05, runs/tier1-regen1-panel/RESULTS.md). Extracted verbatim from
// scripts/make-tier1-regen-prompts.ts so seed batches past Tier 1 share one
// source of truth — the amended brief is the default for FPS-tail batches.
//
// Amendments over the original tier1 prompt, each mapping to a hypothesis in
// runs/tier1-blindpanel/RESULTS.md:
//   - H-CARICATURE / H-POSE / H-DEPTH: three pre-authoring declaration lines
//     (feature / pose / depth plan) required above the bounds line.
//   - H-WHEELS: a vehicle clause (wheels as proud masses) for wheeled terms.
//   - The top-view row convention stated numerically (the b4/b5 brief
//     addition that eliminated the mis-anchoring class).

import { DOG_Z } from '../exemplars.ts';

const fence = '```';

export function buildAuthoringPrompt(
  noun: string,
  { size, depthCap, isVehicle }: { size: number; depthCap: number; isVehicle: boolean },
): string {
  return `Design a tiny voxel icon of: "${noun}"

You are designing ALL THREE views of one solid voxel sculpture. The FRONT
view matters most: it must be the canonical, instantly recognizable
silhouette of a ${noun} — the shape someone would draw as a flat icon.
Choose the most recognizable orientation (a side profile for most animals
and vehicles; straight-on for symmetric objects) and draw that as the front.

Views on a ${size}x${size} grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back (first column = the near/front edge, closest to someone looking at the front view); rows top to bottom.
- top — seen from above; columns run left to right (the same left/right as the front view); rows run BACK to FRONT: the first row is the object's far/back edge, the last row is its near/front edge. So a part at the FRONT of the object (leftmost filled columns of the side view) lands in the LAST filled rows of the top view, and a part at the BACK (rightmost side-view columns) lands in the FIRST filled rows. Numerically: top-view row r holds depth cell z = ${size - 1} - r, so bounds of z:0-${depthCap - 1} fill only top rows ${size - depthCap}-${size - 1} (the last ${depthCap} rows) and leave rows 0-${size - depthCap - 1} empty. Drawing the top view front-to-back instead is the most common mistake in this task — double-check the row direction before you answer.

Front mask rules:

- BIG: the object spans (nearly) the full ${size} cells in its longer
  dimension.
- GROUNDED: the object's lowest cells sit on the bottom row.
- ONE PIECE: every "#" cell connects to the rest edge-to-edge — this becomes
  a LEGO build and must hold together as a single object.
- Real proportions, with the identifying features exaggerated enough to
  survive ${size}x${size} (a duck's bill, a table's legs, a castle's
  battlements).

Design the side and top views so the object reads as a 3D-native isometric
sprite, not a flat cutout:

- Do NOT extrude the front at one constant thickness — vary the depth per
  part. A head is thinner than a body; legs are thin and can sit at
  different depths front-to-back; a handle or fin is thinner than the mass
  it attaches to.
- Keep the whole object at most ${depthCap} cells deep front-to-back.
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

Each row is exactly ${size} characters: "#" = filled, "." = empty. Count them.
Each mask has exactly ${size} rows.

Worked example on an ${DOG_Z.front.length}x${DOG_Z.front.length} grid — a dog authored the same way.
Note the per-part depth: the body is 4 cells deep (z:2-5), each leg pair is
only 1 cell deep at the near and far edges, the head hugs the near/front
half of the depth (z:2-3) and the tail the far/back half (z:4-5). Because of
that, the top view's FIRST filled rows (the back) contain the tail column at
the right edge, and its LAST filled rows (the front) contain the head
columns at the left edge — check that your own top view runs back-to-front
the same way. (At ${size}x${size} your top view should also taper and round
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
