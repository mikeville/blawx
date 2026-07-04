// Mask encodings for the Phase 1b sweep: the model emits three orthographic
// silhouette masks (front/side/top) per noun; these parsers turn pasted
// response text into boolean grids, tolerantly — malformed rows are repaired
// (pad/truncate) and COUNTED, because emission unreliability is exactly what
// the sweep measures. Never pre-clean a paste; let the counters see it.
//
// Mask conventions (shared with hull.ts):
//   front[r][c] — r=0 is the top of the object (y = size-1), c = x
//   side[r][c]  — r=0 top, c = z (c=0 is the object's front)
//   top[r][c]   — r=0 is the back of the object (z = size-1), c = x

export type Encoding = 'char' | 'rle';
export type View = 'front' | 'side' | 'top';
export const VIEWS: View[] = ['front', 'side', 'top'];

/** mask[row][col], size×size. */
export type Mask = boolean[][];

export type MaskParse = {
  mask: Mask;
  /** Rows that needed repair (wrong length, bad chars, bad RLE, missing). */
  malformedRows: number;
};

/**
 * Pull labeled fenced code blocks out of a pasted response. Accepts
 * ```front ... ``` (label as fence info string) or a FRONT/SIDE/TOP line
 * immediately before a plain fence.
 */
export function extractViews(response: string): Partial<Record<View, string>> {
  const out: Partial<Record<View, string>> = {};
  const labeled = /```[ \t]*(front|side|top)[^\n]*\n([\s\S]*?)```/gi;
  for (const m of response.matchAll(labeled)) {
    out[m[1].toLowerCase() as View] ??= m[2];
  }
  const preceding = /(?:^|\n)[ \t]*\**(front|side|top)\**[ \t:]*\n+```[^\n]*\n([\s\S]*?)```/gi;
  for (const m of response.matchAll(preceding)) {
    out[m[1].toLowerCase() as View] ??= m[2];
  }
  return out;
}

function emptyRow(size: number): boolean[] {
  return new Array<boolean>(size).fill(false);
}

function parseCharRow(line: string, size: number): { row: boolean[]; ok: boolean } {
  const row = emptyRow(size);
  let ok = line.length === size;
  for (let i = 0; i < Math.min(line.length, size); i++) {
    const ch = line[i];
    if (ch === '#') row[i] = true;
    else if (ch !== '.') ok = false;
  }
  return { row, ok };
}

function parseRleRow(line: string, size: number): { row: boolean[]; ok: boolean } {
  const row = emptyRow(size);
  let pos = 0;
  let consumed = 0;
  for (const m of line.matchAll(/(\d+)([#.])/g)) {
    const n = Number(m[1]);
    consumed += m[0].length;
    if (m[2] === '#') {
      for (let i = pos; i < Math.min(pos + n, size); i++) row[i] = true;
    }
    pos += n;
  }
  const ok = pos === size && consumed === line.length;
  return { row, ok };
}

export function parseMaskText(text: string, size: number, encoding: Encoding): MaskParse {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const mask: Mask = [];
  let malformedRows = 0;

  for (let r = 0; r < size; r++) {
    const line = lines[r];
    if (line === undefined) {
      mask.push(emptyRow(size));
      malformedRows += 1;
      continue;
    }
    const { row, ok } =
      encoding === 'char' ? parseCharRow(line, size) : parseRleRow(line, size);
    mask.push(row);
    if (!ok) malformedRows += 1;
  }
  // Extra rows beyond `size` are also drift.
  malformedRows += Math.max(0, lines.length - size);
  return { mask, malformedRows };
}
