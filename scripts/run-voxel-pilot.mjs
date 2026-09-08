import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createChildEnvironment } from '../server/codex-provider.js';
import { ensurePrivateDirectory, PRIVATE_FILE_MODE, resolvePrivateDataRoot } from '../server/private-data-root.js';
import { expandDetailProgram } from '../src/detail-program.js';
import { expandBidirectionalLoftProgram } from '../src/bidirectional-loft.js';
import { expandLoftProgram } from '../src/loft-program.js';
import { executeConstructionProgram } from '../src/construction-runtime.js';
import { expandLayers, expandVoxelProgram, expandVoxelTuples, validateVoxels } from '../src/voxels.js';

const MAX_STDOUT_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 90_000;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PILOT_REPRESENTATIONS = new Set([
  'voxel-layers', 'voxel-program', 'voxel-tuples', 'voxel-detail', 'voxel-loft', 'voxel-loft-bidirectional', 'voxel-construction',
]);

function validatePilotRepresentation(method) {
  if (!PILOT_REPRESENTATIONS.has(method)) {
    throw new Error('Representation must be voxel-layers, voxel-program, voxel-tuples, voxel-detail, voxel-loft, voxel-loft-bidirectional, or voxel-construction.');
  }
  return method;
}

export function expandPilotRepresentation(method, value, meta = {}) {
  validatePilotRepresentation(method);
  if (method === 'voxel-construction') {
    throw new Error('voxel-construction requires async expandPilotRepresentationAsync.');
  }
  if (method === 'voxel-layers') return expandLayers(value, meta);
  if (method === 'voxel-program') return expandVoxelProgram(value, meta);
  if (method === 'voxel-tuples') return expandVoxelTuples(value, meta);
  if (method === 'voxel-detail') return expandDetailProgram(value, meta);
  if (method === 'voxel-loft-bidirectional') return expandBidirectionalLoftProgram(value, meta);
  return expandLoftProgram(value, meta);
}

export function parseConstructionEnvelope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('voxel-construction output must be an object with exactly one code string field.');
  }
  const fields = Object.keys(value);
  if (fields.length !== 1 || fields[0] !== 'code' || typeof value.code !== 'string') {
    throw new TypeError('voxel-construction output must be an object with exactly one code string field.');
  }
  return value.code;
}

export async function expandPilotRepresentationAsync(method, value, meta = {}) {
  validatePilotRepresentation(method);
  if (method !== 'voxel-construction') {
    return { model: expandPilotRepresentation(method, value, meta), execution: null };
  }
  const code = parseConstructionEnvelope(value);
  const wallStartNs = process.hrtime.bigint();
  try {
    const result = await executeConstructionProgram(code, meta);
    return {
      model: result.model,
      execution: {
        ops: result.ops,
        runtimeMs: result.runtimeMs,
        wallMs: Number(process.hrtime.bigint() - wallStartNs) / 1e6,
      },
    };
  } catch (error) {
    error.constructionWallMs = Number(process.hrtime.bigint() - wallStartNs) / 1e6;
    throw error;
  }
}

export function parseEventsJsonl(text) {
  const events = [];
  const malformedLines = [];
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); }
    catch { malformedLines.push(index + 1); }
  }
  return { events, malformedLines };
}

export function summarizeProtocol(events) {
  const toolUseViolations = [];
  let model = null;
  let usage = null;
  let serviceTier = null;
  const visit = (value, path = '') => {
    if (!value || typeof value !== 'object') return;
    if (!model && typeof value.model === 'string') model = value.model;
    if (value.usage && typeof value.usage === 'object') usage = value.usage;
    if (typeof value.service_tier === 'string') serviceTier = value.service_tier;
    const type = typeof value.type === 'string' ? value.type : '';
    if (/(tool_call|tool_use|command_execution|mcp_tool_call|web_search|file_change|function_call)/i.test(type)) {
      toolUseViolations.push({ path, type });
    }
    for (const [key, child] of Object.entries(value)) visit(child, path ? `${path}.${key}` : key);
  };
  for (const [index, event] of events.entries()) visit(event, `events[${index}]`);
  return { model, usage, serviceTier, toolUseViolations };
}

export function validateReasoningEffort(value = 'medium', model = 'gpt-6-astra') {
  const supported = value === 'low' || value === 'medium' || (value === 'none' && model === 'gpt-5.6-sol');
  if (!supported) {
    throw new Error('VOXEL_PILOT_REASONING_EFFORT must be low or medium; none is only supported for gpt-5.6-sol.');
  }
  return value;
}

export function validateRuntimeModel(value = 'gpt-6-astra') {
  if (!['gpt-6-astra', 'gpt-5.6-sol', 'gpt-5.4-mini'].includes(value)) {
    throw new Error('VOXEL_PILOT_MODEL must be gpt-6-astra, gpt-5.6-sol, or gpt-5.4-mini.');
  }
  return value;
}

export function validateServiceTier(value) {
  if (value === undefined) return null;
  if (value !== 'fast') {
    throw new Error('VOXEL_PILOT_SERVICE_TIER must be unset or fast.');
  }
  return value;
}

