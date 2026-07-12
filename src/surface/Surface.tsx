import { useMemo, useState } from 'react';
import { colorFor } from '../voxel/seed4.ts';
import type { Color } from '../voxel/types.ts';
import { COLORS as PALETTE_HEX } from '../render/palette.ts';
import { validateTerm } from '../api/slug.ts';
import { buildHeroPool, sample } from './heroSets.ts';
import './surface.css';

type Props = {
  nouns: string[];
  onSubmit: (term: string) => void;
};

const PICK_COUNT = 7;

function displayNoun(noun: string): string {
  return noun.replace(/-/g, ' ');
}

// Pick swatches borrow the exact brick colors via the same tokens the
// renderer paints with — never a hardcoded hex. orange/brown/tan don't have
// design tokens yet (tokens.css is out of scope for the color-overlay work
// that added them to the Color union), so those three fall back to the
// palette's hex directly; colorFor() never actually returns them today, so
// this is a type-completeness fallback, not a live code path.
const SWATCH_VAR: Record<Color, string> = {
  red: 'var(--red)',
  yellow: 'var(--yellow)',
  blue: 'var(--blue)',
  green: 'var(--green)',
  white: 'var(--brick-white)',
  black: 'var(--ink)',
  lightGray: 'var(--gray)',
  orange: PALETTE_HEX.orange,
  brown: PALETTE_HEX.brown,
  tan: PALETTE_HEX.tan,
};

// The idle content below the seam rule: "Name your brick set" + a few
// randomized parts-legend picks. The iso stage above the rule lives in the
// Shell now, so this component owns only the form.
export function Surface({ nouns, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const heroPool = useMemo(() => buildHeroPool(nouns), [nouns]);

  // Chosen once per mount — stable for the life of this screen, re-rolled
  // only when the idle surface remounts (a reset back from a result).
  const [picks] = useState<string[]>(() =>
    sample(heroPool, Math.min(PICK_COUNT, heroPool.length)),
  );

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
  );
}
