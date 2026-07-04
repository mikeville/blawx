// Neutral eval renderer: true-30° isometric SVG projection of a voxel grid.
// Monotone by default so form is judged on silhouette + depth articulation
// alone; a flat-color variant exists for secondary comparison only.
// Projection constants match ../blawx/src/render/iso.ts (UNIT = 22, true 30°)
// so eval renders and the LEGO skin stay geometrically aligned.

export const UNIT = 22;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

export type Vec3 = readonly [number, number, number];
export type Face = 'top' | 'left' | 'right';

export type RenderOptions = {
  mode?: 'monotone' | 'color';
  /** Hex colors parallel to `voxels`; only read in color mode. */
  colors?: readonly (string | undefined)[];
  /** Background fill; null for transparent. */
  background?: string | null;
  unit?: number;
};

export function project(
  x: number,
  y: number,
  z: number,
  unit: number = UNIT,
): [number, number] {
  return [(x - z) * COS30 * unit, (x + z) * SIN30 * unit - y * unit];
}

// Camera sits along +(1,1,1): faces with +y, +x, +z normals are visible,
// and larger x+y+z means closer to the viewer (painter's sort key).
const FACES: { face: Face; normal: Vec3; corners: Vec3[] }[] = [
  { face: 'left', normal: [0, 0, 1], corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]] },
  { face: 'right', normal: [1, 0, 0], corners: [[1, 0, 0], [1, 0, 1], [1, 1, 1], [1, 1, 0]] },
  { face: 'top', normal: [0, 1, 0], corners: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]] },
];

const MONO: Record<Face, string> = { top: '#e9e9e9', left: '#b3b3b3', right: '#7d7d7d' };
const TINT: Record<Face, number> = { top: 1, left: 0.76, right: 0.53 };

/** Scale a #rgb/#rrggbb color's channels by k (0..1). */
export function shade(hex: string, k: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const out = [0, 2, 4].map((i) => {
    const v = Math.round(parseInt(full.slice(i, i + 2), 16) * k);
    return Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
  });
  return `#${out.join('')}`;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function renderIsoSVG(
  voxels: readonly Vec3[],
  opts: RenderOptions = {},
): string {
  const { mode = 'monotone', colors, background = '#ffffff', unit = UNIT } = opts;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const occupied = new Set(voxels.map(([x, y, z]) => key(x, y, z)));

  // Painter's algorithm: draw far-to-near along the (1,1,1) view axis.
  const order = voxels
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v[0] + a.v[1] + a.v[2] - (b.v[0] + b.v[1] + b.v[2]));

  const polys: string[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const { v: [x, y, z], i } of order) {
    // Fully hidden from this camera: all three visible-face neighbors filled.
    if (
      occupied.has(key(x + 1, y, z)) &&
      occupied.has(key(x, y + 1, z)) &&
      occupied.has(key(x, y, z + 1))
    ) continue;

    const base = mode === 'color' ? colors?.[i] : undefined;
    for (const { face, normal: [nx, ny, nz], corners } of FACES) {
      if (occupied.has(key(x + nx, y + ny, z + nz))) continue;
      const pts = corners
        .map(([cx, cy, cz]) => {
          const [px, py] = project(x + cx, y + cy, z + cz, unit);
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
          return `${r2(px)},${r2(py)}`;
        })
        .join(' ');
      const fill = base ? shade(base, TINT[face]) : MONO[face];
      // stroke = fill seals hairline antialiasing seams between faces
      polys.push(
        `<polygon points="${pts}" fill="${fill}" stroke="${fill}" stroke-width="0.5" stroke-linejoin="round"/>`,
      );
    }
  }

  if (polys.length === 0) { minX = 0; minY = 0; maxX = unit; maxY = unit; }
  const pad = unit * 0.75;
  const vx = r2(minX - pad);
  const vy = r2(minY - pad);
  const vw = r2(maxX - minX + pad * 2);
  const vh = r2(maxY - minY + pad * 2);
  const bg = background
    ? `<rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${background}"/>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" ` +
    `width="${vw}" height="${vh}">${bg}${polys.join('')}</svg>`
  );
}
