import type { Color } from '../src/voxel/types.ts';
import { GRID_SIZE } from '../src/voxel/types.ts';
import { LETTER_TO_COLOR } from './parseAsciiLayers.ts';

export type Cell = Color | null;
export type View = Cell[][]; // [row][col], indexed differently per view (see below)

export type Silhouettes = {
  front: View; // [y][x], row 0 = top (y=7)
  side: View;  // [y][z], row 0 = top (y=7)
  top: View;   // [z][x], row 0 = z=0
};

const PALETTE = new Set(Object.keys(LETTER_TO_COLOR));
const VALID_CELL = new Set(['.', ...PALETTE]);

function isGridRow(s: string): boolean {
  if (s.length === 0) return false;
  for (const c of s) if (!VALID_CELL.has(c)) return false;
  return true;
}

function normalizeRow(line: string): string {
  return line.trim().toUpperCase().replace(/\s+/g, '');
}

function stripFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*\n?/g, '').replace(/```/g, '');
}

function parseGrid(rows: string[]): View {
  const grid: Cell[][] = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    const row = rows[i] ?? '';
    const padded = row.padEnd(GRID_SIZE, '.').slice(0, GRID_SIZE);
    const cells: Cell[] = [];
    for (let j = 0; j < GRID_SIZE; j++) {
      const ch = padded[j];
      cells.push(ch === '.' ? null : (LETTER_TO_COLOR[ch] ?? null));
    }
    grid.push(cells);
  }
  return grid;
}

function emptyGrid(): View {
  return Array.from({ length: GRID_SIZE }, () => Array<Cell>(GRID_SIZE).fill(null));
}

export function parseSilhouettes(text: string): Silhouettes {
  const lines = stripFences(text).split('\n');

  type Section = 'front' | 'side' | 'top';
  const sections: Record<Section, string[]> = { front: [], side: [], top: [] };
  let current: Section | null = null;

  for (const raw of lines) {
    const trimmed = raw.trim();
    const headerMatch = trimmed.toLowerCase().match(/^(front|side|top)\s*:?\s*$/);
    if (headerMatch) {
      current = headerMatch[1] as Section;
      continue;
    }
    const normalized = normalizeRow(raw);
    if (current && isGridRow(normalized) && sections[current].length < GRID_SIZE) {
      sections[current].push(normalized);
    }
  }

  return {
    front: sections.front.length > 0 ? parseGrid(sections.front) : emptyGrid(),
    side: sections.side.length > 0 ? parseGrid(sections.side) : emptyGrid(),
    top: sections.top.length > 0 ? parseGrid(sections.top) : emptyGrid(),
  };
}

export function viewToAscii(view: View): string {
  const reverse: Record<Color, string> = {
    yellow: 'Y',
    red: 'R',
    blue: 'B',
    green: 'G',
    white: 'W',
    black: 'K',
    lightGray: 'L',
  };
  return view
    .map(row => row.map(c => (c ? reverse[c] : '.')).join(''))
    .join('\n');
}
