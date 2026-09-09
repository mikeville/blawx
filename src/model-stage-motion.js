// Exact pure-math port of blawx2's active DEFAULT_PROFILES.legoMovie path.
// Values remain screen pixels/held frames; hero.js converts pixels through
// the orthographic camera instead of retuning the reference in world units.
export const LEGO_MOVIE = Object.freeze({
  fps: 10,
  staggerFrames: 6,
  order: 'front-to-back',
  maxTotalMs: 500,
  settleDepth: 0,
  arcHeight: 100,
  anticipationFrames: 4,
  dropFrames: 1,
  rippleTightness: 0.6,
  overshoot: 4,
  snapBackFrames: 0,
});

const REFERENCE_UNIT = 24;
const REFERENCE_MARGIN = 16;
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

// Each document load gets one entrance, regardless of home/detail remounts.
export function createEntranceGate() {
  let available = true;
  return (reducedMotion = false) => {
    const animate = available && !reducedMotion;
    available = false;
    return animate;
  };
}

function project(x, y, z) {
  return {
    x: (x - z) * COS30 * REFERENCE_UNIT,
    y: (x + z) * SIN30 * REFERENCE_UNIT - y * REFERENCE_UNIT,
  };
}

// Shell.tsx renders Scene with unit=24, margin=16 and default brick style.
// This reproduces that SVG viewBox and preserveAspectRatio="xMidYMid meet"
// scale so the profile's nominal pixels land at the same CSS displacement.
export function referenceSvgToCssScale(bricks, hostWidth, hostHeight) {
  if (bricks.length === 0 || hostWidth <= 0 || hostHeight <= 0) return 1;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const brick of bricks) {
    for (const x of [brick.x, brick.x + brick.w]) {
      for (const y of [brick.y, brick.y + 1]) {
        for (const z of [brick.z, brick.z + brick.d]) {
          const point = project(x, y, z);
          minX = Math.min(minX, point.x);
          maxX = Math.max(maxX, point.x);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
    }
  }
  const viewBoxWidth = maxX - minX + REFERENCE_MARGIN * 2;
  const viewBoxHeight = maxY - minY + REFERENCE_MARGIN * 2;
  return Math.min(hostWidth / viewBoxWidth, hostHeight / viewBoxHeight);
}

export function legoMovieDurationFrames(profile = LEGO_MOVIE) {
  return profile.anticipationFrames + profile.dropFrames + profile.snapBackFrames
    + (profile.settleDepth > 0 ? 1 : 0);
}

export function computeLegoMovieStartFrames(bricks, profile = LEGO_MOVIE) {
  const starts = new Map();
  const ranked = bricks
    .map((brick, index) => ({ brick, key: -(brick.x + brick.z) * 1000 + index * 0.001 }))
    .sort((a, b) => a.key - b.key);
  const count = ranked.length;
  if (count === 0) return starts;

  let stagger = profile.staggerFrames * profile.rippleTightness;
  const maxStartFrame = profile.maxTotalMs / (1000 / profile.fps);
  if (count > 1 && stagger * (count - 1) > maxStartFrame) {
    stagger = maxStartFrame / (count - 1);
  }
  ranked.forEach(({ brick }, rank) => starts.set(brick, Math.round(rank * stagger)));
  return starts;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function legoMoviePose(localFrame, brick, profile = LEGO_MOVIE) {
  if (localFrame < 0) return { visible: false, x: 0, y: 0 };

  const travel = Math.max(1, profile.dropFrames);
  const core = profile.anticipationFrames + profile.dropFrames + profile.snapBackFrames;
  const frame = Math.min(localFrame, core);
  const xStart = profile.arcHeight * 0.6 * (seedFor(brick) * 2 - 1);

  if (frame < profile.anticipationFrames) {
    const t = profile.anticipationFrames > 0 ? frame / profile.anticipationFrames : 1;
    return {
      visible: true,
      x: xStart,
      y: -profile.arcHeight - profile.arcHeight * 0.15 * t,
    };
  }

  const landY = profile.snapBackFrames > 0 ? profile.overshoot : 0;
  const travelFrame = frame - profile.anticipationFrames;
  if (travelFrame <= travel) {
    const t = travel > 0 ? travelFrame / travel : 1;
    const eased = t * t;
    return {
      visible: true,
      x: lerp(xStart, 0, eased),
      y: lerp(-profile.arcHeight, landY, eased),
    };
  }

  const snapFrame = travelFrame - travel;
  const t = profile.snapBackFrames > 0 ? snapFrame / profile.snapBackFrames : 1;
  return { visible: true, x: 0, y: lerp(landY, 0, t) };
}

// Kept byte-for-byte equivalent in arithmetic to blawx2 motionProfiles.ts.
export function seedFor(brick, salt = 0) {
  let hash = Math.imul(brick.x, 374761393)
    ^ Math.imul(brick.y, 668265263)
    ^ Math.imul(brick.z, 2147483647)
    ^ Math.imul(salt, 2166136261);
  hash = Math.imul(hash ^ (brick.w * 97 + brick.d * 193), 2246822519);
  hash = Math.imul(hash ^ (hash >>> 15), 2654435761);
  hash ^= hash >>> 16;
  return ((hash >>> 0) % 100000) / 100000;
}
