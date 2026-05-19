import type { Color } from '../voxel/types.ts';

export const COLORS: Record<Color, string> = {
  red: '#C8102E',
  yellow: '#F4C300',
  blue: '#0A3D91',
  green: '#2E7D32',
  white: '#F7F7F2',
  black: '#1A1A1A',
  lightGray: '#A4ACAE',
};

export const PAGE_BG = '#FFFFFF';
export const OUTLINE = '#000000';

const LIGHT_COLORS: ReadonlySet<Color> = new Set(['white', 'lightGray']);
const SIDE_FACE_DARKEN = 0.94;
const DESAT_S_MULTIPLIER = 0.5;

type RGB = { r: number; g: number; b: number };
type HSL = { h: number; s: number; l: number };

function hexToRgb(hex: string): RGB {
  const v = hex.replace('#', '');
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}

function rgbToHsl({ r, g, b }: RGB): HSL {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = (g - b) / d + (g < b ? 6 : 0);
      break;
    case g:
      h = (b - r) / d + 2;
      break;
    default:
      h = (r - g) / d + 4;
  }
  return { h: h / 6, s, l };
}

function hslToRgb({ h, s, l }: HSL): RGB {
  if (s === 0) return { r: l, g: l, b: l };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hueToRgb = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: hueToRgb(h + 1 / 3),
    g: hueToRgb(h),
    b: hueToRgb(h - 1 / 3),
  };
}

function rgbToHex({ r, g, b }: RGB): string {
  const toHex = (c: number) =>
    Math.round(Math.max(0, Math.min(1, c)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function fillFor(
  color: Color,
  face: 'top' | 'left' | 'right',
  desaturated: boolean,
): string {
  const hsl = rgbToHsl(hexToRgb(COLORS[color]));
  if (desaturated) hsl.s *= DESAT_S_MULTIPLIER;
  if (face !== 'top' && LIGHT_COLORS.has(color)) hsl.l *= SIDE_FACE_DARKEN;
  return rgbToHex(hslToRgb(hsl));
}
