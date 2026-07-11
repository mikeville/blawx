import { useEffect, useMemo, useState } from 'react';
import { AnimatedStage } from '../render/AnimatedStage.tsx';
import { loadBricksForNoun, buildHeroPool } from '../surface/heroSets.ts';
import {
  DEFAULT_PROFILES,
  type MotionProfile,
  type MotionOrder,
  type GravityParams,
  type HandNudgeParams,
  type LegoMovieParams,
  type CreepParams,
  type HandNudgeDirection,
} from '../design/motionProfiles.ts';
import type { Brick } from '../voxel/types.ts';
import './motionDev.css';

// Same cached-set glob App.tsx uses for the landing library index, kept
// local here so this dev screen stays fully self-contained and never
// touches the Worker — it just needs a few real brick sets to animate.
const seed4Paths = import.meta.glob('../../runs/seed4-16char-mixed/*.json');
const EXCLUDE = new Set(['misses', 'run']);

function cachedNouns(): string[] {
  return Object.keys(seed4Paths)
    .map((p) => p.match(/\/([^/]+)\.json$/)?.[1])
    .filter((n): n is string => !!n && !EXCLUDE.has(n))
    .sort();
}

const ORDER_OPTIONS: MotionOrder[] = [
  'bottom-up',
  'top-down',
  'front-to-back',
  'seeded-random',
  'seeded-random-bottom-up',
];
const NUDGE_DIR_OPTIONS: HandNudgeDirection[] = ['side', 'behind', 'below'];

const PROFILE_LABELS: Record<MotionProfile['kind'], string> = {
  gravity: 'Gravity',
  handNudge: 'Hand-nudge',
  legoMovie: 'LEGO-movie',
  creep: 'Creep-in',
};

function RangeRow({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="motion-dev__row">
      <span className="motion-dev__row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="motion-dev__row-value">
        {value}
        {suffix ?? ''}
      </span>
    </label>
  );
}

function CheckboxRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="motion-dev__row motion-dev__row--check">
      <span className="motion-dev__row-label">{label}</span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

function SelectRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
}) {
  return (
    <label className="motion-dev__row">
      <span className="motion-dev__row-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

// Isolated playground for comparing the three assembly profiles side by
// side against a real cached set — reads bricks locally via heroSets.ts,
// never the Worker. Gated behind ?dev in App.tsx; not part of the shipped
// flow.
export function MotionDevPanel() {
  const nouns = useMemo(cachedNouns, []);
  const pool = useMemo(() => buildHeroPool(nouns), [nouns]);

  const [kind, setKind] = useState<MotionProfile['kind']>('legoMovie');
  const [gravity, setGravity] = useState<GravityParams>(DEFAULT_PROFILES.gravity);
  const [handNudge, setHandNudge] = useState<HandNudgeParams>(DEFAULT_PROFILES.handNudge);
  const [legoMovie, setLegoMovie] = useState<LegoMovieParams>(DEFAULT_PROFILES.legoMovie);
  const [creep, setCreep] = useState<CreepParams>(DEFAULT_PROFILES.creep);

  const [sample, setSample] = useState<string>(() => (pool.includes('cat') ? 'cat' : (pool[0] ?? '')));
  const [bricks, setBricks] = useState<Brick[]>([]);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!sample) return;
    loadBricksForNoun(sample).then((b) => {
      if (!alive) return;
      setBricks(b);
      setTrigger((t) => t + 1); // replay once the new sample's bricks are in
    });
    return () => {
      alive = false;
    };
  }, [sample]);

  const activeProfile: MotionProfile =
    kind === 'gravity'
      ? gravity
      : kind === 'handNudge'
        ? handNudge
        : kind === 'legoMovie'
          ? legoMovie
          : creep;

  function replay() {
    setTrigger((t) => t + 1);
  }

  function changeKind(next: MotionProfile['kind']) {
    setKind(next);
    setTrigger((t) => t + 1);
  }

  async function copyProfile() {
    const json = JSON.stringify(activeProfile, null, 2);
    try {
      await navigator.clipboard.writeText(json);
    } catch {
      console.log(json);
    }
  }

  return (
    <div className="motion-dev">
      <header className="motion-dev__head">
        <span className="motion-dev__mark">blawx / motion dev</span>
        <span className="motion-dev__hint">?dev — not part of the shipped app</span>
      </header>

      <div className="motion-dev__body">
        <div className="motion-dev__stage">
          <AnimatedStage bricks={bricks} profile={activeProfile} trigger={trigger} unit={24} margin={24} />
        </div>

        <div className="motion-dev__controls">
          <section className="motion-dev__section">
            <h2 className="motion-dev__section-title">Profile</h2>
            <div className="motion-dev__radio-group" role="radiogroup" aria-label="Motion profile">
              {(Object.keys(PROFILE_LABELS) as MotionProfile['kind'][]).map((k) => (
                <label key={k} className="motion-dev__radio">
                  <input
                    type="radio"
                    name="motion-kind"
                    checked={kind === k}
                    onChange={() => changeKind(k)}
                  />
                  {PROFILE_LABELS[k]}
                </label>
              ))}
            </div>
          </section>

          <section className="motion-dev__section">
            <h2 className="motion-dev__section-title">Sample</h2>
            <label className="motion-dev__row">
              <span className="motion-dev__row-label">set</span>
              <select value={sample} onChange={(e) => setSample(e.target.value)}>
                {pool.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <div className="motion-dev__actions">
              <button type="button" className="motion-dev__button" onClick={replay}>
                Replay
              </button>
              <button type="button" className="motion-dev__button" onClick={copyProfile}>
                Copy profile
              </button>
            </div>
          </section>

          <section className="motion-dev__section">
            <h2 className="motion-dev__section-title">Shared clock</h2>
            {kind === 'gravity' && (
              <>
                <RangeRow label="fps" value={gravity.fps} min={6} max={24} step={1} onChange={(v) => setGravity((p) => ({ ...p, fps: v }))} />
                <RangeRow label="stagger" value={gravity.staggerFrames} min={0} max={6} step={1} suffix="f" onChange={(v) => setGravity((p) => ({ ...p, staggerFrames: v }))} />
                <SelectRow label="order" value={gravity.order} options={ORDER_OPTIONS} onChange={(v) => setGravity((p) => ({ ...p, order: v }))} />
                <RangeRow label="max total" value={gravity.maxTotalMs} min={200} max={3000} step={50} suffix="ms" onChange={(v) => setGravity((p) => ({ ...p, maxTotalMs: v }))} />
                <RangeRow label="settle" value={gravity.settleDepth} min={0} max={8} step={1} suffix="px" onChange={(v) => setGravity((p) => ({ ...p, settleDepth: v }))} />
              </>
            )}
            {kind === 'handNudge' && (
              <>
                <RangeRow label="fps" value={handNudge.fps} min={6} max={24} step={1} onChange={(v) => setHandNudge((p) => ({ ...p, fps: v }))} />
                <RangeRow label="stagger" value={handNudge.staggerFrames} min={0} max={6} step={1} suffix="f" onChange={(v) => setHandNudge((p) => ({ ...p, staggerFrames: v }))} />
                <SelectRow label="order" value={handNudge.order} options={ORDER_OPTIONS} onChange={(v) => setHandNudge((p) => ({ ...p, order: v }))} />
                <RangeRow label="max total" value={handNudge.maxTotalMs} min={200} max={3000} step={50} suffix="ms" onChange={(v) => setHandNudge((p) => ({ ...p, maxTotalMs: v }))} />
                <RangeRow label="settle" value={handNudge.settleDepth} min={0} max={8} step={1} suffix="px" onChange={(v) => setHandNudge((p) => ({ ...p, settleDepth: v }))} />
              </>
            )}
            {kind === 'legoMovie' && (
              <>
                <RangeRow label="fps" value={legoMovie.fps} min={6} max={30} step={1} onChange={(v) => setLegoMovie((p) => ({ ...p, fps: v }))} />
                <RangeRow label="stagger" value={legoMovie.staggerFrames} min={0} max={6} step={1} suffix="f" onChange={(v) => setLegoMovie((p) => ({ ...p, staggerFrames: v }))} />
                <SelectRow label="order" value={legoMovie.order} options={ORDER_OPTIONS} onChange={(v) => setLegoMovie((p) => ({ ...p, order: v }))} />
                <RangeRow label="max total" value={legoMovie.maxTotalMs} min={200} max={3000} step={50} suffix="ms" onChange={(v) => setLegoMovie((p) => ({ ...p, maxTotalMs: v }))} />
                <RangeRow label="settle" value={legoMovie.settleDepth} min={0} max={8} step={1} suffix="px" onChange={(v) => setLegoMovie((p) => ({ ...p, settleDepth: v }))} />
              </>
            )}
            {kind === 'creep' && (
              <>
                <RangeRow label="fps" value={creep.fps} min={6} max={24} step={1} onChange={(v) => setCreep((p) => ({ ...p, fps: v }))} />
                <RangeRow label="stagger" value={creep.staggerFrames} min={0} max={6} step={1} suffix="f" onChange={(v) => setCreep((p) => ({ ...p, staggerFrames: v }))} />
                <SelectRow label="order" value={creep.order} options={ORDER_OPTIONS} onChange={(v) => setCreep((p) => ({ ...p, order: v }))} />
                <RangeRow label="max total" value={creep.maxTotalMs} min={200} max={3000} step={50} suffix="ms" onChange={(v) => setCreep((p) => ({ ...p, maxTotalMs: v }))} />
                <RangeRow label="settle" value={creep.settleDepth} min={0} max={8} step={1} suffix="px" onChange={(v) => setCreep((p) => ({ ...p, settleDepth: v }))} />
              </>
            )}
          </section>

          {kind === 'gravity' && (
            <section className="motion-dev__section">
              <h2 className="motion-dev__section-title">Gravity</h2>
              <RangeRow label="drop height" value={gravity.dropHeight} min={10} max={80} step={2} suffix="px" onChange={(v) => setGravity((p) => ({ ...p, dropHeight: v }))} />
              <RangeRow label="fall frames" value={gravity.fallFrames} min={1} max={10} step={1} onChange={(v) => setGravity((p) => ({ ...p, fallFrames: v }))} />
              <RangeRow label="overshoot" value={gravity.overshoot} min={0} max={15} step={1} suffix="px" onChange={(v) => setGravity((p) => ({ ...p, overshoot: v }))} />
              <RangeRow label="adjust frames" value={gravity.adjustFrames} min={0} max={8} step={1} onChange={(v) => setGravity((p) => ({ ...p, adjustFrames: v }))} />
              <RangeRow label="land jitter" value={gravity.landJitter} min={0} max={12} step={1} suffix="px" onChange={(v) => setGravity((p) => ({ ...p, landJitter: v }))} />
              <CheckboxRow label="accelerating fall" checked={gravity.accel} onChange={(v) => setGravity((p) => ({ ...p, accel: v }))} />
            </section>
          )}

          {kind === 'handNudge' && (
            <section className="motion-dev__section">
              <h2 className="motion-dev__section-title">Hand-nudge</h2>
              <RangeRow label="nudge dist" value={handNudge.nudgeDist} min={4} max={40} step={2} suffix="px" onChange={(v) => setHandNudge((p) => ({ ...p, nudgeDist: v }))} />
              <SelectRow label="nudge dir" value={handNudge.nudgeDir} options={NUDGE_DIR_OPTIONS} onChange={(v) => setHandNudge((p) => ({ ...p, nudgeDir: v }))} />
              <RangeRow label="nudge count" value={handNudge.nudgeCount} min={2} max={4} step={1} onChange={(v) => setHandNudge((p) => ({ ...p, nudgeCount: v }))} />
              <RangeRow label="frames/nudge" value={handNudge.framesPerNudge} min={1} max={6} step={1} onChange={(v) => setHandNudge((p) => ({ ...p, framesPerNudge: v }))} />
              <RangeRow label="pos jitter" value={handNudge.posJitter} min={0} max={8} step={1} suffix="px" onChange={(v) => setHandNudge((p) => ({ ...p, posJitter: v }))} />
              <RangeRow label="rot jitter" value={handNudge.rotJitter} min={0} max={20} step={1} suffix="°" onChange={(v) => setHandNudge((p) => ({ ...p, rotJitter: v }))} />
            </section>
          )}

          {kind === 'legoMovie' && (
            <section className="motion-dev__section">
              <h2 className="motion-dev__section-title">LEGO-movie</h2>
              <RangeRow label="arc height" value={legoMovie.arcHeight} min={20} max={100} step={4} suffix="px" onChange={(v) => setLegoMovie((p) => ({ ...p, arcHeight: v }))} />
              <RangeRow label="anticipation" value={legoMovie.anticipationFrames} min={0} max={6} step={1} onChange={(v) => setLegoMovie((p) => ({ ...p, anticipationFrames: v }))} />
              <RangeRow label="drop frames" value={legoMovie.dropFrames} min={1} max={12} step={1} onChange={(v) => setLegoMovie((p) => ({ ...p, dropFrames: v }))} />
              <RangeRow label="ripple tightness" value={legoMovie.rippleTightness} min={0.1} max={1} step={0.05} onChange={(v) => setLegoMovie((p) => ({ ...p, rippleTightness: v }))} />
              <RangeRow label="overshoot" value={legoMovie.overshoot} min={0} max={15} step={1} suffix="px" onChange={(v) => setLegoMovie((p) => ({ ...p, overshoot: v }))} />
              <RangeRow label="snap back" value={legoMovie.snapBackFrames} min={0} max={8} step={1} onChange={(v) => setLegoMovie((p) => ({ ...p, snapBackFrames: v }))} />
            </section>
          )}

          {kind === 'creep' && (
            <section className="motion-dev__section">
              <h2 className="motion-dev__section-title">Creep-in</h2>
              <RangeRow label="scoot dist" value={creep.scootDist} min={10} max={140} step={5} suffix="px" onChange={(v) => setCreep((p) => ({ ...p, scootDist: v }))} />
              <RangeRow label="scoot frames" value={creep.scootFrames} min={1} max={12} step={1} onChange={(v) => setCreep((p) => ({ ...p, scootFrames: v }))} />
              <RangeRow label="lift frames" value={creep.liftFrames} min={1} max={12} step={1} onChange={(v) => setCreep((p) => ({ ...p, liftFrames: v }))} />
              <RangeRow label="floor drop" value={creep.floorDrop} min={0} max={1} step={0.05} onChange={(v) => setCreep((p) => ({ ...p, floorDrop: v }))} />
              <RangeRow label="spread" value={creep.spread} min={0} max={1} step={0.05} onChange={(v) => setCreep((p) => ({ ...p, spread: v }))} />
              <RangeRow label="dist jitter" value={creep.distJitter} min={0} max={1} step={0.05} onChange={(v) => setCreep((p) => ({ ...p, distJitter: v }))} />
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
