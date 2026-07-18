import { useMemo, useState } from 'react';
import { renderIsoSVG } from './bench/isoRender.ts';
import {
  parseBenchResult,
  VERDICT_VALUE,
  type BenchResult,
  type RunManifest,
  type RunScores,
} from './bench/types.ts';
import { hypotheticalCostUSD } from './bench/cost.ts';
import { Booklet } from './booklet/Booklet.tsx';
import { seed4ToGrid, type Seed4Json } from './voxel/seed4.ts';
import { setNumberFor, slug } from './api/slug.ts';
import './app.css';

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

const modules = import.meta.glob('../runs/*/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

type Item = { result: BenchResult; dropped: number; file: string };
type Run = {
  id: string;
  manifest?: RunManifest;
  scores?: RunScores;
  items: Item[];
  errors: string[];
};

function loadRuns(): Run[] {
  const runs = new Map<string, Run>();
  for (const [path, data] of Object.entries(modules)) {
    const m = path.match(/runs\/([^/]+)\/([^/]+)\.json$/);
    if (!m) continue;
    const id = m[1];
    const name = m[2];
    let run = runs.get(id);
    if (!run) {
      run = { id, items: [], errors: [] };
      runs.set(id, run);
    }
    if (name === 'run') {
      run.manifest = data as RunManifest;
    } else if (name === 'scores') {
      run.scores = data as RunScores;
    } else if (name === 'gen' || name === 'misses' || name === 'scores-calibration') {
      // Known non-result sidecars (generation manifests, miss lists,
      // calibration passes) — not BenchResult items, not errors either.
      continue;
    } else {
      try {
        const { result, dropped } = parseBenchResult(data);
        run.items.push({ result, dropped, file: name });
      } catch (e) {
        run.errors.push(`${name}.json — ${(e as Error).message}`);
      }
    }
  }
  for (const run of runs.values()) {
    // Alphabetical by noun: this order defines the opaque item numbering
    // used for blind-scoring PNG filenames.
    run.items.sort((a, b) => a.result.noun.localeCompare(b.result.noun));
  }
  return [...runs.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function downloadPng(svg: string, filename: string, scale = 2): void {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d');
    URL.revokeObjectURL(url);
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };
  img.src = url;
}

const itemId = (i: number) => `item${String(i + 1).padStart(2, '0')}`;

/** Tiny monotone pixel grid for a single view's mask rows ('#'/'.'). */
function maskThumbSVG(rows: string[]): string {
  const size = rows.length;
  const cell = 4;
  const dim = size * cell;
  const rects: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      if (rows[r][c] === '#') {
        rects.push(`<rect x="${c * cell}" y="${r * cell}" width="${cell}" height="${cell}"/>`);
      }
    }
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}">` +
    `<rect x="0" y="0" width="${dim}" height="${dim}" fill="#f0f0ea"/>` +
    `<g fill="#1c1c1a">${rects.join('')}</g></svg>`
  );
}

function MaskThumbs({ masks }: { masks: NonNullable<BenchResult['meta']>['masks'] }) {
  if (!masks) return null;
  return (
    <div className="tile-masks">
      {(['front', 'side', 'top'] as const).map((v) => (
        <div key={v} className="tile-mask" title={v}>
          <div dangerouslySetInnerHTML={{ __html: maskThumbSVG(masks[v]) }} />
          <span>{v}</span>
        </div>
      ))}
    </div>
  );
}

async function exportRunPngs(run: Run): Promise<void> {
  // Filenames are opaque on purpose: a noun in the filename would leak the
  // answer to the blind namer. Mapping is visible in the UI (blind off).
  for (let i = 0; i < run.items.length; i++) {
    downloadPng(
      renderIsoSVG(run.items[i].result.voxels),
      `${run.id}-${itemId(i)}.png`,
    );
    await new Promise((r) => setTimeout(r, 400));
  }
}

