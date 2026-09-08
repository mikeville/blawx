import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const RATE_SOURCE = 'scripts/run-api-pilot.mjs (checked 2026-09-07)';
const RATES = Object.freeze({
  'gpt-6-astra': Object.freeze({ uncached: 20, cached: 2, cacheWrite: 25, output: 100 }),
  'gpt-5.6-sol': Object.freeze({ uncached: 8, cached: 0.8, cacheWrite: 10, output: 40 }),
});

function hypotheticalBasis(rates) {
  return `Historical September 2026 configured rates applied to observed CLI token envelope: $${rates.uncached}/M uncached input, $${rates.cached}/M cached input, $${rates.cacheWrite}/M cache-write input, and $${rates.output}/M output; hypothetical, not invoice or public-app forecast; requested tier/model may differ. Rate provenance: ${RATE_SOURCE}.`;
}

function standardizedBasis(rates) {
  return `Illustrative standardized scenarios using historical September 2026 configured rates: $${rates.uncached}/M uncached input, $${rates.cached}/M cached input, $${rates.cacheWrite}/M cache-write input, and $${rates.output}/M output. Uncached assumes 1,500 uncached input tokens; mostly cached assumes 100 uncached plus 1,400 cached input tokens. Neither represents a real cold/warm lifecycle. Both assume zero cache writes (so no cache-write charges) and hold this run's observed output_tokens fixed (which already includes reasoning). These are scenario calculations, not measured deployment costs; the 1,500-token assumption is illustrative rather than a tokenizer measurement. Equal input/cache assumptions do not claim runtime or model output would remain unchanged outside the CLI. Rate provenance: ${RATE_SOURCE}.`;
}

function recordedApiBasis(record, correction) {
  const corrected = correction?.runId === record.runId;
  const details = corrected && correction.usdPerMillion
    ? `Correction rates: $${correction.usdPerMillion.ordinaryInput}/M ordinary input, $${correction.usdPerMillion.cachedInput}/M cached input, $${correction.usdPerMillion.cacheWrite}/M cache-write input, and $${correction.usdPerMillion.output}/M output.`
    : record.cost?.basis;
  const limitations = corrected ? correction.limitations : record.cost?.limitations;
  return ['Recorded API estimate.', details, limitations, `Rate provenance: ${RATE_SOURCE}.`]
    .filter(Boolean).join(' ');
}

function finiteNonnegative(value) {
  return Number.isFinite(value) && value >= 0;
}

export function estimateCliApiEquivalent(usage, model, serviceTier) {
  const rates = RATES[model];
  if (!rates || !['fast', 'priority'].includes(serviceTier)) return null;
  const input = usage?.input_tokens;
  const cached = usage?.cached_input_tokens;
  const cacheWrite = usage?.cache_write_input_tokens;
  const output = usage?.output_tokens;
  if (![input, cached, cacheWrite, output].every(finiteNonnegative)) return null;
  if (cached + cacheWrite > input) return null;
  const uncached = input - cached - cacheWrite;
  // CLI output_tokens already includes reasoning_output_tokens. Do not add it again.
  return (uncached * rates.uncached + cached * rates.cached
    + cacheWrite * rates.cacheWrite + output * rates.output) / 1_000_000;
}

export function standardizedCosts(usage, model, serviceTier) {
  const rates = RATES[model];
  const output = usage?.output_tokens;
  if (!rates || !['fast', 'priority'].includes(serviceTier) || !finiteNonnegative(output)) {
    return { coldUsd: null, warmUsd: null, basis: null };
  }
  return {
    coldUsd: (1_500 * rates.uncached + output * rates.output) / 1_000_000,
    warmUsd: (100 * rates.uncached + 1_400 * rates.cached + output * rates.output) / 1_000_000,
    basis: standardizedBasis(rates),
  };
}

function subjectFromPrompt(prompt) {
  if (typeof prompt !== 'string') return null;
  return prompt.match(/^USER PROMPT:\s*(.+?)\s*$/mi)?.[1] ?? null;
}

