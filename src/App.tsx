import { useEffect, useState, type ReactNode } from 'react';
import { Booklet } from './booklet/Booklet.tsx';
import { Gallery } from './booklet/Gallery.tsx';
import { SearchLanding } from './search/SearchLanding.tsx';
import { generateBooklet, type ProgressEvent } from './api/generateClient.ts';
import { setNumberFor, slug } from './api/slug.ts';
import type { VoxelGrid } from './voxel/types.ts';
import './booklet/pages.css';

type State =
  | { kind: 'idle' }
  | { kind: 'loading'; term: string; phase: string }
  | { kind: 'success'; term: string; grid: VoxelGrid; cached: boolean }
  | { kind: 'error'; term: string; message: string };

function readQuery(): string | null {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('q');
  if (!q) return null;
  const s = slug(q);
  return s || null;
}

export default function App() {
  const params = new URLSearchParams(window.location.search);
  if (params.has('gallery')) return <Gallery />;
  return <AppMain />;
}

function AppMain() {
  const [term, setTermState] = useState<string | null>(() => readQuery());
  const [state, setState] = useState<State>(() =>
    term ? { kind: 'loading', term, phase: 'starting' } : { kind: 'idle' },
  );

  useEffect(() => {
    const onPop = () => setTermState(readQuery());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!term) {
      setState({ kind: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setState({ kind: 'loading', term, phase: 'starting' });
    generateBooklet(term, {
      signal: ctrl.signal,
      onProgress: (e: ProgressEvent) => {
        setState((s) =>
          s.kind === 'loading' && s.term === term ? { ...s, phase: e.message } : s,
        );
      },
    })
      .then(({ grid, cached }) => setState({ kind: 'success', term, grid, cached }))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const message =
          err instanceof Error ? err.message : 'something went wrong.';
        setState({ kind: 'error', term, message });
      });
    return () => ctrl.abort();
  }, [term]);

  function pushTerm(next: string | null) {
    const url = new URL(window.location.href);
    if (next) url.searchParams.set('q', next);
    else url.searchParams.delete('q');
    window.history.pushState({}, '', url);
    setTermState(next);
  }

  if (state.kind === 'idle') {
    return <SearchLanding onSubmit={(t) => pushTerm(slug(t))} />;
  }

  const setNumber = setNumberFor(state.term);

  return (
    <Shell
      term={state.term}
      setNumber={setNumber}
      cacheState={state.kind === 'success' ? (state.cached ? 'hit' : 'fresh') : null}
      onNewSearch={() => pushTerm(null)}
    >
      {state.kind === 'loading' && (
        <div className="booklet-status">
          <div className="booklet-status__dot" />
          <div className="booklet-status__title">building "{state.term}"</div>
          <div className="booklet-status__sub">
            {state.phase} · seeded terms render instantly. fresh terms take ~15–25s
            once the worker ships.
          </div>
        </div>
      )}
      {state.kind === 'error' && (
        <div className="booklet-status">
          <div className="booklet-status__title">couldn't build "{state.term}"</div>
          <div className="booklet-status__sub">{state.message}</div>
          <button
            type="button"
            className="booklet-status__retry"
            onClick={() => pushTerm(null)}
          >
            new search
          </button>
        </div>
      )}
      {state.kind === 'success' && <Booklet grid={state.grid} setNumber={setNumber} />}
    </Shell>
  );
}

type ShellProps = {
  term: string;
  setNumber: string;
  cacheState: 'hit' | 'fresh' | null;
  onNewSearch: () => void;
  children: ReactNode;
};

function Shell({ term, setNumber, cacheState, onNewSearch, children }: ShellProps) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-header__term">{term}</span>
        {cacheState && (
          <span className={`app-header__cache app-header__cache--${cacheState}`}>
            {cacheState === 'hit' ? 'cached' : 'fresh'}
          </span>
        )}
        <span className="app-header__set">№ {setNumber}</span>
        <button type="button" className="app-header__action" onClick={onNewSearch}>
          new search
        </button>
      </header>
      {children}
    </div>
  );
}