function Tile({
  item,
  index,
  runId,
  blind,
  color,
  shaded,
  showMasks,
  score,
}: {
  item: Item;
  index: number;
  runId: string;
  blind: boolean;
  color: boolean;
  shaded: boolean;
  showMasks: boolean;
  score?: RunScores[string];
}) {
  const { result, dropped } = item;
  const svg = useMemo(
    () =>
      renderIsoSVG(result.voxels, {
        // shaded wins over color: it is the presentation experiment being
        // A/B'd against the neutral eval render.
        mode: shaded ? 'shaded' : color ? 'color' : 'monotone',
        colors: result.colors,
      }),
    [result, color, shaded],
  );
  const cost =
    result.meta?.model && result.meta.tokensIn != null && result.meta.tokensOut != null
      ? hypotheticalCostUSD(result.meta.model, result.meta.tokensIn, result.meta.tokensOut)
      : null;
  const hull = result.meta?.hull;
  const maxLoss = hull
    ? Math.max(hull.reprojectionLoss.front, hull.reprojectionLoss.side, hull.reprojectionLoss.top)
    : 0;
  const hullWarn =
    hull && (hull.malformedRows > 0 || maxLoss > 0.05)
      ? [
          hull.malformedRows > 0 ? `${hull.malformedRows} bad rows` : null,
          maxLoss > 0.05 ? `loss ${Math.round(maxLoss * 100)}%` : null,
        ]
          .filter(Boolean)
          .join(' · ')
      : null;
  return (
    <figure className="tile">
      <div className="tile-render" dangerouslySetInnerHTML={{ __html: svg }} />
      {showMasks && <MaskThumbs masks={result.meta?.masks} />}
      <figcaption>
        <span className="tile-name">{blind ? itemId(index) : result.noun}</span>
        {!blind && score && (
          <span className={`verdict verdict-${score.verdict}`} title={score.answer}>
            {score.verdict}
          </span>
        )}
      </figcaption>
      <div className="tile-meta">
        <span>
          {result.size}³ · {result.voxels.length}vx
          {dropped > 0 && <em className="warn"> · {dropped} dropped</em>}
          {hullWarn && <em className="warn"> · {hullWarn}</em>}
        </span>
        {cost != null && <span>${cost.toFixed(4)}</span>}
        <button
          type="button"
          onClick={() => downloadPng(svg, `${runId}-${itemId(index)}.png`)}
        >
          png
        </button>
      </div>
    </figure>
  );
}

function runMean(run: Run): number | null {
  if (!run.scores) return null;
  const scored = run.items.filter((i) => run.scores![i.result.noun]);
  if (scored.length === 0) return null;
  return (
    scored.reduce((s, i) => s + VERDICT_VALUE[run.scores![i.result.noun].verdict], 0) /
    scored.length
  );
}

function runGroup(run: Run): string {
  // First hyphen-delimited token of the id: probe1-16char-fable -> "probe1".
  // Not perfect but matches the seed/probe/gen/sweep/relift/icon naming.
  return run.id.split('-')[0] ?? run.id;
}

