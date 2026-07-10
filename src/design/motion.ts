/*
 * Blawx motion language — stop-motion, not smooth.
 *
 * The reference is LEGO stop-motion (the films): the world moves on a
 * low, discrete frame rate. Things do not glide or ease — they SNAP
 * between held poses, one frame at a time, and land hard with no
 * overshoot. That "shot on a physical set, one frame at a time" quality
 * is the whole feel. Every signature motion in the app should read that
 * way; incidental UI (focus rings, colour on hover) can stay instant.
 *
 * Principles:
 *   1. Discrete over continuous. Prefer `steps(n)` timing to cubic
 *      easing. A move from A to B jumps through a handful of held
 *      frames, it does not interpolate silk-smooth.
 *   2. Hold, then snap. Poses are held; transitions are abrupt. No
 *      spring, no bounce, no float. (The mockup's smooth 4s bob is
 *      exactly what we are rejecting.)
 *   3. Land hard. Elements arrive and stop dead. At most a single 1px
 *      settle frame — the click of a brick seating — never a rebound.
 *   4. Stagger the ensemble. When many bricks move (the intro
 *      fall-into-place, a shape swap), they animate on offset delays so
 *      the composition assembles piece by piece, like a build.
 *   5. Ambient = breathing, not bobbing. Idle motion is a rare, tiny
 *      re-pose (a stud-scale nudge every couple of seconds), not a
 *      continuous oscillation — a stop-motion set never holds perfectly
 *      still, but it never sways either.
 *
 * These are the shared constants. CSS-driven motion pulls the matching
 * `--ease-step` / durations from tokens.css; JS-orchestrated motion
 * (the fly-in) uses the numbers here.
 */

/** Perceived frame rate of the stop-motion world. */
export const STOPMOTION_FPS = 12;

/** One held frame, in ms (~83ms at 12fps). The atomic unit of motion. */
export const FRAME_MS = Math.round(1000 / STOPMOTION_FPS);

/**
 * Stepped easing for a single element's move. `steps(N, end)` makes the
 * transition jump through N held frames instead of interpolating — the
 * signature stop-motion snap. N chosen so a move reads as a few frames,
 * not a smear.
 */
export const STEP_EASE = 'steps(5, end)';

/** Durations, expressed as whole frames so everything lands on-grid. */
export const DUR = {
  /** A brick seating / a press settling — the shortest real move. */
  snap: FRAME_MS * 2, // ~166ms
  /** One element flying into place. */
  place: FRAME_MS * 5, // ~415ms
  /** A full shape swapping out and the next assembling. */
  swap: FRAME_MS * 8, // ~665ms
} as const;

/** Per-element stagger for ensemble moves (fall-into-place, swaps). */
export const STAGGER = {
  /** Base delay added per brick, in ms. Assembly reads piece-by-piece. */
  perBrick: FRAME_MS, // ~83ms
  /** Cap so large models still finish assembling promptly. */
  maxTotalMs: 1400,
} as const;

/** Ambient "breathing": a tiny re-pose on a slow, irregular beat. */
export const AMBIENT = {
  /** Nudge amplitude — one stud-scale twitch, in px. */
  amplitudePx: 2,
  /** Beat between re-poses, in ms. Long enough to read as held. */
  intervalMs: 1600,
} as const;

/**
 * Respect the user's reduced-motion preference: when set, signature
 * motion collapses to an instant cut (still stop-motion in spirit — the
 * hardest possible snap — just with zero travel).
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}
