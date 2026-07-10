import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { Booklet } from './booklet/Booklet.tsx';
import { Surface } from './surface/Surface.tsx';
import { setNumberFor, slug } from './api/slug.ts';
import { generate, type GenerateResult } from './api/generateClient.ts';

// Names only — the booklet's geometry now comes from the Worker (KV),
// not the bundle. Non-eager so the JSON isn't pulled into the main
// chunk; we read just the filenames to build the landing's library
// index. `misses` (ledger) and `run` (verb / poor gen) aren't entries.
const seed4Paths = import.meta.glob('../runs/seed4-16char-mixed/*.json');
const EXCLUDE = new Set(['misses', 'run']);

function seed4Nouns(): string[] {
  return Object.keys(seed4Paths)
    .map((p) => p.match(/\/([^/]+)\.json$/)?.[1])
    .filter((n): n is string => !!n && !EXCLUDE.has(n))
    .sort();
}

type ViewState = { status: 'loading' } | GenerateResult;

function ResultMessage({
  children,
  onReset,
}: {
  children: ReactNode;
  onReset: () => void;
}) {
  return (
    <div className="result-msg">
      <p className="result-msg__text">{children}</p>
      <button type="button" className="result-msg__back" onClick={onReset}>
        Back
      </button>
    </div>
  );
}

function BookletView({ term, onReset }: { term: string; onReset: () => void }) {
  const s = slug(term);
  const [state, setState] = useState<ViewState>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    generate(s).then((r) => {
      if (alive) setState(r);
    });
    return () => {
      alive = false;
    };
  }, [s]);

  if (state.status === 'loading') {
    return (
      <div className="result-msg">
        <p className="result-msg__text">
          building <code>{s}</code>…
        </p>
      </div>
    );
  }

  if (state.status === 'ok') {
    return (
      <Booklet grid={state.grid} term={s} setNumber={setNumberFor(s)} onReset={onReset} />
    );
  }

  // miss | error
  return (
    <ResultMessage onReset={onReset}>
      {state.status === 'miss' ? (
        <>
          no cached build for <code>{s}</code> yet.
        </>
      ) : (
        <>
          couldn’t reach the builder for <code>{s}</code>
          {state.message ? ` (${state.message})` : ''}.
        </>
      )}
    </ResultMessage>
  );
}

function readQuery(): string | null {
  return new URLSearchParams(window.location.search).get('q');
}

export default function App() {
  const nouns = useMemo(seed4Nouns, []);
  const [q, setQ] = useState<string | null>(readQuery);

  useEffect(() => {
    const onPop = () => setQ(readQuery());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(term: string) {
    const s = slug(term);
    window.history.pushState({}, '', `?q=${encodeURIComponent(s)}`);
    setQ(s);
    window.scrollTo(0, 0);
  }

  function reset() {
    window.history.pushState({}, '', './');
    setQ(null);
    window.scrollTo(0, 0);
  }

  if (q) return <BookletView term={q} onReset={reset} />;
  return <Surface nouns={nouns} onSubmit={navigate} />;
}
