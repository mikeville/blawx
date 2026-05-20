import { useState } from 'react';
import { mockTerms } from '../api/mockCache.ts';
import { validateTerm } from '../api/slug.ts';
import './search.css';

type Props = {
  onSubmit: (term: string) => void;
};

export function SearchLanding({ onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const chips = mockTerms();

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
    <div className="landing">
      <div className="landing__inner">
        <h1 className="landing__title">blawx</h1>
        <p className="landing__sub">
          type any noun. get a LEGO-style instruction booklet.
        </p>
        <form
          className="landing__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <input
            className="landing__input"
            name="q"
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="duck"
            autoFocus
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="landing__submit" type="submit">build</button>
        </form>
        {error && <div className="landing__error">{error}</div>}
        {chips.length > 0 && (
          <div className="landing__chips">
            <span className="landing__chips-label">try</span>
            {chips.map((c) => (
              <button
                key={c}
                type="button"
                className="landing__chip"
                onClick={() => submit(c)}
              >
                {c}
              </button>
            ))}
          </div>
        )}
        <p className="landing__footnote">
          15 seeded terms render instantly. fresh terms come later — a worker is
          on the way.
        </p>
      </div>
    </div>
  );
}
