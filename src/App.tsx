import { useMemo, useState, useEffect } from 'react';
import { Booklet } from './booklet/Booklet.tsx';
import { SearchLanding } from './search/SearchLanding.tsx';
import { seed4ToGrid, type Seed4Json } from './voxel/seed4.ts';
import { setNumberFor, slug } from './api/slug.ts';

const seed4Modules = import.meta.glob('../runs/seed4-16char-mixed/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

function loadSeed4(): Map<string, Seed4Json> {
  const out = new Map<string, Seed4Json>();
  for (const [path, data] of Object.entries(seed4Modules)) {
    const m = path.match(/\/([^/]+)\.json$/);
    if (!m) continue;
    const name = m[1];
    if (name === 'misses') continue;
    const j = data as Seed4Json;
    if (!j || typeof j !== 'object' || !Array.isArray(j.voxels)) continue;
    out.set(name, j);
  }
  return out;
}

function BookletView({
  term,
  library,
}: {
  term: string;
  library: Map<string, Seed4Json>;
}) {
  const s = slug(term);
  const json = library.get(s);
  if (!json) {
    const available = [...library.keys()].sort().join(', ');
    return (
      <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <p>
          no cached build for <code>{s}</code>.{' '}
          <a href="./">back</a>
        </p>
        <p style={{ opacity: 0.6, fontSize: 12 }}>available: {available}</p>
      </main>
    );
  }
  const grid = seed4ToGrid(json);
  return <Booklet grid={grid} setNumber={setNumberFor(s)} />;
}

function readQuery(): string | null {
  return new URLSearchParams(window.location.search).get('q');
}

export default function App() {
  const library = useMemo(loadSeed4, []);
  const [q, setQ] = useState<string | null>(readQuery);

  useEffect(() => {
    const onPop = () => setQ(readQuery());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(term: string) {
    const s = slug(term);
    const url = `?q=${encodeURIComponent(s)}`;
    window.history.pushState({}, '', url);
    setQ(s);
    window.scrollTo(0, 0);
  }

  if (q) return <BookletView term={q} library={library} />;
  return (
    <SearchLanding
      nouns={[...library.keys()]}
      onSubmit={navigate}
    />
  );
}
