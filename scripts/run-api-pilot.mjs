import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandVoxelProgram, validateVoxels } from '../src/voxels.js';
import { expandLoftProgram } from '../src/loft-program.js';
import { expandRelativeTuples } from '../src/relative-tuples.js';
import { readResponseSse } from './response-sse.mjs';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const API_URL = 'https://api.openai.com/v1/responses';
const MODEL = 'gpt-6-astra';
const SERVICE_TIER = 'priority';
const TIMEOUT_MS = 180_000;
const MAX_PROMPT_BYTES = 8_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const PROMPT_RELATIVE_PATH = join('tests', 'fixtures', 'prompts', 'legacy', 'city-program.txt');

const LEGACY_PROFILE = Object.freeze({
  id: null,
  model: MODEL,
  reasoningEffort: 'medium',
  serviceTier: SERVICE_TIER,
  maxOutputTokens: 6_000,
  promptRelativePath: PROMPT_RELATIVE_PATH,
  plannedCostCeilingUsd: 1,
  method: 'voxel-program',
  expand: expandVoxelProgram,
  rates: Object.freeze({ uncachedInput: 20, cachedInput: 2, cacheWriteInput: 25, output: 100 }),
  costBasis: 'Simple usage estimate at priority rates: $20/M uncached input, $2/M cached input, $25/M cache-write input, and $100/M output.',
});

const SOL_CAT_PROFILE = Object.freeze({
  id: 'sol-cat',
  model: 'gpt-5.6-sol',
  reasoningEffort: 'low',
  serviceTier: 'fast',
  maxOutputTokens: 2_000,
  promptRelativePath: join('tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft.txt'),
  plannedCostCeilingUsd: 0.25,
  method: 'voxel-loft',
  expand: expandLoftProgram,
  rates: Object.freeze({ uncachedInput: 8, cachedInput: 0.8, cacheWriteInput: 10, output: 40 }),
  costBasis: 'Simple usage estimate at Fast rates: $8/M uncached input, $0.80/M cached input, $10/M cache-write input, and $40/M output.',
});

const SOL_CAT_STREAM_PROFILE = Object.freeze({
  ...SOL_CAT_PROFILE,
  id: 'sol-cat-stream',
  stream: true,
});

const SOL_CAT_FOCUSED_PROFILE = Object.freeze({
  ...SOL_CAT_STREAM_PROFILE,
  id: 'sol-cat-focused',
  promptRelativePath: join('tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft-focused-planning.txt'),
});

const SOL_CAT_RELATIVE_PROFILE = Object.freeze({
  ...SOL_CAT_STREAM_PROFILE,
  id: 'sol-cat-relative',
  promptRelativePath: join('tests', 'fixtures', 'prompts', 'legacy', 'cat-small-relative.txt'),
  method: 'voxel-relative-tuples',
  expand: expandRelativeTuples,
});

const ASTRA_REEF_STREAM_PROFILE = Object.freeze({
  id: 'astra-reef-stream',
  model: 'gpt-6-astra',
  reasoningEffort: 'low',
  serviceTier: 'priority',
  maxOutputTokens: 3_000,
  promptRelativePath: join('server', 'prompts', 'voxel-loft.txt'),
  plannedCostCeilingUsd: 0.50,
  method: 'voxel-loft',
  expand: expandLoftProgram,
  stream: true,
  rates: LEGACY_PROFILE.rates,
  costBasis: LEGACY_PROFILE.costBasis,
  comparisonNote: 'The Fast CLI run maps to requested Priority API for this bounded comparison; this does not claim the runtimes or service tiers are actually equal.',
});

const ASTRA_CROSS_SUBJECTS = Object.freeze(['cat', 'pickup', 'dragon', 'person', 'nostalgia']);
const ASTRA_CROSS_SUBJECT_PROFILES = new Map(ASTRA_CROSS_SUBJECTS.map((subject) => {
  const id = `astra-${subject}-stream`;
  return [id, Object.freeze({
    ...ASTRA_REEF_STREAM_PROFILE,
    id,
    promptRelativePath: join('tests', 'fixtures', 'prompts', 'api-cross-subject', `${subject}.txt`),
  })];
}));

function resolveProfile(profile) {
  if (profile == null) return LEGACY_PROFILE;
  if (profile === 'sol-cat') return SOL_CAT_PROFILE;
  if (profile === 'sol-cat-stream') return SOL_CAT_STREAM_PROFILE;
  if (profile === 'sol-cat-focused') return SOL_CAT_FOCUSED_PROFILE;
  if (profile === 'sol-cat-relative') return SOL_CAT_RELATIVE_PROFILE;
  if (profile === 'astra-reef-stream') return ASTRA_REEF_STREAM_PROFILE;
  if (ASTRA_CROSS_SUBJECT_PROFILES.has(profile)) return ASTRA_CROSS_SUBJECT_PROFILES.get(profile);
  throw new Error(`Unknown profile: ${String(profile)}`);
}

