/*
 * Stop-motion assembly profiles — three ways a set of bricks can build
 * itself on the stage, all obeying the one rule in motion.ts that makes
 * this read as deliberate stop-motion rather than dropped-frame jank:
 *
 *   ONE shared frame clock (useStopMotion.ts owns it). Every brick snaps
 *   on the same global fps beat. Per-brick variety lives ONLY in WHEN a
 *   brick starts (order / stagger) and WHERE it travels from (its own
 *   seeded jitter) — never in the frame cadence itself. Per-brick
 *   randomness is seeded from the brick's own coordinates and computed
 *   once, so it is a held pose (the same "imperfect landing" every
 *   frame), not a shimmer. NEVER call Math.random() in here.
 *
 * This file is pure math: profile params in, a per-frame pose out. The
 * clock that drives `localFrame` forward lives in useStopMotion.ts; the
 * SVG wiring lives in Scene.tsx / AnimatedStage.tsx.
 */

import type { Brick } from '../voxel/types.ts';
import { project, PLATE_HEIGHT_RATIO } from '../render/iso.ts';

// iso.ts keeps these module-private; re-derive them here for the creep
// profile's ground-plane vector math (a scoot direction projected onto the
// floor). Same 30° iso as project().
const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

export type MotionOrder =
  | 'bottom-up'
  | 'top-down'
  | 'front-to-back'
  | 'seeded-random'
  | 'seeded-random-bottom-up';

export type BaseParams = {
  /** Frames per second of the shared clock. 6–24; STOPMOTION_FPS (12) by default. */
  fps: number;
  /** Held frames between one brick starting and the next. */
  staggerFrames: number;
  /** Which bricks start first. */
  order: MotionOrder;
  /** Cap on total assembly time — a big model staggers tighter, not longer. */
  maxTotalMs: number;
  /**
   * Depth in px of the one-frame "seat" dip when a brick's move finishes —
   * the click of a brick pressing into its socket. 0 disables it. (1px, the
   * old fixed value, is imperceptible; a few px reads as a real clack.)
   */
  settleDepth: number;
};

export type GravityParams = BaseParams & {
  kind: 'gravity';
  /** How far above the target a brick starts its fall, in px. */
  dropHeight: number;
  /** Frames spent falling from dropHeight to the impact overshoot. */
  fallFrames: number;
  /** How far past the target (downward) the brick punches in on impact, in px. */
  overshoot: number;
  /** Frames spent correcting back up from the overshoot to true rest. */
  adjustFrames: number;
  /** Lateral offset it lands at (seeded), squared up during the adjust phase. */
  landJitter: number;
  /** Accelerating (gravity-like) fall vs a linear one. */
  accel: boolean;
};

export type HandNudgeDirection = 'side' | 'behind' | 'below';

export type HandNudgeParams = BaseParams & {
  kind: 'handNudge';
  /** Starting distance from the target, in px. */
  nudgeDist: number;
  /** Which side the "hand" pushes from. */
  nudgeDir: HandNudgeDirection;
  /** Discrete shoves from start to seated (2–4). */
  nudgeCount: number;
  /** Held frames per shove. */
  framesPerNudge: number;
  /** Seeded lateral wobble on each held position, decaying to 0 at the seat. */
  posJitter: number;
  /** Seeded rotation wobble in degrees, decaying to 0 at the seat. */
  rotJitter: number;
};

export type LegoMovieParams = BaseParams & {
  kind: 'legoMovie';
  /** Height of the swoop-in arc above the target, in px. */
  arcHeight: number;
  /** Tiny held retreat before the swoop launches. */
  anticipationFrames: number;
  /** Frames the drop takes after the anticipation — fewer = faster gravity. */
  dropFrames: number;
  /** 0–1: tightens the per-brick stagger so the assembly ripple reads snappier. */
  rippleTightness: number;
  /** How far past the target the arc lands before settling, in px. */
  overshoot: number;
  /** Frames spent settling from the overshoot back to true rest. */
  snapBackFrames: number;
};

export type CreepParams = BaseParams & {
  kind: 'creep';
  /** Base distance a brick creeps in from across the floor, in px. */
  scootDist: number;
  /** Frames spent scooting along the floor to the target's column. */
  scootFrames: number;
  /** Frames spent rising from the floor up into final height. */
  liftFrames: number;
  /** 0–1: 1 drops a brick fully to the y=0 floor before it rises; lower = shallower. */
  floorDrop: number;
  /** 0–1: how much each brick's entry angle varies (1 = the full 360° compass). */
  spread: number;
  /** 0–1: per-brick variation in how far out the creep starts. */
  distJitter: number;
};

