import { useEffect, useMemo, useRef, useState } from 'react';
import type { Brick } from '../voxel/types.ts';
import { prefersReducedMotion } from '../design/motion.ts';
import {
  type MotionProfile,
  type MotionOrder,
  type TransformResult,
  seedFor,
  transformForBrick,
  profileDurationFrames,
  identityTransform,
} from '../design/motionProfiles.ts';

export type TransformFor = (brick: Brick, index: number) => TransformResult | undefined;

/**
 * The one shared clock. A single rAF loop quantized to `profile.fps`
 * drives every brick's `localFrame` — per-brick variety comes only from
 * WHEN a brick's clock starts (computed once below from `order` +
 * `staggerFrames`), never from a different cadence per brick. See
 * design/motionProfiles.ts for the pose math this hands off to.
 */
export function useStopMotion(
  bricks: Brick[],
  profile: MotionProfile,
  trigger: number,
  unit: number,
): { transformFor: TransformFor; done: boolean } {
  const reduced = useMemo(prefersReducedMotion, []);
  const [frame, setFrame] = useState(0);
  const [done, setDone] = useState(reduced);
  const rafRef = useRef<number | null>(null);

  // Keyed by brick identity, not array/render index — Scene independently
  // re-sorts bricks for its painter's-algorithm depth pass, so the index
  // it hands back to transformFor is not the "build order" index. Object
  // identity is stable across that re-sort as long as the caller doesn't
  // recreate brick objects between renders (it doesn't — bricks come from
  // state, not a per-render map).
  const startFrames = useMemo(() => computeStartFrames(bricks, profile), [bricks, profile]);
  const totalFrames = useMemo(() => {
    if (startFrames.size === 0) return 0;
    let maxStart = 0;
    for (const s of startFrames.values()) if (s > maxStart) maxStart = s;
    return maxStart + profileDurationFrames(profile);
  }, [startFrames, profile]);

  useEffect(() => {
    if (reduced) {
      setDone(true);
      return;
    }
    setFrame(0);
    setDone(totalFrames === 0);
    if (totalFrames === 0) return;

    const frameMs = 1000 / profile.fps;
    const t0 = performance.now();

    const tick = (now: number) => {
      const f = Math.floor((now - t0) / frameMs);
      // Bail-out update: React skips the re-render when the updater
      // returns the same value, so this only actually paints once per
      // quantized frame, not once per rAF (~60-120Hz).
      setFrame((prev) => (f !== prev ? f : prev));
      if (f >= totalFrames) {
        setDone(true);
        rafRef.current = null;
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
    // Only `trigger` restarts the clock — a slider tweak or sample swap
    // updates state but waits for an explicit replay, so dragging a
    // slider doesn't reset an in-flight assembly on every pixel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const transformFor: TransformFor = (brick, _index) => {
    if (reduced) return identityTransform();
    const startFrame = startFrames.get(brick) ?? 0;
    return transformForBrick(profile, brick, startFrame, frame, unit);
  };

  return { transformFor, done };
}

/**
 * When a brick starts, in frames, keyed by brick identity. `order` picks
 * the ranking; `staggerFrames` (tightened by legoMovie's rippleTightness)
 * spaces the ranks; `maxTotalMs` caps the spread so a big model staggers
 * tighter instead of taking longer to finish assembling.
 */
function computeStartFrames(bricks: Brick[], profile: MotionProfile): Map<Brick, number> {
  const map = new Map<Brick, number>();
  const n = bricks.length;
  if (n === 0) return map;

  let maxY = 0;
  for (const brick of bricks) if (brick.y > maxY) maxY = brick.y;

  const ranked = bricks
    .map((brick, index) => ({ brick, key: orderKey(brick, index, profile.order, maxY) }))
    .sort((a, b) => a.key - b.key);

  const rippleScale = profile.kind === 'legoMovie' ? profile.rippleTightness : 1;
  let stagger = profile.staggerFrames * rippleScale;

  const frameMs = 1000 / profile.fps;
  const maxStartFrame = profile.maxTotalMs / frameMs;
  if (n > 1 && stagger * (n - 1) > maxStartFrame) {
    stagger = maxStartFrame / (n - 1);
  }

  ranked.forEach(({ brick }, rank) => {
    map.set(brick, Math.round(rank * stagger));
  });
  return map;
}

// How strongly 'seeded-random-bottom-up' pulls the shuffle toward the floor.
// 0 would be pure seeded-random; 1 would be pure bottom-up. Low value keeps
// the read mostly random with just a gentle bottoms-up lean.
const RANDOM_BOTTOM_UP_BIAS = 0.35;

// Index only ever breaks ties between bricks sharing the same rank key
// (e.g. a whole course at the same y) — a stable, deterministic ordering,
// not a source of per-brick randomness.
function orderKey(brick: Brick, index: number, order: MotionOrder, maxY: number): number {
  const tie = index * 0.001;
  switch (order) {
    case 'bottom-up':
      return brick.y * 1000 + tie;
    case 'top-down':
      return -brick.y * 1000 + tie;
    case 'front-to-back':
      // Larger (x+z) projects lower/nearer in this iso camera — start
      // there and ripple back toward the far corner.
      return -(brick.x + brick.z) * 1000 + tie;
    case 'seeded-random':
      return seedFor(brick);
    case 'seeded-random-bottom-up': {
      // Blend a fresh random stream (salted, so it doesn't just replay the
      // per-brick jitter seed) with the normalized bottom-up rank — mostly
      // shuffled, with a slight lean toward finishing bricks near the floor
      // first.
      const normalizedY = maxY > 0 ? brick.y / maxY : 0;
      return seedFor(brick, 7) * (1 - RANDOM_BOTTOM_UP_BIAS) + normalizedY * RANDOM_BOTTOM_UP_BIAS;
    }
  }
}
