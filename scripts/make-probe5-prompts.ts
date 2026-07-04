// Generate the probe5 packet: full-resolution (16×16) worked exemplars taken
// from Fable's own validated probe2 outputs (runs/probe2-16char-fable/*.json
// meta.masks), asked of NEIGHBORING nouns in the same body plan — the direct
// test of the library-as-exemplar loop: a validated cached object becomes the
// worked example for a nearby uncached noun, and a cheap model adapts it.
//
// Targets: penguin + duck (bird exemplar), shark (fish exemplar).
//
// Usage: npx tsx scripts/make-probe5-prompts.ts

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt } from './probe-prompt.ts';
import type { Exemplar } from './exemplars.ts';
import type { BenchResult } from '../src/bench/types.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;

function exemplarFromRun(runId: string, slug: string, label: string, bodyPlan: string): Exemplar {
  const result = JSON.parse(readFileSync(join(RUNS, runId, `${slug}.json`), 'utf8')) as BenchResult;
  const masks = result.meta?.masks;
  if (!masks) throw new Error(`${runId}/${slug} has no meta.masks`);
  const xs = result.voxels.map((v) => v[0]);
  const ys = result.voxels.map((v) => v[1]);
  const zs = result.voxels.map((v) => v[2]);
  const bounds = `bounds x:${Math.min(...xs)}-${Math.max(...xs)} y:${Math.min(...ys)}-${Math.max(...ys)} z:${Math.min(...zs)}-${Math.max(...zs)}`;
  return { label, bodyPlan, bounds, front: masks.front, side: masks.side, top: masks.top };
}

const BIRD = exemplarFromRun('probe2-16char-fable', 'bird', 'bird', 'bird');
const FISH = exemplarFromRun('probe2-16char-fable', 'fish', 'fish', 'fish');

const TARGETS: { noun: string; exemplar: Exemplar }[] = [
  { noun: 'penguin', exemplar: BIRD },
  { noun: 'duck', exemplar: BIRD },
  { noun: 'shark', exemplar: FISH },
];

const runId = 'probe5-16char-sonnet';
const dir = join(RUNS, runId);
mkdirSync(join(dir, 'prompts'), { recursive: true });
mkdirSync(join(dir, 'responses'), { recursive: true });
mkdirSync(join(dir, 'responses-call1'), { recursive: true });
mkdirSync(join(dir, 'feedback'), { recursive: true });

let files = 0;
for (const t of TARGETS) {
  writeFileSync(join(dir, 'prompts', `${t.noun}.md`), buildPrompt(t.noun, SIZE, t.exemplar));
  files += 1;
}
writeFileSync(
  join(dir, 'run.json'),
  JSON.stringify(
    {
      id: runId,
      label: 'probe5 16³ char sonnet · full-res exemplar + retry',
      date: new Date().toISOString().slice(0, 10),
      pipeline:
        'probe: full-resolution 16×16 worked exemplars from validated Fable outputs (library-as-exemplar), neighboring nouns in the same body plan, single-shot + deterministic retry (retry-feedback.ts) + optional shape retry, strict lift',
      conditions: {
        grid: String(SIZE),
        encoding: 'char',
        model: 'claude-sonnet-5',
        prompt: 'hardened-v2-fullres-exemplar',
        exemplar: 'penguin/duck→fable-bird, shark→fable-fish',
        method: '2-call: single-shot + deterministic retry (+1 shape retry if blind-name misses)',
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(`wrote ${files} prompts to ${runId}`);
