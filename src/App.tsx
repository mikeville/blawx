import { useMemo, useState, useEffect } from 'react';
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

function BookletView({ term }: { term: string }) {
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
      <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <p style={{ opacity: 0.6 }}>
          building <code>{s}</code>…
        </p>
      </main>
    );
  }

  if (state.status === 'ok') {
    return <Booklet grid={state.grid} setNumber={setNumberFor(s)} />;
  }

  // miss | error
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      {state.status === 'miss' ? (
        <p>
          no cached build for <code>{s}</code> yet. <a href="./">back</a>
        </p>
      ) : (
        <p>
          couldn’t reach the builder for <code>{s}</code>
          {state.message ? ` (${state.message})` : ''}. <a href="./">back</a>
        </p>
      )}
    </main>
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

  if (q) return <BookletView term={q} />;
  return <Surface nouns={nouns} onSubmit={navigate} />;
}
