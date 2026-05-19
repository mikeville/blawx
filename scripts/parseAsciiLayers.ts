import type { Color, Voxel, VoxelGrid } from '../src/voxel/types.ts';
import { GRID_SIZE } from '../src/voxel/types.ts';

export const LETTER_TO_COLOR: Record<string, Color> = {
  Y: 'yellow',
  R: 'red',
  B: 'blue',
  G: 'green',
  W: 'white',
  K: 'black',
  L: 'lightGray',
};

const PALETTE_LETTERS = new Set(Object.keys(LETTER_TO_COLOR));
const VALID_CELL = new Set(['.', ...PALETTE_LETTERS]);

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '');
}

function normalizeRow(line: string): string {
  return line.trim().toUpperCase().replace(/\s+/g, '');
}

function isGridRow(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (!VALID_CELL.has(c)) return false;
  return true;
}

export function parseAsciiLayers(text: string): VoxelGrid {
  const lines = stripFences(text).split('\n');

  let hasHeaders = false;
  for (const line of lines) {
    if (/^\s*[yY]\s*=\s*\d+/.test(line)) {
      hasHeaders = true;
      break;
    }
  }

  const byLayer = new Map<number, string[]>();

  if (hasHeaders) {
    let currentY: number | null = null;
    for (const line of lines) {
      const headerMatch = line.trim().match(/^[yY]\s*=\s*(\d+)/);
      if (headerMatch) {
        currentY = parseInt(headerMatch[1], 10);
        if (!byLayer.has(currentY)) byLayer.set(currentY, []);
        continue;
      }
      const normalized = normalizeRow(line);
      if (currentY !== null && isGridRow(normalized)) {
        byLayer.get(currentY)!.push(normalized);
      }
    }
  } else {
    const rows: string[] = [];
    for (const line of lines) {
      const normalized = normalizeRow(line);
      if (isGridRow(normalized)) rows.push(normalized);
    }
    for (let i = 0; i < rows.length; i++) {
      const y = Math.floor(i / GRID_SIZE);
      if (!byLayer.has(y)) byLayer.set(y, []);
      byLayer.get(y)!.push(rows[i]);
    }
  }

  const voxels: Voxel[] = [];
  for (const [y, rows] of byLayer) {
    if (y < 0 || y >= GRID_SIZE) continue;
    for (let z = 0; z < rows.length && z < GRID_SIZE; z++) {
      const padded = rows[z].padEnd(GRID_SIZE, '.').slice(0, GRID_SIZE);
      for (let x = 0; x < GRID_SIZE; x++) {
        const ch = padded[x];
        if (ch !== '.' && PALETTE_LETTERS.has(ch)) {
          voxels.push({ x, y, z, color: LETTER_TO_COLOR[ch] });
        }
      }
    }
  }

  return { size: GRID_SIZE, voxels };
}