export type MotionProfile = GravityParams | HandNudgeParams | LegoMovieParams | CreepParams;

export type TransformResult = { transform?: string; opacity?: number };

// ── Tuned defaults ──────────────────────────────────────────────────────
// Grounded in design/motion.ts: FRAME_MS (~83ms @12fps), DUR.place (5
// frames), DUR.swap (8 frames), STAGGER.perBrick (1 frame),
// STAGGER.maxTotalMs (1400ms). Each profile's total per-brick travel is
// tuned to land in that same neighbourhood (~500-700ms) so all three
// read as the same *weight* of motion, just a different character.

export const DEFAULT_PROFILES: {
  gravity: GravityParams;
  handNudge: HandNudgeParams;
  legoMovie: LegoMovieParams;
  creep: CreepParams;
} = {
  gravity: {
    kind: 'gravity',
    fps: 12,
    staggerFrames: 1,
    order: 'bottom-up',
    maxTotalMs: 1400,
    settleDepth: 2,
    dropHeight: 40,
    fallFrames: 4,
    overshoot: 3,
    adjustFrames: 2,
    landJitter: 3,
    accel: true,
  },
  handNudge: {
    kind: 'handNudge',
    fps: 12,
    staggerFrames: 1,
    order: 'bottom-up',
    maxTotalMs: 1400,
    settleDepth: 2,
    nudgeDist: 18,
    nudgeDir: 'side',
    nudgeCount: 3,
    framesPerNudge: 2,
    posJitter: 2,
    rotJitter: 6,
  },
  legoMovie: {
    kind: 'legoMovie',
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
  },
  creep: {
    kind: 'creep',
    fps: 10,
    staggerFrames: 6,
    order: 'bottom-up',
    maxTotalMs: 500,
    settleDepth: 0,
    scootDist: 140,
    scootFrames: 5,
    liftFrames: 1,
    floorDrop: 1,
    spread: 1,
    distJitter: 1,
  },
};

// ── Seeding ──────────────────────────────────────────────────────────────

/**
 * Deterministic per-brick seed in [0, 1), from the brick's OWN coordinates
 * — never the array index. The same brick gets the same seed regardless
 * of how Scene re-sorts for the painter's-algorithm depth pass, so its
 * jitter is a stable, held "imperfect landing," not a shimmer that
 * changes when the sort order changes.
 */
export function seedFor(brick: Brick, salt = 0): number {
  let h =
    Math.imul(brick.x, 374761393) ^
    Math.imul(brick.y, 668265263) ^
    Math.imul(brick.z, 2147483647) ^
    Math.imul(salt, 2166136261);
  h = Math.imul(h ^ (brick.w * 97 + brick.d * 193), 2246822519);
  h = Math.imul(h ^ (h >>> 15), 2654435761);
  h = h ^ (h >>> 16);
  return ((h >>> 0) % 100000) / 100000;
}

