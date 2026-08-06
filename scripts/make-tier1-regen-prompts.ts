// Generate the tier1-regen1 packet: prompt v2 amended per the approved
// regen round (2026-08-05) over the 13 sets flagged by the tier1-blindpanel
// hindsight pass, in two identical arms (-a / -b) so each term gets two
// independently sampled challengers. Challenger-vs-incumbent ranking happens
// downstream via a blind 2-voter free-naming panel; ties keep the incumbent.
//
// Amendments over the tier1 prompt (each maps to a hypothesis in
// runs/tier1-blindpanel/RESULTS.md):
//   - H-CARICATURE / H-POSE / H-DEPTH: three pre-authoring declaration lines
//     (feature / pose / depth plan) required above the bounds line.
//   - H-WHEELS: a vehicle clause (wheels as proud masses) for vehicle terms.
//   - The top-view row convention stated numerically (the b4/b5 brief
//     addition that eliminated the mis-anchoring class; now in the prompt).
//
// Usage: npx tsx scripts/make-tier1-regen-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildAuthoringPrompt } from './lib/authoring-prompt.ts';

const RUNS = join(import.meta.dirname, '..', 'runs');
const SIZE = 16;
const DEPTH_CAP = 6;

// The 13 flagged sets from runs/tier1-blindpanel/RESULTS.md, with the batch
// dir holding each incumbent.
export const REGEN_TERMS: Record<string, string> = {
  banana: 'b4',
  bee: 'b3',
  camera: 'b5',
  'coffee-cup': 'b1',
  crown: 'b5',
  dog: 'b1',
  dolphin: 'b3',
  hamburger: 'b4',
  monkey: 'b3',
  motorcycle: 'b2',
  pizza: 'b4',
  shark: 'b3',
  'teddy-bear': 'b5',
};

const VEHICLES = new Set(['motorcycle']);

function buildPrompt(noun: string, isVehicle: boolean): string {
  return buildAuthoringPrompt(noun, { size: SIZE, depthCap: DEPTH_CAP, isVehicle });
}

for (const arm of ['a', 'b'] as const) {
  const runId = `tier1-regen1-16char-${arm}`;
  const runDir = join(RUNS, runId);
  mkdirSync(join(runDir, 'prompts'), { recursive: true });
  mkdirSync(join(runDir, 'responses-call1'), { recursive: true });
  mkdirSync(join(runDir, 'responses'), { recursive: true });
  for (const term of Object.keys(REGEN_TERMS)) {
    const noun = term.replace(/-/g, ' ');
    writeFileSync(join(runDir, 'prompts', `${term}.md`), buildPrompt(noun, VEHICLES.has(term)));
  }
  const manifest = {
    id: runId,
    label: `tier1 regen1 challengers arm ${arm.toUpperCase()} · blindpanel-flagged terms`,
    date: '2026-08-05',
    pipeline:
      'Approved Tier-1 regen round: prompt v2 amended with pre-authoring declarations (feature / pose / depth plan), a numeric top-view row convention, and a wheels-as-proud-masses vehicle clause, over the 13 sets flagged by the tier1-blindpanel hindsight pass. Two identical arms give each term two independent challengers; a blind 2-voter free-naming panel ranks challenger vs incumbent with a structure guard, ties keep incumbent. Subscription subagents, $0 API.',
    conditions: {
      grid: String(SIZE),
      encoding: 'char',
      model: 'claude-sonnet-5',
      prompt: 'full-authorship v2 + regen1 amendments (H-DEPTH/H-CARICATURE/H-POSE/H-WHEELS)',
      source: 'none — noun only',
      method:
        'single-shot + 1 deterministic-feedback retry (retry-feedback.ts --max-depth=6) with convert-response self-check incl. median-column-depth advisory; run via subscription subagents ($0, adaptive thinking)',
    },
  };
  writeFileSync(join(runDir, 'run.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`wrote ${Object.keys(REGEN_TERMS).length} prompts + run.json → runs/${runId}/`);
}