function planFor(profile) {
  return Object.freeze({
    requests: 1, retries: 0, model: profile.model, reasoningEffort: profile.reasoningEffort,
    serviceTier: profile.serviceTier, maxOutputTokens: profile.maxOutputTokens,
    timeoutMs: TIMEOUT_MS, maxPromptBytes: MAX_PROMPT_BYTES, maxResponseBytes: MAX_RESPONSE_BYTES,
    plannedCostCeilingUsd: profile.plannedCostCeilingUsd,
    costNote: 'Conservative planning estimate, not a provider billing cap. Actual cost depends on token usage and billing details.',
    ...(profile.id ? { profile: profile.id, promptPath: profile.promptRelativePath } : {}),
    ...(profile.stream ? { stream: true } : {}),
    ...(profile.comparisonNote ? { comparisonNote: profile.comparisonNote } : {}),
  });
}

export const API_PILOT_PLAN = planFor(LEGACY_PROFILE);
export const SOL_CAT_API_PILOT_PLAN = planFor(SOL_CAT_PROFILE);
export const SOL_CAT_STREAM_API_PILOT_PLAN = planFor(SOL_CAT_STREAM_PROFILE);
export const SOL_CAT_FOCUSED_API_PILOT_PLAN = planFor(SOL_CAT_FOCUSED_PROFILE);
export const SOL_CAT_RELATIVE_API_PILOT_PLAN = planFor(SOL_CAT_RELATIVE_PROFILE);
export const ASTRA_REEF_STREAM_API_PILOT_PLAN = planFor(ASTRA_REEF_STREAM_PROFILE);
export const ASTRA_CROSS_SUBJECT_API_PILOT_PLANS = Object.freeze(Object.fromEntries(
  [...ASTRA_CROSS_SUBJECT_PROFILES].map(([id, profile]) => [id, planFor(profile)]),
));

export function buildRequestBody(prompt, profileName = null) {
  const profile = resolveProfile(profileName);
  return {
    model: profile.model,
    reasoning: { effort: profile.reasoningEffort },
    input: prompt,
    service_tier: profile.serviceTier,
    max_output_tokens: profile.maxOutputTokens,
    store: false,
    tools: [],
    stream: profile.stream === true,
  };
}

export function validatePrompt(prompt) {
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error(`Prompt exceeds ${MAX_PROMPT_BYTES} UTF-8 bytes.`);
  const matches = [...prompt.matchAll(/^USER PROMPT:\s*(.+?)\s*$/gmi)];
  if (matches.length !== 1) throw new Error('Prompt file must contain exactly one USER PROMPT: line.');
  return matches[0][1];
}

function redact(value, key) {
  if (!key || typeof value !== 'string') return value;
  return value.split(key).join('[REDACTED]');
}

function safeError(error, key) {
  return redact(String(error?.stack ?? error?.message ?? error), key).slice(0, 2_000);
}

async function readResponseText(response, maxBytes = MAX_RESPONSE_BYTES) {
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) throw new Error(`Response body exceeds ${maxBytes} bytes.`);
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`Response body exceeds ${maxBytes} bytes.`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    error.partialResponse = text;
    throw error;
  }
}

export function extractProgramText(response) {
  if (!response || response.status !== 'completed') throw new Error('Response status must be completed.');
  if (!Array.isArray(response.output) || response.output.length === 0) throw new Error('Response output must be a nonempty array.');
  const texts = [];
  for (const item of response.output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type !== 'message' || item.role !== 'assistant') throw new Error(`Unexpected response output item: ${String(item?.type)}.`);
    if (item.status && item.status !== 'completed') throw new Error('Assistant message is incomplete.');
    if (!Array.isArray(item.content) || item.content.length === 0) throw new Error('Assistant message has no content.');
    for (const content of item.content) {
      if (content?.type === 'refusal') throw new Error('Response contained a refusal.');
      if (content?.type !== 'output_text' || typeof content.text !== 'string') {
        throw new Error(`Unexpected assistant content: ${String(content?.type)}.`);
      }
      texts.push(content.text);
    }
  }
  if (texts.length === 0) throw new Error('Response contained no assistant output_text.');
  return texts.join('');
}

