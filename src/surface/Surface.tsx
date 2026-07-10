import { useEffect, useMemo, useState } from 'react';
import { Scene } from '../render/Scene.tsx';
import { seed4ToGrid, colorFor, type Seed4Json } from '../voxel/seed4.ts';
import { buildSteps, allBricks } from '../voxel/steps.ts';
import type { Brick, Color } from '../voxel/types.ts';
import { validateTerm } from '../api/slug.ts';
import './surface.css';

type Props = {
  nouns: string[];
  onSubmit: (term: string) => void;
};

const PICK_COUNT = 7;

// Curated pool of sets that read cleanly as a "hero" object at 16³. The
// idle stage and the parts-legend picks both draw from this (falling back
// to the full library if none are cached). Arbitrary for now — curate later.
const HERO_SETS = [
  'duck', 'cat', 'fox', 'penguin', 'rocket-ship', 'sailboat', 'house',
  'tree', 'robot', 'dragon', 'octopus', 'snail', 'mushroom', 'car', 'fish',
];

// Non-eager: grid JSON never enters the idle bundle until a set is picked
// or the random idle model resolves. Same glob shape as App.tsx's noun
// index, but keyed here for loading the actual voxel payload — $0,
// network-free, no Worker involved.
const seed4Modules = import.meta.glob<{ default: Seed4Json }>(
  '../../runs/seed4-16char-mixed/*.json',
);

function loaderForNoun(noun: string) {
  const path = Object.keys(seed4Modules).find((p) => p.endsWith(`/${noun}.json`));
  return path ? seed4Modules[path] : undefined;
}

function sample<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy.slice(0, n);
}

function displayNoun(noun: string): string {
  return noun.replace(/-/g, ' ');
}

// Pick swatches borrow the exact brick colors via the same tokens the
// renderer paints with — never a hardcoded hex.
const SWATCH_VAR: Record<Color, string> = {
  red: 'var(--red)',
  yellow: 'var(--yellow)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  white: 'var(--brick-white)',
  black: 'var(--ink)',
  lightGray: 'var(--gray)',
};

export function Surface({ nouns, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Draw from the curated hero pool where possible; fall back to the full
  // library if none of the hero sets are cached.
  const heroPool = useMemo(() => {
    const have = new Set(nouns);
    const pool = HERO_SETS.filter((n) => have.has(n));
    return pool.length > 0 ? pool : nouns;
  }, [nouns]);

  // Chosen once per mount — the idle model and the parts-legend picks
  // are stable for the life of this screen, not re-rolled on rerender.
  const [idleNoun] = useState<string | null>(() =>
    heroPool.length > 0 ? (heroPool[Math.floor(Math.random() * heroPool.length)] ?? null) : null,
  );
  const [picks] = useState<string[]>(() =>
    sample(heroPool, Math.min(PICK_COUNT, heroPool.length)),
  );
  const [idleBricks, setIdleBricks] = useState<Brick[]>([]);

  useEffect(() => {
    if (!idleNoun) return;
    const loader = loaderForNoun(idleNoun);
    if (!loader) return;
    let alive = true;
    loader().then((mod) => {
      if (!alive) return;
      const grid = seed4ToGrid(mod.default);
      setIdleBricks(allBricks(buildSteps(grid)));
    });
    return () => {
      alive = false;
    };
  }, [idleNoun]);

  const pickSwatches = useMemo(
    () => picks.map((noun) => ({ noun, color: colorFor(noun) })),
    [picks],
  );

  function submit(raw: string) {
    const err = validateTerm(raw);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSubmit(raw);
  }

  return (
    <div className="surface">
      <div className="surface__sheet">
        <header className="surface__masthead">
          <span className="surface__mark">blawx</span>
        </header>

        <div className="surface__stage">
          <Scene cumulative={[]} fresh={idleBricks} />
        </div>

        <form
          className="surface__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <div className="surface__step">
            <span className="surface__stepnum">1</span>
            <div className="surface__stepbody">
              <h1 className="surface__stephead">Name your brick set</h1>

              <input
                className="surface__input"
                type="text"
                name="q"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="octopus"
                autoComplete="off"
                spellCheck={false}
                maxLength={40}
              />

              {error && <p className="surface__error">{error}</p>}

              {pickSwatches.length > 0 && (
                <div className="surface__picks">
                  {pickSwatches.map(({ noun, color }) => (
                    <button
                      key={noun}
                      type="button"
                      className="surface__pick"
                      onClick={() => submit(noun)}
                    >
                      <span
                        className="surface__swatch"
                        style={{ background: SWATCH_VAR[color] }}
                      />
                      <span className="surface__pickname">{displayNoun(noun)}</span>
                    </button>
                  ))}
                </div>
              )}

              <button type="submit" className="surface__submit" disabled={!value.trim()}>
                Generate set
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
