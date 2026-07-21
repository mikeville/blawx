// Pre-seed library selection: embed the candidate pool with bge-small-en-v1.5
// (the same model Workers AI serves as @cf/baai/bge-small-en-v1.5, so coverage
// geometry is measured in the production NN space), run farthest-point sampling
// seeded with the Tier-1 head list, and report covering numbers at several
// candidate similarity floors. $0 — the model runs locally via transformers.js.
//
//   npx tsx scripts/seed-pool.ts
//
// Inputs  (data/seed-pool/): candidates.json, tier1.txt, holdout.txt
// Outputs (data/seed-pool/): seed-list.json, covering-report.md
// Embeddings are cached at data/seed-pool/.cache-embeddings.json (gitignored).

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pipeline } from '@huggingface/transformers';
import { normalizeQuery } from './lib/normalize.ts';

const DIR = new URL('../data/seed-pool/', import.meta.url).pathname;
// SEED_POOL_MODEL=Xenova/bge-base-en-v1.5 runs the same analysis in another
// embedding space; non-default models get suffixed output filenames so spaces
// can be compared side by side. Floors/gates are NOT comparable across models —
// each space has its own similarity scale.
const MODEL = process.env.SEED_POOL_MODEL ?? 'Xenova/bge-small-en-v1.5';
const DIM = { 'Xenova/bge-small-en-v1.5': 384, 'Xenova/bge-base-en-v1.5': 768, 'Xenova/bge-large-en-v1.5': 1024 }[MODEL];
if (!DIM) throw new Error(`unknown model ${MODEL}`);
const SUFFIX = MODEL === 'Xenova/bge-small-en-v1.5' ? '' : '-' + MODEL.split('/')[1].replace('-en-v1.5', '');
// Floor band calibrated on probe pairs in the bge-small space: castle→palace
// (good stand-in) 0.649, castle→chess (bad stand-in) 0.532, duck→goose 0.772.
const FLOORS = [0.55, 0.6, 0.65, 0.7, 0.75];

interface Candidate {
  term: string;
  sources: string[];
  verdict: 'keep' | 'drop';
  tag: string | null;
}

function readLines(file: string): string[] {
  return readFileSync(DIR + file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

const candidates = (JSON.parse(readFileSync(DIR + 'candidates.json', 'utf8')) as Candidate[])
  .filter((c) => c.verdict === 'keep');
const tier1 = readLines('tier1.txt').map(normalizeQuery);
let holdout = readLines('holdout.txt').map(normalizeQuery);

const poolTerms = [...new Set(candidates.map((c) => normalizeQuery(c.term)))];
const poolSet = new Set(poolTerms);
const holdoutInPool = holdout.filter((q) => poolSet.has(q));
if (holdoutInPool.length > 0) {
  console.warn(`holdout entries already in pool, excluded: ${holdoutInPool.join(', ')}`);
  holdout = holdout.filter((q) => !poolSet.has(q));
}
const tier1Missing = tier1.filter((t) => !poolSet.has(t));
if (tier1Missing.length > 0) {
  console.warn(`tier1 terms not in filtered pool (embedded + seeded anyway): ${tier1Missing.join(', ')}`);
}

// ---- embeddings (cached — the model download is ~30 MB, the encode ~1 min) ----

const allTerms = [...new Set([...poolTerms, ...tier1, ...holdout])];
const cachePath = DIR + `.cache-embeddings${SUFFIX}.json`;
let cache: Record<string, number[]> = {};
if (existsSync(cachePath)) cache = JSON.parse(readFileSync(cachePath, 'utf8'));
const missing = allTerms.filter((t) => !cache[t]);

if (missing.length > 0) {
  console.log(`embedding ${missing.length} terms with ${MODEL} …`);
  const extractor = await pipeline('feature-extraction', MODEL);
  const BATCH = 64;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const out = await extractor(batch, { pooling: 'mean', normalize: true });
    const data = out.data as Float32Array;
    batch.forEach((term, j) => {
      cache[term] = Array.from(data.slice(j * DIM, (j + 1) * DIM));
    });
    console.log(`  ${Math.min(i + BATCH, missing.length)}/${missing.length}`);
  }
  writeFileSync(cachePath, JSON.stringify(cache));
}

const vec = (t: string): number[] => {
  const v = cache[t];
  if (!v) throw new Error(`no embedding for "${t}"`);
  return v;
};
const sim = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s; // vectors are L2-normalized
};

