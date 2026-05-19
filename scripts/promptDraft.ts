import { sampleDuck } from '../src/voxel/sampleDuck.ts';
import { sampleTree } from '../src/voxel/sampleTree.ts';
import { sampleHouse } from '../src/voxel/sampleHouse.ts';
import { gridToLayerAscii } from '../src/voxel/projections.ts';

const duckLayers = gridToLayerAscii(sampleDuck);
const treeLayers = gridToLayerAscii(sampleTree);
const houseLayers = gridToLayerAscii(sampleHouse);

export const PROMPT_DRAFT = `You are designing a small 3D voxel object the user names. This is a FIRST DRAFT — speed and intent over precision. A revision pass will critique and improve.

WORLD
- 8×8×8 grid. Coordinates 0..7 in every axis.
- Y is up. X is left-to-right. Z is back-to-front (Z=7 closest to camera).
- The model rests on the ground (some voxel at y=0).

PALETTE (7 colors + empty)
Use color to carry meaning. Restraint reads as intentional — 3–5 colors per model.
- Y yellow — warm bodies: ducks, taxis, suns, cheese
- R red — accents: beaks, roofs, hats, fire trucks, apples
- B blue — water, denim, sky, robots
- G green — foliage, stems, frogs
- W white — sails, teeth, snow, swans
- K black — eyes, pupils, tires, dark details
- L lightGray — stone, metal, claws, light fur
- . empty

OUTPUT FORMAT
Exactly 8 layers, bottom (y=0) to top (y=7). Each layer is 8 rows of 8 single-character palette letters. Row index = z (z=0 at top of layer grid, z=7 at bottom). Column index = x (x=0 left, x=7 right). No spaces. No prose. No markdown fences. No commentary.

y=0
........
........
........
..YYYY..
..YYYY..
........
........
........

y=1
... (etc through y=7 — empty layers still 8 rows of dots)

HARD RULES
1. SINGLE connected piece. Every voxel face-adjacent to at least one other. Some voxel at y=0.
2. Use 25–60 voxels. Don't pack empty space.
3. Color carries features: eyes (K), accents (R), small distinguishing details.
4. Center the model. Leave at least 1 cell of margin per side.

THREE WORKED EXAMPLES — different archetypes

EXAMPLE 1 — duck (asymmetric animal, single black eye, red beak)

${duckLayers}

EXAMPLE 2 — tree (thin trunk, wider canopy, organic vertical form)

${treeLayers}

EXAMPLE 3 — house (small building, walls with a single black door visible from front, pyramidal roof)

${houseLayers}

Note: each example uses 22–47 voxels. None over-fills. Each uses 2–3 colors and a clear silhouette. Animals get features (eyes, beaks). Buildings get details (doors). Plants get trunks and canopies.

Now design the user's object. Output only the 8 layers, nothing else.`;