export function serviceTierArgs(serviceTier) {
  return serviceTier === 'fast' ? ['--enable', 'fast_mode', '-c', 'service_tier="fast"'] : [];
}

function safeExcerpt(value, max = 1200) {
  return value
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/(api[_-]?key|authorization|bearer)\s*[:=]?\s*[^\s"']+/gi, '$1 [REDACTED]')
    .slice(-max);
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main(cliArgs = process.argv.slice(2)) {
  const argsCopy = [...cliArgs];
  const liveIndex = argsCopy.indexOf('--live');
  if (liveIndex !== -1) argsCopy.splice(liveIndex, 1);
  const maxIndex = argsCopy.findIndex(value => value.startsWith('--max-calls='));
  const maxCalls = maxIndex === -1 ? null : Number(argsCopy.splice(maxIndex, 1)[0].split('=')[1]);
  if (liveIndex === -1 || maxCalls !== 1 || !argsCopy[0]) {
    throw new Error('Usage: node scripts/run-voxel-pilot.mjs --live --max-calls=1 <prompt-file> [representation]. One subscription call, zero application retries; output stays private.');
  }
  const promptPath = resolve(argsCopy[0]);
  const method = validatePilotRepresentation(argsCopy[1] ?? 'voxel-layers');
  if (argsCopy.length > 2) throw new Error('Unexpected positional arguments.');
  const timeoutMs = Number(process.env.VOXEL_PILOT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error('VOXEL_PILOT_TIMEOUT_MS must be a positive integer.');
  const requestedModel = validateRuntimeModel(process.env.VOXEL_PILOT_MODEL ?? 'gpt-6-astra');
  const reasoningEffort = validateReasoningEffort(
    process.env.VOXEL_PILOT_REASONING_EFFORT ?? 'medium',
    requestedModel,
  );
  const requestedServiceTier = validateServiceTier(process.env.VOXEL_PILOT_SERVICE_TIER);

  const prompt = await readFile(promptPath, 'utf8');
  const promptMatches = [...prompt.matchAll(/^USER PROMPT:\s*(.+?)\s*$/gmi)];
  if (promptMatches.length !== 1) throw new Error('Prompt file must contain exactly one USER PROMPT: line.');
  const userPrompt = promptMatches[0][1];
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`;
  const runsDir = join(resolvePrivateDataRoot({ sourceRoot: root }), 'voxel-pilot');
  const runDir = join(runsDir, runId);
  await ensurePrivateDirectory(runsDir);
  await mkdir(runDir, { recursive: false, mode: 0o700 });
  const tempCwd = await mkdtemp(join(tmpdir(), 'blawx-voxel-pilot-'));
  const eventsPath = join(runDir, 'events.jsonl');
  const stderrPath = join(runDir, 'stderr.log');
  const finalPath = join(runDir, 'final.json');
  const receiptsPath = join(runDir, 'event-receipts.json');
  await writeFile(join(runDir, 'prompt.txt'), prompt, { flag: 'wx', mode: PRIVATE_FILE_MODE });

  const disabled = [
    'shell_tool', 'unified_exec', 'apps', 'plugins', 'skill_search', 'view_image',
    'image_generation', 'hooks', 'goals', 'memories', 'multi_agent', 'code_mode_host',
    'unbounded_connection_retries',
  ];
  const args = [
    'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check',
    '--sandbox', 'read-only', '--json', '--color', 'never',
    '-c', 'web_search="disabled"', '--enable', 'skip_host_skill_discovery',
    ...disabled.flatMap((feature) => ['--disable', feature]),
    '--model', requestedModel, '-c', `model_reasoning_effort="${reasoningEffort}"`,
    ...serviceTierArgs(requestedServiceTier),
    '-C', tempCwd, '-o', finalPath, '-',
  ];

  const startedAt = new Date();
  const startNs = process.hrtime.bigint();
  const stderrChunks = [];
  let stdoutBytes = 0;
  let timedOut = false;
  let stdoutLimitExceeded = false;
  let launchError = null;
  let stdinError = null;
  let receiptBuffer = '';
  let receiptLine = 0;
  const eventReceipts = [];
  const eventsStream = createWriteStream(eventsPath, { flags: 'wx', mode: PRIVATE_FILE_MODE });
  const stderrStream = createWriteStream(stderrPath, { flags: 'wx', mode: PRIVATE_FILE_MODE });
  const childEnv = createChildEnvironment();
  const child = spawn('codex', args, { cwd: tempCwd, detached: true, stdio: ['pipe', 'pipe', 'pipe'], env: childEnv });
  child.stdin.on('error', (error) => { stdinError = error.message; });
  child.stdin.end(prompt);
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes > MAX_STDOUT_BYTES) {
      stdoutLimitExceeded = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch {}
      return;
    }
    eventsStream.write(chunk);
    receiptBuffer += chunk.toString('utf8');
    const lines = receiptBuffer.split('\n');
    receiptBuffer = lines.pop();
    const receivedAt = new Date().toISOString();
    const elapsedMs = Number(process.hrtime.bigint() - startNs) / 1e6;
    for (const line of lines) {
      receiptLine += 1;
      eventReceipts.push({ line: receiptLine, receivedAt, elapsedMs, nonempty: line.trim().length > 0 });
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrStream.write(chunk);
    if (stderrChunks.reduce((n, c) => n + c.length, 0) < 16_384) stderrChunks.push(chunk);
  });
  child.on('error', (error) => { launchError = error.message; });
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch {}
  }, timeoutMs);
  const exit = await new Promise((resolveExit) => {
    child.on('close', (code, signal) => resolveExit({ code, signal }));
  });
  clearTimeout(timer);
  await Promise.all([
    new Promise((done) => eventsStream.end(done)),
    new Promise((done) => stderrStream.end(done)),
  ]);
  if (receiptBuffer.length > 0) {
    receiptLine += 1;
    eventReceipts.push({
      line: receiptLine, receivedAt: new Date().toISOString(),
      elapsedMs: Number(process.hrtime.bigint() - startNs) / 1e6, nonempty: receiptBuffer.trim().length > 0,
    });
  }
  await writeFile(receiptsPath, `${JSON.stringify(eventReceipts, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE });

  const eventText = await readFile(eventsPath, 'utf8');
  const parsedEvents = parseEventsJsonl(eventText);
  const protocol = summarizeProtocol(parsedEvents.events);
  let finalRaw = null;
  let finalValue = null;
  let model = null;
  let parseError = null;
  let shapeError = null;
  let shapeValidation = null;
  let constructionExecution = null;
  let constructionWallMs = null;
  let schemaValid = false;
  try {
    finalRaw = await readFile(finalPath, 'utf8');
    finalValue = JSON.parse(finalRaw);
  } catch (error) {
    parseError = error.message;
  }
  if (finalValue !== null) {
    try {
      const expanded = await expandPilotRepresentationAsync(method, finalValue);
      model = expanded.model;
      constructionExecution = expanded.execution;
      constructionWallMs = expanded.execution?.wallMs ?? null;
      shapeValidation = validateVoxels(model);
      schemaValid = shapeValidation.valid;
    } catch (error) {
      shapeError = error.message;
      constructionWallMs = error.constructionWallMs ?? constructionWallMs;
    }
  }
  const generationMs = Number(process.hrtime.bigint() - startNs) / 1e6;
  const successful = exit.code === 0 && !timedOut && !stdoutLimitExceeded && !launchError && !stdinError &&
    parsedEvents.malformedLines.length === 0 && protocol.toolUseViolations.length === 0 && schemaValid;
  let publishedUrl = null;
  let publishError = null;
  if (successful) {
    model.meta = {
      ...(model.meta ?? {}), id: runId, prompt: userPrompt, method, provenance: 'generated',
      created: startedAt.toISOString().slice(0, 10), generationMs,
      runtime: 'codex-cli-subscription', timingScope: 'CLI startup through shape validation; excludes browser load/render',
      requestedModel, actualModel: protocol.model, reasoningEffort,
      requestedServiceTier, actualServiceTier: protocol.serviceTier,
      cost: { amountUsd: 0, basis: 'No separate API charges; ChatGPT subscription usage applies.' },
      limitations: 'Shape preview from cubic voxels. Generation status is not a quality pass, LEGO conversion, physical stability check, or buildability proof.',
    };
  }

  const record = {
    runId, prompt, promptPath, startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
    status: successful ? 'generated-schema-valid' : 'failed', exitCode: exit.code, signal: exit.signal,
    timedOut, stdoutLimitExceeded, stdoutBytes, launchError, stdinError,
    requestedModel, actualModel: protocol.model, reasoningEffort,
    requestedServiceTier, actualServiceTier: protocol.serviceTier,
    method, usage: protocol.usage,
    runtime: 'codex-cli-subscription', cost: { amountUsd: 0, basis: 'No separate API charges; ChatGPT subscription usage applies.' },
    timeoutMs, generationMs, timingScope: 'CLI startup through shape validation; excludes browser load/render',
    malformedEventLines: parsedEvents.malformedLines, protocolToolUseViolations: protocol.toolUseViolations,
    finalRaw, parseError, shapeError, shapeValidation,
    constructionExecution, constructionWallMs,
    stderrExcerpt: safeExcerpt(Buffer.concat(stderrChunks).toString('utf8')),
    publishedUrl, publishError,
    qualityPass: null,
  };
  const recordPath = join(runDir, 'record.json');
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  if (successful) {
    await writeFile(join(runDir, 'model.json'), `${JSON.stringify(model, null, 2)}\n`, { flag: 'wx', mode: PRIVATE_FILE_MODE });
  }
  console.log(JSON.stringify({ runId, status: record.status, record: join(runDir, 'record.json'), publishedUrl: record.publishedUrl }));
  if (!successful) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(safeExcerpt(error.stack ?? error.message)); process.exitCode = 1; });
}