// ---- farthest-point sampling seeded with Tier 1 ----

// Every pool candidate tracks its best similarity to any chosen seed. FPS
// repeatedly promotes the worst-covered candidate. One pass yields the whole
// radius curve: covering number at floor f = seeds needed before the
// worst-covered candidate sits at similarity ≥ f.
const covered = new Map<string, number>(poolTerms.map((t) => [t, -1]));
const seeds: { term: string; tier: 'tier1' | 'fps'; radiusBefore: number | null }[] = [];

function addSeed(term: string, tier: 'tier1' | 'fps', radiusBefore: number | null) {
  seeds.push({ term, tier, radiusBefore });
  const sv = vec(term);
  covered.delete(term);
  for (const [t, best] of covered) {
    const s = sim(sv, vec(t));
    if (s > best) covered.set(t, s);
  }
}

for (const t of tier1) addSeed(t, 'tier1', null);

const worst = (): { term: string; sim: number } => {
  let wt = '';
  let ws = Infinity;
  for (const [t, s] of covered) if (s < ws) { ws = s; wt = t; }
  return { term: wt, sim: ws };
};

const coveringNumbers = new Map<number, number>();
const floorExamples = new Map<number, string[]>();
let pendingFloors = [...FLOORS].sort((a, b) => a - b); // loosest first
while (covered.size > 0 && pendingFloors.length > 0) {
  const w = worst();
  while (pendingFloors.length > 0 && w.sim >= pendingFloors[0]) {
    const f = pendingFloors.shift()!;
    coveringNumbers.set(f, seeds.length);
    // eyeball-calibration pairs: the 8 worst-covered survivors at this floor
    const pairs = [...covered.entries()].sort((a, b) => a[1] - b[1]).slice(0, 8)
      .map(([t, s]) => {
        let bt = ''; let bs = -1;
        for (const sd of seeds) { const x = sim(vec(t), vec(sd.term)); if (x > bs) { bs = x; bt = sd.term; } }
        return `${t} → ${bt} (${s.toFixed(3)})`;
      });
    floorExamples.set(f, pairs);
  }
  if (pendingFloors.length === 0) break;
  addSeed(w.term, 'fps', w.sim);
}

// ---- prefix-library analysis: library size vs display-gate quality ----
// The covering number fixes the library SIZE at a floor; the display gate is a
// separate product knob (show a neighbor only when sim ≥ gate). For each floor's
// prefix library, measure what fraction of the pool clears each gate, and sample
// typical (random, not worst-case) candidate → nearest-seed pairs for eyeballing.

