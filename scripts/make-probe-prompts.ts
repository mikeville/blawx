// Generate the model-tier probe packet: hardened prompts (solid-fill rule,
// declared bounds line, explicit per-axis consistency rules, worked
// quadruped example) at 16³ char encoding, one run dir per model tier.
// Responses are gathered the same way as sweep1 (subscription sessions —
// no API calls anywhere in this flow), saved verbatim to
// runs/<run-id>/responses/<noun>.txt, then converted + relifted.
//
// Usage: npx tsx scripts/make-probe-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt } from './probe-prompt.ts';
import { DOG } from './exemplars.ts';

const PROBE = 'probe1';
const SIZE = 16;

const NOUNS = ['mug', 'chair', 'fox', 'bird', 'fish', 'rocket ship'];

const TIERS = [
  { slug: 'haiku', model: 'claude-haiku-4-5' },
  { slug: 'sonnet', model: 'claude-sonnet-5' },
  { slug: 'fable', model: 'claude-fable-5' },
];

let files = 0;
for (const tier of TIERS) {
  const runId = `${PROBE}-16char-${tier.slug}`;
  const dir = join(import.meta.dirname, '..', 'runs', runId);
  mkdirSync(join(dir, 'prompts'), { recursive: true });
  mkdirSync(join(dir, 'responses'), { recursive: true });
  for (const noun of NOUNS) {
    writeFileSync(join(dir, 'prompts', `${noun.replace(/\s+/g, '-')}.md`), buildPrompt(noun, SIZE, DOG));
    files += 1;
  }
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify(
      {
        id: runId,
        label: `${PROBE} 16³ char ${tier.slug}`,
        date: new Date().toISOString().slice(0, 10),
        pipeline: 'probe: hardened prompt (solid fill + bounds + per-axis consistency + worked example), three-view mask emission + strict hull lift',
        conditions: {
          grid: String(SIZE),
          encoding: 'char',
          model: tier.model,
          prompt: 'hardened-v2',
        },
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(`wrote ${files} prompts across ${TIERS.length} probe runs`);