/** Signed jitter seed in [-1, 1), derived from seedFor. */
function signedSeed(brick: Brick): number {
  return seedFor(brick) * 2 - 1;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clampFrame(localFrame: number, duration: number): number {
  if (localFrame < 0) return 0;
  return localFrame > duration ? duration : localFrame;
}


type Pose = { x: number; y: number; rotDeg: number };

// ── Per-profile pose math ────────────────────────────────────────────────
// Each `<kind>CoreFrames` is the profile's own travel length in frames
// (before the optional settle frame). Each `<kind>Pose` is a pure
// function of the already-clamped local frame — it never reads wall
// time, only frame count, so the whole system stays on one discrete beat.

function gravityCoreFrames(p: GravityParams): number {
  return p.fallFrames + p.adjustFrames;
}

function gravityPose(localFrame: number, seedSigned: number, p: GravityParams): Pose {
  const core = gravityCoreFrames(p);
  const lf = clampFrame(localFrame, core);
  const jitterX = p.landJitter * seedSigned;
  if (lf <= p.fallFrames) {
    const t = p.fallFrames > 0 ? lf / p.fallFrames : 1;
    const te = p.accel ? t * t : t; // accelerating fall reads as gravity, not a lift
    return { x: jitterX, y: lerp(-p.dropHeight, p.overshoot, te), rotDeg: 0 };
  }
  const t2 = p.adjustFrames > 0 ? (lf - p.fallFrames) / p.adjustFrames : 1;
  return { x: lerp(jitterX, 0, t2), y: lerp(p.overshoot, 0, t2), rotDeg: 0 };
}

const HAND_NUDGE_DIRS: Record<HandNudgeDirection, { x: number; y: number }> = {
  side: { x: 1, y: 0 },
  // "from behind" in the iso camera reads as an upper-back diagonal, not
  // a straight axis — there's no true depth axis in 2D screen space.
  behind: { x: -0.6, y: -0.8 },
  below: { x: 0, y: 1 },
};

function handNudgeCoreFrames(p: HandNudgeParams): number {
  return (p.nudgeCount + 1) * p.framesPerNudge;
}

function handNudgePose(localFrame: number, seedSigned: number, p: HandNudgeParams): Pose {
  const core = handNudgeCoreFrames(p);
  const lf = clampFrame(localFrame, core);
  const step = Math.min(Math.floor(lf / p.framesPerNudge), p.nudgeCount);
  const remaining = p.nudgeCount > 0 ? 1 - step / p.nudgeCount : 0; // 1 at the first shove, 0 seated
  const dir = HAND_NUDGE_DIRS[p.nudgeDir];
  const mag = p.nudgeDist * remaining;
  const wobble = p.posJitter * seedSigned * remaining;
  return {
    x: dir.x * mag + wobble,
    y: dir.y * mag + wobble * 0.5,
    rotDeg: p.rotJitter * seedSigned * remaining,
  };
}

function legoMovieCoreFrames(p: LegoMovieParams): number {
  return p.anticipationFrames + p.dropFrames + p.snapBackFrames;
}

function legoMoviePose(localFrame: number, seedSigned: number, p: LegoMovieParams): Pose {
  // The drop is now an explicit frame count (dropFrames) rather than an
  // fps-derived one — fewer frames = a faster gravity drop.
  const travel = Math.max(1, p.dropFrames);
  const core = legoMovieCoreFrames(p);
  const lf = clampFrame(localFrame, core);
  const xStart = p.arcHeight * 0.6 * seedSigned;

  if (lf < p.anticipationFrames) {
    const t = p.anticipationFrames > 0 ? lf / p.anticipationFrames : 1;
    // A tiny held retreat before the swoop launches — anticipation, not motion.
    return { x: xStart, y: -p.arcHeight - p.arcHeight * 0.15 * t, rotDeg: 0 };
  }
  // Only overshoot if there are snap-back frames to recover it — otherwise
  // the arc lands directly at true rest, so snapBackFrames:0 doesn't leave
  // the model parked on the overshoot (a permanent offset / swap seam).
  const landY = p.snapBackFrames > 0 ? p.overshoot : 0;
  const travelLf = lf - p.anticipationFrames;
  if (travelLf <= travel) {
    const t = travel > 0 ? travelLf / travel : 1;
    // Accelerating (t²) rather than smoothstep: after the anticipation
    // wind-up the brick drops like gravity — slow to start, fastest at
    // impact — so it lands hard into the overshoot instead of easing softly
    // in. The horizontal glide rides the same curve so x and y arrive
    // together.
    const eased = t * t;
    return { x: lerp(xStart, 0, eased), y: lerp(-p.arcHeight, landY, eased), rotDeg: 0 };
  }
  const snapLf = travelLf - travel;
  const t2 = p.snapBackFrames > 0 ? snapLf / p.snapBackFrames : 1;
  return { x: 0, y: lerp(landY, 0, t2), rotDeg: 0 };
}

// ── Creep-in ──────────────────────────────────────────────────────────────
// The bricks creep in from many different sides and angles, scooting along
// the floor to their column, then rise up into the finished form. Unlike
// handNudge (one shared push direction), every brick gets its own seeded
// compass angle, so the assembly reads as a swarm converging on the floor
// and building upward — not a uniform wave.

function creepCoreFrames(p: CreepParams): number {
  return p.scootFrames + p.liftFrames;
}

function creepPose(localFrame: number, brick: Brick, p: CreepParams, unit: number): Pose {
  const core = creepCoreFrames(p);
  const lf = clampFrame(localFrame, core);

  // How far this brick sits above the y=0 floor at rest, in screen px. Plate
  // ratio because the stage always renders plate style. `floorDrop` scales
  // how far down toward the true floor a brick starts before rising.
  const liftPx = brick.y * PLATE_HEIGHT_RATIO * unit * p.floorDrop;

  // Per-brick entry: a ground-plane direction at a seeded compass angle
  // (independent seed stream via salt), projected onto the iso floor — so the
  // scoot literally travels along the ground rather than through the air.
  const angle = (seedFor(brick, 1) - 0.5) * Math.PI * 2 * p.spread;
  const gx = Math.cos(angle);
  const gz = Math.sin(angle);
  const sx = (gx - gz) * COS30;
  const sy = (gx + gz) * SIN30;
  const dist = p.scootDist * (1 - p.distJitter * seedFor(brick, 2));

  if (lf <= p.scootFrames) {
    // Scoot: held at floor level, sliding from far in to the target column.
    const t = p.scootFrames > 0 ? lf / p.scootFrames : 1;
    const rem = 1 - t * t * (3 - 2 * t); // decelerate into the column
    return { x: sx * dist * rem, y: liftPx + sy * dist * rem, rotDeg: 0 };
  }
  // Lift: rise straight up from the floor into final height.
  const t2 = p.liftFrames > 0 ? (lf - p.scootFrames) / p.liftFrames : 1;
  const eased = t2 * t2 * (3 - 2 * t2);
  return { x: 0, y: lerp(liftPx, 0, eased), rotDeg: 0 };
}

/** A profile's own travel length in frames, before the optional settle frame. */
export function coreDurationFrames(profile: MotionProfile): number {
  switch (profile.kind) {
    case 'gravity':
      return gravityCoreFrames(profile);
    case 'handNudge':
      return handNudgeCoreFrames(profile);
    case 'legoMovie':
      return legoMovieCoreFrames(profile);
    case 'creep':
      return creepCoreFrames(profile);
  }
}

/** Total frames a single brick takes to finish moving, settle frame included. */
export function profileDurationFrames(profile: MotionProfile): number {
  return coreDurationFrames(profile) + (profile.settleDepth > 0 ? 1 : 0);
}

function poseFor(localFrame: number, brick: Brick, profile: MotionProfile, unit: number): Pose {
  const s = signedSeed(brick);
  switch (profile.kind) {
    case 'gravity':
      return gravityPose(localFrame, s, profile);
    case 'handNudge':
      return handNudgePose(localFrame, s, profile);
    case 'legoMovie':
      return legoMoviePose(localFrame, s, profile);
    case 'creep':
      return creepPose(localFrame, brick, profile, unit);
  }
}

function composeTransform(brick: Brick, unit: number, pose: Pose): string {
  if (pose.x === 0 && pose.y === 0 && pose.rotDeg === 0) return '';
  const parts = [`translate(${pose.x.toFixed(2)},${pose.y.toFixed(2)})`];
  if (pose.rotDeg !== 0) {
    // Rotate about the brick's own projected top-center, not the SVG
    // origin — otherwise a "wobble" would swing the whole model.
    const c = project(brick.x + brick.w / 2, brick.y + 1, brick.z + brick.d / 2, unit);
    parts.push(`rotate(${pose.rotDeg.toFixed(2)},${c.x.toFixed(2)},${c.y.toFixed(2)})`);
  }
  return parts.join(' ');
}

/**
 * The single entry point useStopMotion calls per brick per frame. Pure:
 * same (profile, brick, startFrame, currentFrame) always yields the same
 * pose — the clock outside supplies the only moving part.
 */
export function transformForBrick(
  profile: MotionProfile,
  brick: Brick,
  startFrame: number,
  currentFrame: number,
  unit: number,
): TransformResult {
  const localFrame = currentFrame - startFrame;
  if (localFrame < 0) return { opacity: 0 };

  const core = coreDurationFrames(profile);
  let pose = poseFor(localFrame, brick, profile, unit);
  // The seat is ONE held frame of a `settleDepth`px dip on the exact frame a
  // brick finishes its move — the click, not a rebound (motion.ts principle
  // 3), and not a permanent offset (which would leave a seam when the
  // finished model swaps onto the real stage). After that frame the brick
  // rests at true 0.
  if (profile.settleDepth > 0 && localFrame === core) {
    pose = { ...pose, y: pose.y + profile.settleDepth };
  }
  return { transform: composeTransform(brick, unit, pose) || undefined, opacity: 1 };
}

/** Used by the reduced-motion path: no travel, fully visible, instant. */
export function identityTransform(): TransformResult {
  return { transform: undefined, opacity: 1 };
}
