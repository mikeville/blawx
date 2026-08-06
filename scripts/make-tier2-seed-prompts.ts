// Generate a Tier-2 seed packet: the FPS tail of data/seed-pool/seed-list.json,
// authored with the amended prompt v2 (scripts/lib/authoring-prompt.ts).
//
// Tier 1 is the first 79 entries of the seed list (the head, placed before
// farthest-point sampling starts). Everything after it is FPS-ordered, and
// because FPS is greedy its prefix is invariant to where the library
// eventually stops — so batch N's terms are fixed regardless of the operating
// point open call 2 picks. Batches are declared here rather than passed on the
// command line so a run dir always reproduces from the repo alone.
//
// Usage: npx tsx scripts/make-tier2-seed-prompts.ts [b1]

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAuthoringPrompt } from './lib/authoring-prompt.ts';

const ROOT = join(import.meta.dirname, '..');
const RUNS = join(ROOT, 'runs');
const SIZE = 16;
const DEPTH_CAP = 6;

/** Slice of the FPS tail each batch covers (indices into seed-list.json). */
const BATCHES: Record<string, { from: number; count: number; date: string }> = {
  b1: { from: 79, count: 25, date: '2026-08-05' },
};

/** Terms whose wheels must read as proud masses, not notches (H-WHEELS). */
const WHEELED = new Set(['rollerskates']);

const batchId = process.argv[2] ?? 'b1';
const batch = BATCHES[batchId];
if (!batch) {
  console.error(`unknown batch ${batchId}; known: ${Object.keys(BATCHES).join(', ')}`);
  process.exit(1);
}

const seedList = JSON.parse(
  readFileSync(join(ROOT, 'data', 'seed-pool', 'seed-list.json'), 'utf8'),
) as { model: string; tier1Count: number; seeds: { term: string; radiusBefore: number | null }[] };

if (batch.from < seedList.tier1Count) {
  console.error(`batch ${batchId} starts inside Tier 1 (first ${seedList.tier1Count} entries)`);
  process.exit(1);
}

const slice = seedList.seeds.slice(batch.from, batch.from + batch.count);
const runId = `tier2-16char-${batchId}`;
const runDir = join(RUNS, runId);
mkdirSync(join(runDir, 'prompts'), { recursive: true });
mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
mkdirSync(join(runDir, 'responses'), { recursive: true });

for (const { term } of slice) {
  const slug = term.replace(/\s+/g, '-');
  writeFileSync(
    join(runDir, 'prompts', `${slug}.md`),
    buildAuthoringPrompt(term, { size: SIZE, depthCap: DEPTH_CAP, isVehicle: WHEELED.has(term) }),
  );
}

const first = slice[0];
const last = slice[slice.length - 1];
const manifest = {
  id: runId,
  label: `tier2 seed ${batchId.toUpperCase()} · FPS tail ${batch.from}–${batch.from + batch.count - 1}`,
  date: batch.date,
  pipeline:
    `Pre-seed Tier-2 library: the first FPS-tail slice past Tier 1 (seed-list.json ` +
    `entries ${batch.from}–${batch.from + batch.count - 1}, "${first.term}" through "${last.term}", ` +
    `covering radius ${first.radiusBefore?.toFixed(3)}→${last.radiusBefore?.toFixed(3)}). ` +
    `Amended prompt v2 (pre-authoring feature/pose/depth-plan declarations, numeric top-view row ` +
    `convention, wheels-as-proud-masses clause) via scripts/lib/authoring-prompt.ts. One subscription ` +
    `subagent per term, single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6) ` +
    `with the convert-response self-check incl. median-column-depth advisory. $0 API.`,
  conditions: {
    grid: String(SIZE),
    encoding: 'char',
    model: 'claude-sonnet-5',
    prompt: 'full-authorship v2 + regen1 amendments (shared authoring-prompt.ts)',
    source: 'none — noun only',
    method:
      'single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6) with convert-response self-check incl. median-column-depth advisory; run via subscription subagents ($0, adaptive thinking)',
  },
};
writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${slice.length} prompts + run.json → runs/${runId}/`);
console.log(slice.map((s) => s.term).join(', '));