function subjectFromLabel(label) {
  return typeof label === 'string' ? label.split(' · ')[0] : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function readOptionalJson(path) {
  try {
    return await readJson(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function directRow(entry, shape, record, feedback, correction) {
  const subscription = record.runtime === 'codex-cli-subscription';
  const api = record.runtime === 'openai-responses-api';
  const correctedCost = correction?.runId === record.runId ? correction.amountUsd : record.cost?.amountUsd;
  let apiEquivalentUsd = null;
  let estimateBasis = 'No supported historical estimate is available for this model/tier or token record.';
  if (subscription) {
    apiEquivalentUsd = estimateCliApiEquivalent(
      record.usage, record.requestedModel, record.requestedServiceTier,
    );
    if (apiEquivalentUsd !== null) estimateBasis = hypotheticalBasis(RATES[record.requestedModel]);
  } else if (api && finiteNonnegative(correctedCost)) {
    apiEquivalentUsd = correctedCost;
    estimateBasis = recordedApiBasis(record, correction);
  }
  const standardized = standardizedCosts(
    record.usage, record.requestedModel, record.requestedServiceTier,
  );
  return {
    shape,
    id: entry.id,
    subject: subjectFromPrompt(record.prompt) ?? subjectFromLabel(entry.label),
    model: record.requestedModel ?? record.actualModel ?? null,
    reasoning: record.reasoningEffort ?? null,
    generationMs: finiteNonnegative(record.generationMs) ? record.generationMs : null,
    timingScope: record.timingScope ?? null,
    billingLabel: subscription
      ? 'Subscription · no separate API charge'
      : api ? 'API · recorded estimate' : 'Billing unknown',
    recordedCostUsd: subscription ? 0 : finiteNonnegative(correctedCost) ? correctedCost : null,
    apiEquivalentUsd,
    estimateBasis,
    standardizedColdUsd: standardized.coldUsd,
    standardizedWarmUsd: standardized.warmUsd,
    standardizedBasis: standardized.basis,
    feedback: feedback[String(shape)] ?? null,
    url: entry.url,
  };
}

function stagedRow(entry, shape, artifact, feedback) {
  const meta = artifact?.meta ?? {};
  return {
    shape,
    id: entry.id,
    subject: subjectFromPrompt(meta.prompt) ?? subjectFromLabel(entry.label),
    model: null,
    reasoning: null,
    generationMs: finiteNonnegative(meta.generationMs) ? meta.generationMs : null,
    timingScope: meta.timingScope ?? null,
    billingLabel: 'Staged pipeline · cost unknown',
    recordedCostUsd: null,
    apiEquivalentUsd: null,
    estimateBasis: 'No comparable recorded cost or token envelope for the staged pipeline.',
    standardizedColdUsd: null,
    standardizedWarmUsd: null,
    standardizedBasis: null,
    feedback: feedback[String(shape)] ?? null,
    url: entry.url,
  };
}

export async function buildComparison(rootDir) {
  if (!rootDir) throw new Error('Explicit source root is required for comparison export.');
  const publicDir = join(rootDir, 'public');
  const index = await readJson(join(publicDir, 'experiments', 'index.json'));
  const feedback = await readOptionalJson(join(publicDir, 'experiments', 'feedback.json')) ?? {};
  const correction = await readOptionalJson(join(rootDir, 'experiments', 'shape32-cost-correction.json'));
  const rows = [];
  for (const [offset, entry] of index.entries()) {
    const shape = offset + 1;
    const record = await readOptionalJson(join(rootDir, 'experiments', 'runs', entry.id, 'record.json'));
    if (record) rows.push(directRow(entry, shape, record, feedback, correction));
    else {
      const artifact = await readJson(join(publicDir, entry.url.replace(/^\//, '')));
      rows.push(stagedRow(entry, shape, artifact, feedback));
    }
  }
  return rows;
}

export async function publishComparison(rootDir, { outputPath } = {}) {
  if (!rootDir) throw new Error('Explicit source root is required for comparison export.');
  if (!outputPath) throw new Error('Explicit outputPath is required for deliberate schema-allowlisted export.');
  const rows = await buildComparison(rootDir);
  await writeFile(
    outputPath,
    `${JSON.stringify(rows, null, 2)}\n`,
  );
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--input-root');
  const outputIndex = args.indexOf('--output');
  if (rootIndex === -1 || outputIndex === -1) throw new Error('Usage: node scripts/publish-comparison.mjs --input-root DIR --output FILE');
  const rows = await publishComparison(resolve(args[rootIndex + 1]), { outputPath: resolve(args[outputIndex + 1]) });
  console.log(`Exported ${rows.length} allowlisted comparison rows.`);
}
