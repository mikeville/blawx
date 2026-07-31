// Contact-sheet QA render for a seed batch. For each <term>.json in the run
// dir(s): color via the Worker's colorFor(), render iso + front-ortho, and
// emit one self-contained HTML sheet (PNGs inlined as data URIs) for eyeball
// QA — publishable as an Artifact or openable directly.
//
//   npx tsx scripts/render-qa-sheet.ts <outHtml> <runDir> [runDir ...]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import { COLORS } from '../src/render/palette.ts';
import type { Color } from '../src/render/palette.ts';
import { analyze } from '../../api/src/analyze.ts';
import { colorFor } from '../../api/src/color.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const outHtml = process.argv[2];
const runDirs = process.argv.slice(3);
if (!outHtml || runDirs.length === 0) {
  throw new Error('usage: npx tsx scripts/render-qa-sheet.ts <outHtml> <runDir> [runDir ...]');
}

type Vox = [number, number, number];

function frontOrthoSVG(voxels: Vox[], color: string, size: number): string {
  const cell = 24;
  const nearest = new Map<string, Vox>();
  for (const v of voxels) {
    const k = `${v[0]},${v[1]}`;
    const cur = nearest.get(k);
    if (!cur || v[2] < cur[2]) nearest.set(k, v);
  }
  const rects: string[] = [];
  for (const [x, y] of nearest.values()) {
    rects.push(
      `<rect x="${x * cell}" y="${(size - 1 - y) * cell}" width="${cell}" height="${cell}" ` +
        `fill="${color}" stroke="#00000022" stroke-width="1"/>`,
    );
  }
  const w = size * cell;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}">` +
    `<rect width="${w}" height="${w}" fill="#ffffff"/>${rects.join('')}</svg>`
  );
}

const pngDataUri = (svg: string, width: number) =>
  'data:image/png;base64,' +
  new Resvg(svg, { fitTo: { mode: 'width', value: width } }).render().asPng().toString('base64');

type Card = {
  noun: string;
  run: string;
  iso: string;
  front: string;
  vox: number;
  comps: number;
  ground: boolean;
  floats: number;
  loss: string;
  malformed: number;
};

const cards: Card[] = [];

for (const runDir of runDirs) {
  const abs = path.resolve(runDir);
  const runId = path.basename(abs);
  const files = fs
    .readdirSync(abs)
    .filter((f) => f.endsWith('.json') && f !== 'run.json' && f !== 'scores.json' && f !== 'misses.json')
    .sort();
  for (const f of files) {
    const r = JSON.parse(fs.readFileSync(path.join(abs, f), 'utf8'));
    const voxels = r.voxels as Vox[];
    const color: Color = colorFor(r.noun);
    const hex = COLORS[color] ?? '#A4ACAE';
    const iso = renderIsoSVG(
      voxels.map((v) => [v[0], v[1], v[2]] as const),
      { mode: 'color', colors: voxels.map(() => hex) },
    );
    const a = analyze({ size: r.size, voxels: voxels.map(([x, y, z]) => ({ x, y, z })) } as never);
    const l = r.meta?.hull?.reprojectionLoss ?? { front: 0, side: 0, top: 0 };
    cards.push({
      noun: r.noun,
      run: runId,
      iso: pngDataUri(iso, 320),
      front: pngDataUri(frontOrthoSVG(voxels, hex, r.size), 240),
      vox: voxels.length,
      comps: a.components,
      ground: a.touchesGround,
      floats: a.floatingCount,
      loss: `${l.front.toFixed(2)}/${l.side.toFixed(2)}/${l.top.toFixed(2)}`,
      malformed: r.meta?.hull?.malformedRows ?? 0,
    });
  }
}

const cardHtml = cards
  .map((c) => {
    const bad = c.comps !== 1 || !c.ground || c.malformed > 0;
    return `<figure class="card${bad ? ' flag' : ''}">
  <figcaption><span>${c.noun}</span>${bad ? '<span class="warn">⚠ struct</span>' : ''}</figcaption>
  <div class="imgs"><img src="${c.iso}" alt="${c.noun} iso"><img class="front" src="${c.front}" alt="${c.noun} front"></div>
  <div class="meta">vox ${c.vox} · comp ${c.comps} · grnd ${c.ground ? 'y' : 'n'} · float ${c.floats} · loss ${c.loss} · malf ${c.malformed}</div>
</figure>`;
  })
  .join('\n');

const runList = [...new Set(cards.map((c) => c.run))].join(', ');
const html = `<title>Tier-1 seed QA — ${runList}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #eef1ee; --panel: #ffffff; --ink: #1b2420; --mute: #5d6b64;
    --line: #d7ded8; --accent: #1f7a5a; --flag: #d9662b;
    --studPlate: #fbfcfa;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #141816; --panel: #1d2320; --ink: #e6ece8; --mute: #8b978f; --line: #2c332e; --studPlate: #232a26; }
  }
  :root[data-theme="light"] { --bg: #eef1ee; --panel: #ffffff; --ink: #1b2420; --mute: #5d6b64; --line: #d7ded8; --studPlate: #fbfcfa; }
  :root[data-theme="dark"] { --bg: #141816; --panel: #1d2320; --ink: #e6ece8; --mute: #8b978f; --line: #2c332e; --studPlate: #232a26; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, -apple-system, system-ui, sans-serif; font-size: 14px; line-height: 1.45;
         margin: 0; padding: 28px clamp(20px, 4vw, 48px); background: var(--bg); color: var(--ink); }
  header { max-width: 1200px; margin: 0 auto 22px; }
  h1 { font-size: 19px; font-weight: 650; letter-spacing: -0.01em; margin: 0 0 4px; }
  .sub { color: var(--mute); margin: 0; font-size: 13px; }
  .sub b { color: var(--accent); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(256px, 1fr)); gap: 16px; max-width: 1200px; margin: 0 auto; }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 13px; }
  .card.flag { border-color: var(--flag); box-shadow: inset 0 0 0 1px var(--flag); }
  figure { margin: 0; }
  figcaption { font-weight: 620; text-transform: capitalize; margin-bottom: 9px; letter-spacing: -0.005em; display: flex; justify-content: space-between; align-items: center; }
  figcaption .warn { color: var(--flag); font-size: 12px; }
  .imgs { display: flex; align-items: flex-end; gap: 8px; background: var(--studPlate); border: 1px solid var(--line); border-radius: 8px; padding: 6px; }
  .imgs img { max-width: 100%; display: block; }
  .imgs img.front { width: 74px; align-self: flex-start; border-left: 1px solid var(--line); padding-left: 6px; }
  .meta { margin-top: 9px; font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10.5px; color: var(--mute);
          font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
</style>
<header>
  <h1>Tier-1 seed QA — ${runList}</h1>
  <p class="sub">${cards.length} authored-front sets · <b>left</b> 30° iso (as the app shows it) · <b>right</b> front-ortho (the authored silhouette). ⚠ marks a structural flag.</p>
</header>
<div class="grid">
${cardHtml}
</div>`;

fs.mkdirSync(path.dirname(path.resolve(outHtml)), { recursive: true });
fs.writeFileSync(outHtml, html);
console.log(`wrote ${cards.length} cards → ${outHtml}`);
void HERE;