function RunSection({
  run,
  blind,
  color,
  shaded,
  showMasks,
  collapsed,
  onToggle,
}: {
  run: Run;
  blind: boolean;
  color: boolean;
  shaded: boolean;
  showMasks: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const mean = runMean(run);
  return (
    <section className={`run${collapsed ? ' run-collapsed' : ''}`}>
      <header>
        <button
          type="button"
          className="run-toggle"
          onClick={onToggle}
          aria-expanded={!collapsed}
          title={run.manifest?.label ?? run.id}
        >
          <span className="run-caret">{collapsed ? '▸' : '▾'}</span>
          <h2>{run.id}</h2>
        </button>
        <span className="run-info" title={run.manifest?.pipeline}>
          <span className="run-date">{run.manifest?.date ?? '—'}</span>
          <span> · {run.items.length} items</span>
          {!blind && mean != null && (
            <strong> · blind-name {Math.round(mean * 100)}%</strong>
          )}
          {run.manifest?.label && (
            <span className="run-label"> · {run.manifest.label}</span>
          )}
        </span>
        <button type="button" onClick={() => void exportRunPngs(run)}>
          export scoring pngs
        </button>
      </header>
      {!collapsed && run.errors.length > 0 && (
        <p className="errors">unparseable: {run.errors.join('; ')}</p>
      )}
      {!collapsed && (
        <div className="grid">
          {run.items.map((item, i) => (
            <Tile
              key={item.file}
              item={item}
              index={i}
              runId={run.id}
              blind={blind}
              color={color}
              shaded={shaded}
              showMasks={showMasks}
              score={run.scores?.[item.result.noun]}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type SortKey = 'date-desc' | 'date-asc' | 'id-asc' | 'score-desc' | 'items-desc';

const SORT_LABELS: Record<SortKey, string> = {
  'date-desc': 'date (newest)',
  'date-asc': 'date (oldest)',
  'id-asc': 'id (a-z)',
  'score-desc': 'blind-name score',
  'items-desc': 'item count',
};

function sortRuns(runs: Run[], key: SortKey): Run[] {
  const copy = [...runs];
  copy.sort((a, b) => {
    switch (key) {
      case 'date-desc':
      case 'date-asc': {
        const ad = a.manifest?.date ?? '';
        const bd = b.manifest?.date ?? '';
        // Missing dates sink either way.
        if (!ad && !bd) return a.id.localeCompare(b.id);
        if (!ad) return 1;
        if (!bd) return -1;
        const cmp = ad.localeCompare(bd);
        return key === 'date-desc' ? -cmp : cmp;
      }
      case 'id-asc':
        return a.id.localeCompare(b.id);
      case 'score-desc': {
        const am = runMean(a);
        const bm = runMean(b);
        if (am == null && bm == null) return a.id.localeCompare(b.id);
        if (am == null) return 1;
        if (bm == null) return -1;
        return bm - am;
      }
      case 'items-desc':
        return b.items.length - a.items.length || a.id.localeCompare(b.id);
    }
  });
  return copy;
}

export default function App() {
  const q = new URLSearchParams(window.location.search).get('q');
  if (q) return <BookletView term={q} />;
  return <ContactSheet />;
}

function ContactSheet() {
  const runs = useMemo(loadRuns, []);
  const hasMasks = useMemo(
    () => runs.some((run) => run.items.some((i) => i.result.meta?.masks)),
    [runs],
  );
  const groups = useMemo(() => {
    const s = new Set<string>();
    for (const r of runs) s.add(runGroup(r));
    return [...s].sort();
  }, [runs]);

  const [blind, setBlind] = useState(false);
  const [color, setColor] = useState(false);
  const [shaded, setShaded] = useState(false);
  const [showMasks, setShowMasks] = useState(hasMasks);
  const [sort, setSort] = useState<SortKey>('date-desc');
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  // Default: all collapsed, so the sorted/filtered list is scannable at a glance.
  // Track which run ids are open; empty set = all collapsed.
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());

  const filteredSorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = runs.filter((r) => {
      if (groupFilter !== 'all' && runGroup(r) !== groupFilter) return false;
      if (!q) return true;
      const hay = `${r.id} ${r.manifest?.label ?? ''} ${r.manifest?.pipeline ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
    return sortRuns(filtered, sort);
  }, [runs, sort, query, groupFilter]);

  const toggleRun = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setOpenIds(new Set(filteredSorted.map((r) => r.id)));
  const collapseAll = () => setOpenIds(new Set());

  return (
    <main>
      <header className="page-header">
        <h1>blawx2 · benchmark contact sheet</h1>
        <div className="controls">
          <label>
            <input type="checkbox" checked={blind} onChange={(e) => setBlind(e.target.checked)} />
            blind
          </label>
          <label>
            <input type="checkbox" checked={color} onChange={(e) => setColor(e.target.checked)} />
            color (secondary)
          </label>
          <label>
            <input type="checkbox" checked={shaded} onChange={(e) => setShaded(e.target.checked)} />
            shaded (experiment)
          </label>
          {hasMasks && (
            <label>
              <input
                type="checkbox"
                checked={showMasks}
                onChange={(e) => setShowMasks(e.target.checked)}
              />
              masks
            </label>
          )}
        </div>
      </header>
      <div className="run-controls">
        <label>
          sort
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          group
          <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
            <option value="all">all ({runs.length})</option>
            {groups.map((g) => {
              const n = runs.filter((r) => runGroup(r) === g).length;
              return (
                <option key={g} value={g}>
                  {g} ({n})
                </option>
              );
            })}
          </select>
        </label>
        <input
          type="search"
          placeholder="filter by id / label / pipeline"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="run-search"
        />
        <span className="run-count">
          {filteredSorted.length} / {runs.length}
        </span>
        <div className="run-controls-spacer" />
        <button type="button" onClick={expandAll}>
          expand all
        </button>
        <button type="button" onClick={collapseAll}>
          collapse all
        </button>
      </div>
      {runs.length === 0 && (
        <p className="empty">
          No runs found. Drop result JSON into <code>runs/&lt;run-id&gt;/</code> —
          see <code>runs/README.md</code>.
        </p>
      )}
      {runs.length > 0 && filteredSorted.length === 0 && (
        <p className="empty">No runs match the current filter.</p>
      )}
      {filteredSorted.map((run) => (
        <RunSection
          key={run.id}
          run={run}
          blind={blind}
          color={color}
          shaded={shaded}
          showMasks={showMasks}
          collapsed={!openIds.has(run.id)}
          onToggle={() => toggleRun(run.id)}
        />
      ))}
    </main>
  );
}
