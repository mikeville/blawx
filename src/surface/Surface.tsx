import { useMemo, useState } from 'react';
import { validateTerm } from '../api/slug.ts';
import { buildHeroPool, sample } from './heroSets.ts';
import './surface.css';

type Props = {
  nouns: string[];
  onSubmit: (term: string) => void;
};

// A few suggestions fit on two rows of chips; keep the row from overflowing.
const PICK_COUNT = 5;

function displayNoun(noun: string): string {
  return noun.replace(/-/g, ' ');
}

// The idle content below the seam rule: "Name your set" + a few randomized
// suggestion chips. The iso stage above the rule lives in the Shell now, so
// this component owns only the form.
export function Surface({ nouns, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const heroPool = useMemo(() => buildHeroPool(nouns), [nouns]);

  // Chosen once per mount — stable for the life of this screen, re-rolled
  // only when the idle surface remounts (a reset back from a result).
  const [picks] = useState<string[]>(() =>
    sample(heroPool, Math.min(PICK_COUNT, heroPool.length)),
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
      <h1 className="surface__stephead">Name your set</h1>

      <input
        className="surface__input"
        type="text"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type anything"
        autoComplete="off"
        spellCheck={false}
        maxLength={40}
      />

      {error && <p className="surface__error">{error}</p>}

      {picks.length > 0 && (
        <div className="surface__picks">
          {picks.map((noun) => (
            <button
              key={noun}
              type="button"
              className="surface__pick"
              onClick={() => submit(noun)}
            >
              {displayNoun(noun)}
            </button>
          ))}
        </div>
      )}

      <button type="submit" className="surface__submit" disabled={!value.trim()}>
        Generate set
      </button>
    </form>
  );
}
