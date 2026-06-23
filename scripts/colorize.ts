// Colorize pass: send a voxel grid (currently single-color, typically white from
// the text-to-3D pipeline) plus the prompt term to Claude, ask it to assign one
// of the 7 palette colors per filled cell. Shape is locked: empty stays empty,
// filled stays filled — we only repaint.

import Anthropic from '@anthropic-ai/sdk';
import { parseAsciiLayers, LETTER_TO_COLOR } from './parseAsciiLayers.ts';
import { gridToLayerAscii } from '../src/voxel/projections.ts';
import type { Color, VoxelGrid } from '../src/voxel/types.ts';

const MODEL = 'claude-opus-4-7';

type AnyClient = InstanceType<typeof Anthropic>;

const SYSTEM = `You are a colorist for an 8×8×8 voxel model rendered as a period-correct LEGO instruction booklet. The 3D shape is FIXED. Your job is only to assign one palette color per filled cell.

PALETTE (use 3–5 colors per model, with intent)
- Y yellow   — warm bodies: ducks, taxis, suns, cheese
- R red      — accents: beaks, roofs, hats, lips, apples
- B blue     — water, denim, sky, robots
- G green    — foliage, stems, frogs, grass
- W white    — sails, teeth, snow, swans, clouds
- K black    — eyes, pupils, tires, dark details
- L lightGray — stone, metal, machinery, claws, light fur
- . empty (must remain empty — do not move geometry)

OUTPUT FORMAT
Exactly 8 layers, bottom (y=0) to top (y=7), labelled "y=0" through "y=7". Each layer is 8 rows of 8 single-character palette letters. Same shape as the input — every '.' must stay '.', every filled cell must be one of Y R B G W K L. No prose, no markdown fences, no commentary.

RULES
1. NEVER change the silhouette. If the input has a filled cell at (x,y,z), the output must have a filled cell at (x,y,z). If the input is empty at (x,y,z), the output must be '.' at (x,y,z).
2. Eyes belong on the front (high z), at face height. One or two K voxels — never a stripe.
3. Reserve K for tiny details (eyes, pupils, wheels). A black model reads as a silhouette, not a thing.
4. Saturation is intentional: dominant body color + 1–2 accents + (optional) tiny K details.
5. Match the term's natural palette: a frog is green, a duck is yellow, a robot is blue/gray, a lighthouse is red-and-white, a tree is brown-trunk-green-canopy (we have no brown — use L or K for the trunk).
6. Symmetry: left/right halves usually share colors. Mirror across the X axis unless the term is asymmetric (a duck has its beak on one side, fine).`;

function buildUserMessage(term: string, gridAscii: string): string {
  return `Term: ${term}\n\nCurrent shape (all cells currently the same color — repaint each filled cell with a palette letter; keep empty cells as '.'):\n\n${gridAscii}\n\nOutput the same 8 layers, repainted.`;
}

function textOf(response: Awaited<ReturnType<AnyClient['messages']['create']>>): string {
  const block = response.content.find(b => b.type === 'text');
  if (!block || block.type !== 'text') {
    throw new Error(`No text block in colorize response: ${JSON.stringify(response.content)}`);
  }
  return block.text;
}

/**
 * Project the colorized grid back onto the original geometry.
 * - Filled cells in the original keep their position; color comes from the
 *   colorized grid if present, else falls back to lightGray (safer than white).
 * - Cells the LLM added that weren't in the original are dropped.
 */
function applyColors(original: VoxelGrid, colorized: VoxelGrid, fallback: Color): VoxelGrid {
  const colorAt = new Map<string, Color>();
  for (const v of colorized.voxels) {
    colorAt.set(`${v.x},${v.y},${v.z}`, v.color);
  }
  return {
    size: original.size,
    voxels: original.voxels.map(v => ({
      x: v.x,
      y: v.y,
      z: v.z,
      color: colorAt.get(`${v.x},${v.y},${v.z}`) ?? fallback,
    })),
  };
}

export type ColorizeResult = {
  grid: VoxelGrid;
  raw: string;
  recoloredCount: number;
  fallbackCount: number;
};

export async function colorize(
  client: AnyClient,
  term: string,
  grid: VoxelGrid,
): Promise<ColorizeResult> {
  const ascii = gridToLayerAscii(grid);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: buildUserMessage(term, ascii) }],
  });
  const raw = textOf(response);

  const colorized = parseAsciiLayers(raw);
  const fallback: Color = 'lightGray';
  const merged = applyColors(grid, colorized, fallback);

  const lookup = new Map<string, Color>();
  for (const v of colorized.voxels) lookup.set(`${v.x},${v.y},${v.z}`, v.color);
  let recoloredCount = 0;
  let fallbackCount = 0;
  for (const v of grid.voxels) {
    if (lookup.has(`${v.x},${v.y},${v.z}`)) recoloredCount++;
    else fallbackCount++;
  }

  // Sanity log of palette usage so we can spot prompt drift fast.
  const usage = new Map<Color, number>();
  for (const v of merged.voxels) usage.set(v.color, (usage.get(v.color) ?? 0) + 1);
  const usageStr = Array.from(usage.entries())
    .map(([c, n]) => `${c}:${n}`)
    .join(' ');
  console.log(`  colorize: recolored=${recoloredCount} fallback=${fallbackCount} — ${usageStr}`);

  // Surface unknown letters from the LLM output — helps debug prompt drift.
  const validLetters = new Set([...Object.keys(LETTER_TO_COLOR), '.']);
  const stripped = raw.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '');
  const seen = new Set<string>();
  for (const ch of stripped) if (/[A-Z]/.test(ch) && !validLetters.has(ch)) seen.add(ch);
  if (seen.size > 0) {
    console.warn(`  ⚠ colorize: unknown letters in response: ${[...seen].join(',')}`);
  }

  return { grid: merged, raw, recoloredCount, fallbackCount };
}
