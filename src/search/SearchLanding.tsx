import { useState } from 'react';
import { validateTerm } from '../api/slug.ts';
import './search.css';

type Props = {
  nouns: string[];
  onSubmit: (term: string) => void;
};

export function SearchLanding({ nouns, onSubmit }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit(raw: string) {
    const err = validateTerm(raw);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onSubmit(raw);
  }

  const sorted = [...nouns].sort();

  return (
    <div className="landing">
      <div className="landing__sheet">
        <header className="landing__masthead">
          <span className="landing__mark">blawx</span>
          <span className="landing__page">p. 01</span>
        </header>

        <hr className="landing__rule" />

        <section className="landing__step">
          <span className="landing__stepnum">1</span>
          <div className="landing__stepbody">
            <h1 className="landing__stephead">Name your set</h1>
            <p className="landing__stepsub">enter a noun below</p>
          </div>
        </section>

        <form
          className="landing__form"
          onSubmit={(e) => {
            e.preventDefault();
            submit(value);
          }}
        >
          <label className="landing__field">
            <span className="landing__fieldlabel">Noun</span>
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
          </label>
          <button
            className="landing__submit"
            type="submit"
            disabled={!value.trim()}
          >
            Build set
          </button>
        </form>

        {error && <div className="landing__error">{error}</div>}

        <hr className="landing__rule" />

        <section className="landing__step">
          <span className="landing__stepnum">2</span>
          <div className="landing__stepbody">
            <h2 className="landing__stephead">Or pick from the library</h2>
            <p className="landing__stepsub">
              {sorted.length} pre-built sets render instantly
            </p>
          </div>
        </section>

        <ol className="landing__index">
          {sorted.map((noun, i) => (
            <li key={noun} className="landing__indexitem">
              <button
                type="button"
                className="landing__indexbtn"
                onClick={() => submit(noun)}
              >
                <span className="landing__indexnum">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="landing__indexname">{noun}</span>
              </button>
            </li>
          ))}
        </ol>

        <hr className="landing__rule" />

        <footer className="landing__foot">
          16 × 16 × 16 bricks · step-by-step booklet
        </footer>
      </div>
    </div>
  );
}
