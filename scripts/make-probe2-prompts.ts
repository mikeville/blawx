// Generate the probe2 packet: hardened prompts (same as probe1) but with a
// body-plan-matched worked exemplar instead of the fixed dog example — a
// bird noun gets the sparrow exemplar, a fish noun gets the carp exemplar —
// at 16³ char encoding, one run dir per model tier. Responses are gathered
// the same way as probe1 (subscription sessions — no API calls anywhere in
// this flow), saved verbatim to runs/<run-id>/responses/<noun>.txt, then
// converted + relifted.
//
// Usage: npx tsx scripts/make-probe2-prompts.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPrompt } from './probe-prompt.ts';
import { SPARROW, CARP, type Exemplar } from './exemplars.ts';

const PROBE = 'probe2';
const SIZE = 16;

const NOUNS: { noun: string; exemplar: Exemplar }[] = [
  { noun: 'bird', exemplar: SPARROW },
  { noun: 'fish', exemplar: CARP },
];

const TIERS = [
  { slug: 'sonnet', model: 'claude-sonnet-5' },
  { slug: 'fable', model: 'claude-fable-5' },
];

let files = 0;
for (const tier of TIERS) {
  const runId = `${PROBE}-16char-${tier.slug}`;
  const dir = join(import.meta.dirname, '..', 'runs', runId);
  mkdirSync(join(dir, 'prompts'), { recursive: true });
  mkdirSync(join(dir, 'responses'), { recursive: true });
  for (const { noun, exemplar } of NOUNS) {
    writeFileSync(
      join(dir, 'prompts', `${noun.replace(/\s+/g, '-')}.md`),
      buildPrompt(noun, SIZE, exemplar),
    );
    files += 1;
  }
  writeFileSync(
    join(dir, 'run.json'),
    JSON.stringify(
      {
        id: runId,
        label: `${PROBE} 16³ char ${tier.slug} (plan-matched exemplar)`,
        date: new Date().toISOString().slice(0, 10),
        pipeline: 'probe: hardened prompt + body-plan-matched worked exemplar, three-view mask emission + strict hull lift',
        conditions: {
          grid: String(SIZE),
          encoding: 'char',
          model: tier.model,
          prompt: 'hardened-v2-planmatched',
          exemplar: 'bird→sparrow, fish→carp',
        },
      },
      null,
      2,
    ) + '\n',
  );
}
console.log(`wrote ${files} prompts across ${TIERS.length} probe runs`);