const GATES = [0.6, 0.65, 0.7, 0.75];
interface PrefixRow {
  floor: number; librarySize: number;
  gateCoverage: Record<string, string>;
  typicalPairs: string[];
}
const rng = (() => { let s = 42; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
const prefixRows: PrefixRow[] = [];
for (const f of FLOORS) {
  const n = coveringNumbers.get(f);
  if (n === undefined) continue;
  const lib = seeds.slice(0, n);
  const libVecs = lib.map((s) => vec(s.term));
  const libSet = new Set(lib.map((s) => s.term));
  const outside = poolTerms.filter((t) => !libSet.has(t));
  const nearest = outside.map((t) => {
    const tv = vec(t);
    let bs = -1; let bt = '';
    libVecs.forEach((lv, i) => { const s = sim(tv, lv); if (s > bs) { bs = s; bt = lib[i].term; } });
    return { t, bt, bs };
  });
  const gateCoverage: Record<string, string> = {};
  for (const g of GATES) {
    const within = nearest.filter((r) => r.bs >= g).length;
    gateCoverage[g.toFixed(2)] = `${((100 * within) / nearest.length).toFixed(0)}%`;
  }
  const shuffled = [...nearest].sort(() => rng() - 0.5).slice(0, 12);
  prefixRows.push({
    floor: f, librarySize: n, gateCoverage,
    typicalPairs: shuffled.map((r) => `${r.t} → ${r.bt} (${r.bs.toFixed(3)})`),
  });
}

// ---- holdout coverage (queries the pool was NOT sampled from) ----

const holdoutRows = holdout.map((q) => {
  const qv = vec(q);
  let bt = ''; let bs = -1;
  for (const sd of seeds) { const s = sim(qv, vec(sd.term)); if (s > bs) { bs = s; bt = sd.term; } }
  // and vs the smallest prefix library, for the realistic small-library picture
  const n0 = coveringNumbers.get(FLOORS[1]) ?? seeds.length; // 0.60-floor library
  let pt = ''; let ps = -1;
  for (const sd of seeds.slice(0, n0)) { const s = sim(qv, vec(sd.term)); if (s > ps) { ps = s; pt = sd.term; } }
  return { query: q, nearestSeed: bt, sim: bs, prefixSeed: pt, prefixSim: ps };
});

// ---- outputs ----

writeFileSync(DIR + `seed-list${SUFFIX}.json`, JSON.stringify({ model: MODEL, tier1Count: tier1.length, seeds }, null, 1));

const lines: string[] = [];
lines.push('# Covering-number report — pre-seed library');
lines.push('');
lines.push(`Pool: ${poolTerms.length} filtered candidates. Tier 1: ${tier1.length} seeds placed first.`);
lines.push(`Embedding: ${MODEL}, cosine similarity.`);
lines.push('');
lines.push('| similarity floor | seeds needed (incl. Tier 1) | FPS additions beyond Tier 1 |');
lines.push('|---|---|---|');
for (const f of FLOORS) {
  const n = coveringNumbers.get(f);
  lines.push(`| ${f.toFixed(2)} | ${n ?? '> ' + seeds.length} | ${n !== undefined ? n - tier1.length : '—'} |`);
}
lines.push('');
for (const f of FLOORS) {
  const ex = floorExamples.get(f);
  if (!ex) continue;
  lines.push(`## Floor ${f.toFixed(2)} — worst-covered survivors (candidate → nearest seed)`);
  lines.push('');
  for (const e of ex) lines.push(`- ${e}`);
  lines.push('');
}
lines.push('## Library size vs display gate');
lines.push('');
lines.push('For each floor\'s prefix library: % of remaining pool candidates whose nearest');
lines.push('seed clears each display gate.');
lines.push('');
lines.push(`| library (floor) | size | ${GATES.map((g) => 'gate ' + g.toFixed(2)).join(' | ')} |`);
lines.push(`|---|---|${GATES.map(() => '---').join('|')}|`);
for (const r of prefixRows) {
  lines.push(`| ${r.floor.toFixed(2)} | ${r.librarySize} | ${GATES.map((g) => r.gateCoverage[g.toFixed(2)]).join(' | ')} |`);
}
lines.push('');
for (const r of prefixRows) {
  lines.push(`### Typical pairs, ${r.librarySize}-seed library (floor ${r.floor.toFixed(2)}) — random sample, not worst-case`);
  lines.push('');
  for (const p of r.typicalPairs) lines.push(`- ${p}`);
  lines.push('');
}
lines.push('## Holdout queries (not drawn from the pool)');
lines.push('');
const n0 = coveringNumbers.get(FLOORS[1]) ?? seeds.length;
lines.push(`| query | nearest seed (all ${seeds.length}) | sim | nearest seed (${n0}-lib) | sim |`);
lines.push('|---|---|---|---|---|');
for (const r of holdoutRows.sort((a, b) => a.sim - b.sim)) {
  lines.push(`| ${r.query} | ${r.nearestSeed} | ${r.sim.toFixed(3)} | ${r.prefixSeed} | ${r.prefixSim.toFixed(3)} |`);
}
lines.push('');
for (const f of FLOORS) {
  const within = holdoutRows.filter((r) => r.sim >= f).length;
  lines.push(`- floor ${f.toFixed(2)}: ${within}/${holdoutRows.length} holdout queries within floor (of the final ${seeds.length}-seed list)`);
}
lines.push('');
writeFileSync(DIR + `covering-report${SUFFIX}.md`, lines.join('\n'));

console.log(`\npool ${poolTerms.length}, seeds ${seeds.length} (tier1 ${tier1.length})`);
for (const f of FLOORS) console.log(`floor ${f}: covering number ${coveringNumbers.get(f) ?? 'not reached'}`);
console.log(`report: data/seed-pool/covering-report${SUFFIX}.md`);
