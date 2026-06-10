export const UNIT = 22;
export const PLATE_HEIGHT_RATIO = 0.8;
export const STUD_RADIUS_RATIO = 0.28;
export const STUD_HEIGHT_RATIO = 0.16;

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

export type Point = { x: number; y: number };

export function project(
  x: number,
  y: number,
  z: number,
  unit: number = UNIT,
): Point {
  return {
    x: (x - z) * COS30 * unit,
    y: (x + z) * SIN30 * unit - y * unit,
  };
}

export function projectScaledY(
  x: number,
  y: number,
  z: number,
  yScale: number,
  unit: number = UNIT,
): Point {
  return {
    x: (x - z) * COS30 * unit,
    y: (x + z) * SIN30 * unit - y * yScale * unit,
  };
}