export function estimateCost(usage, profileName = null) {
  const profile = resolveProfile(profileName);
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? usage?.cached_input_tokens ?? 0;
  const cacheWrites = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  const counts = [input, output, cached, cacheWrites];
  if (!usage || counts.some((count) => !Number.isFinite(count) || count < 0)
      || cached + cacheWrites > input) {
    return { amountUsd: null, estimate: true, basis: 'Usage unavailable; cost cannot be estimated.' };
  }
  const uncached = input - cached - cacheWrites;
  const amountUsd = (uncached * profile.rates.uncachedInput
    + cached * profile.rates.cachedInput
    + cacheWrites * profile.rates.cacheWriteInput
    + output * profile.rates.output) / 1_000_000;
  return {
    amountUsd,
    estimate: true,
    basis: profile.costBasis,
    limitations: 'Estimate is not a bill or hard cap and may omit other provider billing details.',
  };
}

async function writeJson(path, value, options) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, options);
}

export async function runApiPilot({
  rootDir = ROOT,
  dataRoot,
  allowTestDataRoot = false,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.OPENAI_API_KEY,
  now = () => new Date(),
  uuid = randomUUID,
  timeoutMs = TIMEOUT_MS,
  profile: profileName = null,
} = {}) {
  const profile = resolveProfile(profileName);
  if (!apiKey) throw new Error('OPENAI_API_KEY is required; no request or attempt was created.');
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');

  const promptPath = join(rootDir, profile.promptRelativePath);
  const prompt = await readFile(promptPath, 'utf8');
  const userPrompt = validatePrompt(prompt);
  const startedAt = now();
  const runToken = uuid();
  if (typeof runToken !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(runToken)) {
    throw new Error('Could not create a safe API pilot receipt ID.');
  }
  const runId = `${startedAt.toISOString().replace(/[:.]/g, '-')}-${runToken}`;
  const privateRoot = resolvePrivateDataRoot({ sourceRoot: rootDir, dataRoot, allowTestDataRoot });
  const pilotDir = join(privateRoot, 'api-pilot');
  const runDir = join(pilotDir, runId);
  const requestBody = buildRequestBody(prompt, profileName);
  await ensurePrivateDirectory(pilotDir);
  await mkdir(runDir, { recursive: false, mode: 0o700 });
  await writeFile(join(runDir, 'prompt.txt'), prompt, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  await writeJson(join(runDir, 'request.json'), requestBody, { flag: 'wx', mode: PRIVATE_FILE_MODE });

  const startNs = process.hrtime.bigint();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`API probe timed out after ${timeoutMs}ms.`)), timeoutMs);
  let headersMs = null;
  let responseCompleteMs = null;
  let httpStatus = null;
  let rawResponse = null;
  let response = null;
  let model = null;
  let validation = null;
  let eventLedger = null;
  let streamTimings = null;
  let failure = null;
  let errorStage = null;
  let requestCount = 0;
  try {
    errorStage = 'request';
    requestCount = 1;
    const apiResponse = await fetchImpl(API_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(requestBody),
      redirect: 'error',
      signal: controller.signal,
    });
    headersMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    httpStatus = apiResponse.status;
    errorStage = 'response-body';
    let programText;
    if (profile.stream && apiResponse.ok) {
      const streamed = await readResponseSse(apiResponse, {
        maxBytes: MAX_RESPONSE_BYTES,
        elapsedMs: () => Number(process.hrtime.bigint() - startNs) / 1e6,
        signal: controller.signal,
      });
      rawResponse = redact(streamed.raw, apiKey);
      eventLedger = streamed.ledger;
      streamTimings = streamed.timings;
      response = streamed.terminalResponse;
      programText = streamed.outputText;
    } else {
      rawResponse = redact(await readResponseText(apiResponse), apiKey);
    }
    responseCompleteMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    errorStage = 'http-status';
    if (!apiResponse.ok) throw new Error(`OpenAI Responses API returned HTTP ${apiResponse.status}.`);
    if (!profile.stream) {
      errorStage = 'response-json';
      response = JSON.parse(rawResponse);
      errorStage = 'response-output';
      programText = extractProgramText(response);
    } else {
      errorStage = 'response-output';
      extractProgramText(response);
    }
    const program = JSON.parse(programText);
    errorStage = 'shape-validation';
    model = profile.expand(program, {});
    validation = validateVoxels(model);
    if (!validation.valid) throw new Error(`Voxel validation failed: ${validation.errors.join('; ')}`);
    if (streamTimings) streamTimings.localValidationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  } catch (error) {
    if (rawResponse === null && typeof error.partialResponse === 'string') rawResponse = redact(error.partialResponse, apiKey);
    if (eventLedger === null && Array.isArray(error.eventLedger)) eventLedger = error.eventLedger;
    if (streamTimings === null && error.streamTimings) streamTimings = error.streamTimings;
    if (response === null && error.terminalResponse) response = error.terminalResponse;
    failure = safeError(error, apiKey);
  } finally {
    clearTimeout(timer);
  }
  const generationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const successful = !failure && validation?.valid === true;
  const cost = estimateCost(response?.usage, profileName);
  const record = {
    runId,
    ...(profile.id ? { profile: profile.id } : {}),
    prompt,
    promptPath,
    requestBody,
    startedAt: startedAt.toISOString(),
    finishedAt: now().toISOString(),
    status: successful ? 'generated-schema-valid' : 'failed',
    requestCount,
    retries: 0,
    timedOut: controller.signal.aborted,
    httpStatus,
    requestedModel: profile.model,
    actualModel: response?.model ?? null,
    reasoningEffort: profile.reasoningEffort,
    requestedServiceTier: profile.serviceTier,
    actualServiceTier: response?.service_tier ?? null,
    method: profile.method,
    usage: response?.usage ?? null,
    runtime: 'openai-responses-api',
    cost,
    timeoutMs,
    headersMs,
    responseCompleteMs,
    ...(profile.stream ? { eventLedger, streamTimings } : {}),
    generationMs,
    timingScope: 'API request start through response body receipt and shape validation; excludes browser load/render',
    rawResponse,
    error: failure ? { stage: errorStage, message: failure } : null,
    shapeValidation: validation,
    publishedUrl: null,
    publishError: null,
    qualityPass: null,
  };
  const recordPath = join(runDir, 'record.json');
  if (rawResponse !== null) await writeFile(join(runDir, profile.stream ? 'raw-stream.txt' : 'raw-response.txt'), rawResponse, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  if (profile.stream && eventLedger !== null) await writeJson(join(runDir, 'event-ledger.json'), eventLedger, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  await writeJson(recordPath, record, { flag: 'wx', mode: PRIVATE_FILE_MODE });

  if (successful) {
    model.meta = {
      id: runId,
      prompt: userPrompt,
      method: profile.method,
      ...(profile.id ? { profile: profile.id } : {}),
      provenance: 'generated',
      created: startedAt.toISOString().slice(0, 10),
      generationMs,
      runtime: 'openai-responses-api',
      timingScope: record.timingScope,
      requestedModel: profile.model,
      actualModel: record.actualModel,
      reasoningEffort: profile.reasoningEffort,
      requestedServiceTier: profile.serviceTier,
      actualServiceTier: record.actualServiceTier,
      usage: record.usage,
      cost,
      limitations: 'Raw-shape preview from cubic voxels. Schema validity is not a quality pass, LEGO conversion, physical stability check, or buildability proof.',
    };
    await writeJson(join(runDir, 'model.json'), model, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  }
  return { record, recordPath };
}

export async function runCli({ args = process.argv.slice(2), run = runApiPilot, log = console.log } = {}) {
  if (args.length === 1 && args[0] === '--help') {
    log(`Usage: node scripts/run-api-pilot.mjs [--profile ${['sol-cat', 'sol-cat-stream', 'sol-cat-focused', 'sol-cat-relative', 'astra-reef-stream', ...ASTRA_CROSS_SUBJECT_PROFILES.keys()].join('|')}] --dry-run | --live --max-requests=1\n\nLive paid API use requires both explicit flags and performs exactly one request with zero application retries. Outputs remain private.`);
    return null;
  }
  let profile = null;
  let remaining = [...args];
  const profileIndex = remaining.indexOf('--profile');
  if (profileIndex !== -1 && ['sol-cat', 'sol-cat-stream', 'sol-cat-focused', 'sol-cat-relative', 'astra-reef-stream', ...ASTRA_CROSS_SUBJECT_PROFILES.keys()].includes(remaining[profileIndex + 1])) {
    profile = remaining[profileIndex + 1];
    remaining.splice(profileIndex, 2);
  }
  if (remaining.length === 1 && remaining[0] === '--dry-run') {
    log(JSON.stringify(planFor(resolveProfile(profile)), null, 2));
    return null;
  }
  const liveIndex = remaining.indexOf('--live');
  if (liveIndex !== -1) remaining.splice(liveIndex, 1);
  const maxIndex = remaining.findIndex((value) => value.startsWith('--max-requests='));
  const maxRequests = maxIndex === -1 ? null : Number(remaining.splice(maxIndex, 1)[0].split('=')[1]);
  if (remaining.length !== 0) throw new Error(`Unknown arguments: ${args.join(' ')}`);
  if (liveIndex === -1 || maxRequests !== 1) {
    throw new Error('Live paid API use requires explicit --live --max-requests=1. Use --dry-run to inspect the bounded plan.');
  }
  const { record, recordPath } = profile ? await run({ profile }) : await run();
  log(JSON.stringify({ runId: record.runId, status: record.status, record: recordPath, publishedUrl: record.publishedUrl }));
  if (record.status !== 'generated-schema-valid') process.exitCode = 1;
  return record;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => { console.error(safeError(error, process.env.OPENAI_API_KEY)); process.exitCode = 1; });
}
