export const HERO_ROTATION_DEFAULTS = Object.freeze({
  pulse: 2,
  pulseFrequency: .5,
  size: 1,
  dragSpeed: 1.75,
  poseStep: 0,
});

const LIMITS = Object.freeze({
  pulse: [0, 2],
  pulseFrequency: [.25, 4],
  size: [.65, 1.5],
  dragSpeed: [.25, 2],
  poseStep: [0, 15],
});

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
export function normalizeHeroRotation(value = {}) {
  return Object.fromEntries(Object.entries(HERO_ROTATION_DEFAULTS).map(([key, fallback]) => {
    const [minimum, maximum] = LIMITS[key];
    return [key, Math.max(minimum, Math.min(maximum, finite(value[key], fallback)))];
  }));
}

export function quantizeHeroAzimuth(azimuth, poseStep, baseline = Math.PI * .75) {
  const radians = Math.max(0, finite(poseStep, 0)) * Math.PI / 180;
  return radians ? baseline + Math.round((azimuth - baseline) / radians) * radians : azimuth;
}

export function heroCameraRadius({ halfX, halfY, halfZ, aspect, elevation, azimuth, pulse = 1, pulseFrequency = 1, size = 1, padding = 1.18 }) {
  const hx = Math.max(0, finite(halfX, 0));
  const hy = Math.max(0, finite(halfY, 0));
  const hz = Math.max(0, finite(halfZ, 0));
  const safeAspect = Math.max(1e-6, finite(aspect, 1));
  const radial = Math.hypot(hx, hz);
  const fixedVertical = Math.abs(Math.sin(elevation)) * radial + Math.abs(Math.cos(elevation)) * hy;
  const fixed = Math.max(fixedVertical, radial / safeAspect, 1) * padding;
  const safeFrequency = Math.max(.25, Math.min(4, finite(pulseFrequency, 1)));
  const anchor = Math.PI * .75;
  const fitAzimuth = anchor + (azimuth - anchor) * safeFrequency;
  const horizontalProjected = Math.abs(Math.cos(fitAzimuth)) * hx + Math.abs(Math.sin(fitAzimuth)) * hz;
  const verticalProjected = Math.abs(Math.sin(elevation)) * (Math.abs(Math.sin(fitAzimuth)) * hx + Math.abs(Math.cos(fitAzimuth)) * hz)
    + Math.abs(Math.cos(elevation)) * hy;
  const existing = Math.max(verticalProjected, horizontalProjected / safeAspect, 1) * padding;
  const actualHorizontalProjected = Math.abs(Math.cos(azimuth)) * hx + Math.abs(Math.sin(azimuth)) * hz;
  const actualVerticalProjected = Math.abs(Math.sin(elevation)) * (Math.abs(Math.sin(azimuth)) * hx + Math.abs(Math.cos(azimuth)) * hz)
    + Math.abs(Math.cos(elevation)) * hy;
  const actualFit = Math.max(actualVerticalProjected, actualHorizontalProjected / safeAspect, 1) * padding;
  const safePulse = Math.max(0, Math.min(2, finite(pulse, 1)));
  const safeSize = Math.max(.65, Math.min(1.5, finite(size, 1)));
  const pulseRadius = fixed * Math.pow(existing / fixed, safePulse);
  return Math.max(pulseRadius, actualFit) / safeSize;
}
