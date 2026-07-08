import { useMemo } from 'react';
import { Booklet } from './booklet/Booklet.tsx';
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

function BookletView({ term }: { term: string }) {
  const library = useMemo(loadSeed4, []);
  const s = slug(term);
  const json = library.get(s);
  if (!json) {
    const available = [...library.keys()].sort().join(', ');
    return (
      <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <p>
          no cached build for <code>{s}</code>.
        </p>
        <p style={{ opacity: 0.6, fontSize: 12 }}>available: {available}</p>
      </main>
    );
  }
  const grid = seed4ToGrid(json);
  return <Booklet grid={grid} setNumber={setNumberFor(s)} />;
}

export default function App() {
  const q = new URLSearchParams(window.location.search).get('q');
  if (q) return <BookletView term={q} />;
  return (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <p>landing page pending — try <code>?q=cat</code>.</p>
    </main>
  );
}
