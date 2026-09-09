const STUD_DIAMETER_MM = 4.9;
const STUD_HEIGHT_MM = 1.8;

export const DEFAULT_STUD_APPEARANCE = Object.freeze({
  diameter: 0.8,
  height: 0.75,
});

function boundedMultiplier(value, minimum, fallback) {
  return Number.isFinite(value) ? Math.min(1, Math.max(minimum, value)) : fallback;
}

export function normalizeStudAppearance(value) {
  return {
    diameter: boundedMultiplier(value?.diameter, 0.5, DEFAULT_STUD_APPEARANCE.diameter),
    height: boundedMultiplier(value?.height, 0.25, DEFAULT_STUD_APPEARANCE.height),
  };
}

export function createStudRenderSettings(studs, voxelMm, value) {
  const appearance = normalizeStudAppearance(value);
  const originalHeight = STUD_HEIGHT_MM / voxelMm;
  const height = originalHeight * appearance.height;
  const centerOffset = (height - originalHeight) / 2;
  return {
    appearance,
    radius: STUD_DIAMETER_MM * appearance.diameter / 2 / voxelMm,
    height,
    studs: studs.map((stud) => ({ ...stud, y: stud.y + centerOffset })),
  };
}
