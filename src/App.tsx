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
import './app.css';

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
  showMasks,
  score,
}: {
  item: Item;
  index: number;
  runId: string;
  blind: boolean;
  color: boolean;
  showMasks: boolean;
  score?: RunScores[string];
}) {
  const { result, dropped } = item;
  const svg = useMemo(
    () =>
      renderIsoSVG(result.voxels, {
        mode: color ? 'color' : 'monotone',
        colors: result.colors,
      }),
    [result, color],
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

function RunSection({
  run,
  blind,
  color,
  showMasks,
}: {
  run: Run;
  blind: boolean;
  color: boolean;
  showMasks: boolean;
}) {
  const scored = run.scores
    ? run.items.filter((i) => run.scores![i.result.noun])
    : [];
  const mean =
    scored.length > 0
      ? scored.reduce((s, i) => s + VERDICT_VALUE[run.scores![i.result.noun].verdict], 0) /
        scored.length
      : null;
  return (
    <section className="run">
      <header>
        <h2>{run.manifest?.label ?? run.id}</h2>
        <span className="run-info">
          {run.manifest?.date} · {run.manifest?.pipeline} · {run.items.length} items
          {!blind && mean != null && (
            <strong> · blind-name {Math.round(mean * 100)}%</strong>
          )}
        </span>
        <button type="button" onClick={() => void exportRunPngs(run)}>
          export scoring pngs
        </button>
      </header>
      {run.errors.length > 0 && (
        <p className="errors">unparseable: {run.errors.join('; ')}</p>
      )}
      <div className="grid">
        {run.items.map((item, i) => (
          <Tile
            key={item.file}
            item={item}
            index={i}
            runId={run.id}
            blind={blind}
            color={color}
            showMasks={showMasks}
            score={run.scores?.[item.result.noun]}
          />
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const runs = useMemo(loadRuns, []);
  const hasMasks = useMemo(
    () => runs.some((run) => run.items.some((i) => i.result.meta?.masks)),
    [runs],
  );
  const [blind, setBlind] = useState(false);
  const [color, setColor] = useState(false);
  const [showMasks, setShowMasks] = useState(hasMasks);
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
      {runs.length === 0 && (
        <p className="empty">
          No runs found. Drop result JSON into <code>runs/&lt;run-id&gt;/</code> —
          see <code>runs/README.md</code>.
        </p>
      )}
      {runs.map((run) => (
        <RunSection key={run.id} run={run} blind={blind} color={color} showMasks={showMasks} />
      ))}
    </main>
  );
}
