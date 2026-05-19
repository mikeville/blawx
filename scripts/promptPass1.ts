import { sampleDuck } from '../src/voxel/sampleDuck.ts';
import { sampleTree } from '../src/voxel/sampleTree.ts';
import { sampleHouse } from '../src/voxel/sampleHouse.ts';
import { project, projectionsToPromptBlock } from '../src/voxel/projections.ts';

const duckSilhouettes = projectionsToPromptBlock(project(sampleDuck));
const treeSilhouettes = projectionsToPromptBlock(project(sampleTree));
const houseSilhouettes = projectionsToPromptBlock(project(sampleHouse));

export const PASS1_PROMPT = `You are designing a small 3D voxel object the user names. Your job in this turn is to PLAN the object as three architectural views (front, side, top), like an elevation + plan drawing. A second turn will realize the design as voxel layers; this turn locks in the form.

WORLD
- The model lives in an 8×8×8 grid. Integer coordinates 0..7 in every axis.
- Y is up. Y=0 is the ground; Y=7 is the ceiling.
- X is left-to-right. Z is back-to-front (Z=7 is closest to the camera; Z=0 is behind the model).
- The model rests on the ground: some voxel at y=0.

PALETTE (7 colors + empty)
Use color to carry meaning. Restraint reads as intentional — most classic LEGO sets use 3–5 colors per model.
- Y yellow — warm bodies: ducks, chicks, taxis, suns, school buses, cheese
- R red — accents and warm details: beaks, hats, roofs, fire trucks, mailboxes, apples
- B blue — water, denim, sky, jeans, robots
- G green — foliage, grass, stems, leaves, frogs, mossy stone
- W white — sails, teeth, snow, clouds, swans
- K black — eyes, pupils, tires, deep details, dark fur
- L lightGray — stone, metal, machinery, claws, light fur
- . empty (no voxel along this projection ray)

THREE VIEWS
You will produce three 8×8 grids of palette letters: \`front:\`, \`side:\`, and \`top:\`.

For each cell, write the color of the OUTERMOST voxel along that projection axis (the voxel closest to the camera). Cells with no voxel along the ray are '.'.

- **front view** — camera at +Z looking toward -Z. For each (x, y), show the color of the voxel with maximum Z.
  Grid rows = y, with y=7 at the top of the grid, y=0 at the bottom (like a drawn elevation).
  Grid columns = x, with x=0 on the left, x=7 on the right.

- **side view** — camera at +X (right side of the model) looking toward -X. For each (z, y), show the color of the voxel with maximum X.
  Grid rows = y, with y=7 at the top, y=0 at the bottom.
  Grid columns = z, with z=0 on the left (back of the model), z=7 on the right (front of the model, closest to the original camera).

- **top view** — camera looking straight down (along -Y). For each (x, z), show the color of the voxel with maximum Y.
  Grid rows = z, with z=0 at the top of the grid (back of the model), z=7 at the bottom (front).
  Grid columns = x, with x=0 on the left, x=7 on the right.

HARD RULES
1. The model is a single connected piece. Every voxel must be face-adjacent to at least one other. Some voxel touches the ground (y=0). The three views must be jointly satisfiable by some such model.
2. Use as few voxels as the form needs — 25–60 typically. Don't fill empty space.
3. Use color to carry features: eyes (K), beaks/accents (R), small distinguishing details. A single black voxel can do real work.
4. Center the model on the grid. Leave at least 1 cell of empty margin on every side so the silhouette reads.
5. The three views must be CONSISTENT with each other.
6. SILHOUETTE BEFORE FEATURES. Commit to the overall shape first, then sprinkle feature voxels in the colored grids.

OUTPUT FORMAT
Exactly three labeled grids in this order: front, side, top. Each grid is 8 rows of 8 single-character cells (palette letters). No spaces between cells. No prose. No markdown fences. No commentary.

Format:

front:
........
........
........
........
........
........
........
........

side:
... (8 rows of 8 cells)

top:
... (8 rows of 8 cells)

THREE WORKED EXAMPLES — different archetypes:

EXAMPLE 1 — prompt: "duck" (an asymmetric animal — color carries the eye and beak features)

${duckSilhouettes}

EXAMPLE 2 — prompt: "tree" (a vertical, symmetric, organic form — thin trunk supporting a wider canopy)

${treeSilhouettes}

EXAMPLE 3 — prompt: "house" (a small building — walls with a door silhouette in front, pyramidal roof)

${houseSilhouettes}

Note how the three differ:
- The duck is asymmetric and uses color (K, R) for tiny features that read as eye and beak.
- The tree's silhouette is dominated by negative space — only 22 voxels total — yet the trunk + canopy structure is unmistakable.
- The house uses a door (K voxel against a W wall) as a focal feature; the views show a small box with a roof.

Each example uses 22–47 voxels. None over-fill. Each uses 2–3 colors. The three silhouettes per example are mutually consistent — a voxel that appears in the front view also shows up in the top view at the same x, etc.

Now design the user's object. Output only the three labeled grids, nothing else.`;
