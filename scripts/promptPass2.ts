import { sampleDuck } from '../src/voxel/sampleDuck.ts';
import { sampleTree } from '../src/voxel/sampleTree.ts';
import { sampleHouse } from '../src/voxel/sampleHouse.ts';
import {
  project,
  projectionsToPromptBlock,
  gridToLayerAscii,
} from '../src/voxel/projections.ts';

function block(grid: typeof sampleDuck): { silhouettes: string; layers: string } {
  return {
    silhouettes: projectionsToPromptBlock(project(grid)),
    layers: gridToLayerAscii(grid),
  };
}

const duck = block(sampleDuck);
const tree = block(sampleTree);
const house = block(sampleHouse);

export const PASS2_PROMPT = `You already designed the object as three orthographic silhouettes (front, side, top). Now realize it as 8 voxel layers.

THE GRID (same as before)
- 8×8×8 voxels. Integer coordinates 0..7.
- Y is up. X is left-to-right. Z is back-to-front (Z=7 closest to camera).
- Palette letters: Y yellow, R red, B blue, G green, W white, K black, L lightGray, . empty.

OUTPUT FORMAT
Exactly 8 layers, bottom (y=0) to top (y=7). Each layer is 8 rows of 8 single-character cells. Row index = z (z=0 at the top of the grid, z=7 at the bottom). Column index = x (x=0 left, x=7 right). No spaces. No prose. No markdown fences. No commentary.

CONSISTENCY WITH THE SILHOUETTES
The voxels you place must reproduce the silhouettes:
- For each (x, y), the voxel with maximum Z at that column must match the cell at (x, y) in the front view.
- For each (z, y), the voxel with maximum X at that row must match the cell at (z, y) in the side view.
- For each (x, z), the voxel with maximum Y at that footprint must match the cell at (x, z) in the top view.
- Empty cells in a view mean no voxel along that ray.

HARD RULES
1. Single connected piece. Every voxel face-adjacent to at least one other. Some voxel at y=0.
2. Don't pad voxels into empty space the silhouettes don't claim.
3. Internal (hidden) voxels can be any color from your model's palette, but prefer continuity with the visible faces.
4. If the three silhouettes don't fully constrain an interior voxel, pick the most sensible color — usually the surrounding body color.

THREE WORKED EXAMPLES

EXAMPLE 1 — DUCK

Silhouettes:

${duck.silhouettes}

Realize as:

${duck.layers}

EXAMPLE 2 — TREE

Silhouettes:

${tree.silhouettes}

Realize as:

${tree.layers}

EXAMPLE 3 — HOUSE

Silhouettes:

${house.silhouettes}

Realize as:

${house.layers}

Note: in each example, the voxel layers are MINIMAL. The duck is 2 voxels deep (z=3..4). The tree is a thin trunk plus a 3×3 canopy. The house is a 3×3 footprint with a tapering roof. Don't over-fill — every voxel placed must serve the silhouettes' claims, the connectivity rule, or the form's recognizability.

Now produce the 8 layers for the current model. Output only the layers, nothing else.`;
