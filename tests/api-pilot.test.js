import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  ASTRA_CROSS_SUBJECT_API_PILOT_PLANS, ASTRA_REEF_STREAM_API_PILOT_PLAN,
  buildRequestBody, estimateCost, extractProgramText,
  runApiPilot as runApiPilotWithPrivateRoot, runCli,
} from '../scripts/run-api-pilot.mjs';
import { readResponseSse } from '../scripts/response-sse.mjs';

const prompt = 'Instructions\nUSER PROMPT: a massive detailed futuristic cityscape\n';
const validProgram = JSON.stringify({ operations: [{ type: 'box', x: 0, y: 0, z: 0, w: 2, h: 2, d: 2, color: 'orange' }] });

function runApiPilot(options = {}) {
  return runApiPilotWithPrivateRoot({
    ...options,
    dataRoot: join(options.rootDir, 'private-data'),
    allowTestDataRoot: true,
  });
}

async function fixture() {
  const rootDir = await mkdtemp(join(tmpdir(), 'blawx-api-pilot-'));
  await mkdir(join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy'), { recursive: true });
  await mkdir(join(rootDir, 'public', 'experiments'), { recursive: true });
  await writeFile(join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'city-program.txt'), prompt);
  await writeFile(join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft.txt'), 'Instructions\nUSER PROMPT: cat\n');
  await writeFile(join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft-focused-planning.txt'), 'Focused instructions\nUSER PROMPT: focused cat\n');
  await writeFile(join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-relative.txt'), 'Relative instructions\nUSER PROMPT: relative cat\n');
  await writeFile(join(rootDir, 'public', 'experiments', 'index.json'), '[]\n');
  return rootDir;
}

function response(value, status = 200) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

function completed(text = validProgram, extra = {}) {
  return {
    status: 'completed', model: 'gpt-6-astra', service_tier: 'priority',
    usage: { input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 20 } },
    output: [{ type: 'reasoning' }, { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] }],
    ...extra,
  };
}

function streamResponse(chunks, { status = 200, onCancel = () => {} } = {}) {
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: { getReader: () => ({
      async read() { return index < chunks.length ? { done: false, value: chunks[index++] } : { done: true }; },
      async cancel() { onCancel(); },
    }) },
  };
}

function sse(type, payload = {}) {
  return `event: ${type}\r\ndata: ${JSON.stringify({ type, ...payload })}\r\n\r\n`;
}

test('request body is the fixed bounded official shape', () => {
  assert.deepEqual(buildRequestBody('p'), {
    model: 'gpt-6-astra', reasoning: { effort: 'medium' }, input: 'p', service_tier: 'priority',
    max_output_tokens: 6000, store: false, tools: [], stream: false,
  });
});

test('sol-cat profile fixes model, effort, tier, output cap, and pricing', () => {
  assert.deepEqual(buildRequestBody('cat prompt', 'sol-cat'), {
    model: 'gpt-5.6-sol', reasoning: { effort: 'low' }, input: 'cat prompt', service_tier: 'fast',
    max_output_tokens: 2000, store: false, tools: [], stream: false,
  });
  const cost = estimateCost({ input_tokens: 100, output_tokens: 50, input_tokens_details: { cached_tokens: 20 } }, 'sol-cat');
  assert.equal(cost.amountUsd, 0.002656);
  assert.match(cost.basis, /\$8\/M uncached input/);
  assert.match(cost.basis, /\$10\/M cache-write input/);
});

test('sol-cat-stream changes only streaming and is available without executing in dry-run', async () => {
  const nonstream = buildRequestBody('cat prompt', 'sol-cat');
  const streaming = buildRequestBody('cat prompt', 'sol-cat-stream');
  assert.deepEqual(streaming, { ...nonstream, stream: true });
  let calls = 0;
  const plans = [];
  await runCli({ args: ['--profile', 'sol-cat-stream', '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
  assert.equal(calls, 0);
  assert.equal(plans[0].profile, 'sol-cat-stream');
  assert.equal(plans[0].requests, 1);
  assert.equal(plans[0].retries, 0);
});

test('sol-cat-focused loads the focused prompt and otherwise matches the streaming baseline', async () => {
  const rootDir = await fixture();
  const focusedPrompt = 'Focused instructions\nUSER PROMPT: focused cat\n';
  const loft = JSON.stringify({ ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] });
  const terminal = completed(loft, { model: 'gpt-5.6-sol', service_tier: 'fast' });
  const raw = `${sse('response.output_text.delta', { delta: loft })}${sse('response.completed', { response: terminal })}`;
  let requestBody;
  const { record, recordPath } = await runApiPilot({
    rootDir,
    profile: 'sol-cat-focused',
    apiKey: 'secret-key',
    uuid: () => 'focused',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return streamResponse([new TextEncoder().encode(raw)]);
    },
  });
  assert.deepEqual(requestBody, buildRequestBody(focusedPrompt, 'sol-cat-stream'));
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.profile, 'sol-cat-focused');
  assert.equal(record.prompt, focusedPrompt);
  assert.equal(record.promptPath, join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft-focused-planning.txt'));
  assert.equal(JSON.parse(await readFile(recordPath)).profile, 'sol-cat-focused');
  const savedModel = JSON.parse(await readFile(join(recordPath, '..', 'model.json')));
  assert.equal(savedModel.meta.profile, 'sol-cat-focused');
  assert.equal(record.publishedUrl, null);

  let calls = 0;
  const plans = [];
  await runCli({ args: ['--profile', 'sol-cat-focused', '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
  await runCli({ args: ['--profile', 'sol-cat-stream', '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
  assert.equal(calls, 0);
  assert.deepEqual(plans[0], {
    ...plans[1],
    profile: 'sol-cat-focused',
    promptPath: join('tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft-focused-planning.txt'),
  });
  const help = [];
  await runCli({ args: ['--help'], run: async () => { calls += 1; }, log: (value) => help.push(value) });
  assert.match(help[0], /sol-cat-focused/);
  assert.equal(calls, 0);
});

test('sol-cat-relative loads its exact prompt and compiles compact relative tuples', async () => {
  const rootDir = await fixture();
  const relativePrompt = 'Relative instructions\nUSER PROMPT: relative cat\n';
  const relative = JSON.stringify({ ops: [
    ['b', 0, 0, 0, 2, 2, 2, 'O'],
    ['@', 0, [0, 1, 0], [0, 0, 0], ['b', 0, 0, 0, 1, 1, 1, 'W']],
  ] });
  const terminal = completed(relative, { model: 'gpt-5.6-sol', service_tier: 'fast' });
  const raw = `${sse('response.output_text.delta', { delta: relative })}${sse('response.completed', { response: terminal })}`;
  let requestBody;
  const { record, recordPath } = await runApiPilot({
    rootDir,
    profile: 'sol-cat-relative',
    apiKey: 'secret-key',
    uuid: () => 'relative',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return streamResponse([new TextEncoder().encode(raw)]);
    },
  });
  assert.deepEqual(requestBody, buildRequestBody(relativePrompt, 'sol-cat-stream'));
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.profile, 'sol-cat-relative');
  assert.equal(record.method, 'voxel-relative-tuples');
  assert.equal(record.prompt, relativePrompt);
  assert.equal(record.promptPath, join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-relative.txt'));
  assert.equal(JSON.parse(await readFile(recordPath)).method, 'voxel-relative-tuples');
  const savedModel = JSON.parse(await readFile(join(recordPath, '..', 'model.json')));
  assert.equal(savedModel.meta.profile, 'sol-cat-relative');
  assert.equal(savedModel.meta.method, 'voxel-relative-tuples');
  assert.ok(savedModel.cells.some(({ x, y, z, color }) => x === 0 && y === 2 && z === 0 && color === 'white'));
  assert.equal(record.publishedUrl, null);

  const plans = [];
  let calls = 0;
  await runCli({ args: ['--profile', 'sol-cat-relative', '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
  await runCli({ args: ['--profile', 'sol-cat-stream', '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
  assert.equal(calls, 0);
  assert.deepEqual(plans[0], {
    ...plans[1],
    profile: 'sol-cat-relative',
    promptPath: join('tests', 'fixtures', 'prompts', 'legacy', 'cat-small-relative.txt'),
  });
  const help = [];
  await runCli({ args: ['--help'], run: async () => { calls += 1; }, log: (value) => help.push(value) });
  assert.match(help[0], /sol-cat-relative/);
  assert.equal(calls, 0);
});

test('astra-reef-stream has one bounded dry run and uses the exact reef prompt in a mocked success', async () => {
  assert.deepEqual(buildRequestBody('reef prompt', 'astra-reef-stream'), {
    model: 'gpt-6-astra', reasoning: { effort: 'low' }, input: 'reef prompt', service_tier: 'priority',
    max_output_tokens: 3000, store: false, tools: [], stream: true,
  });
  assert.equal(ASTRA_REEF_STREAM_API_PILOT_PLAN.requests, 1);
  assert.equal(ASTRA_REEF_STREAM_API_PILOT_PLAN.retries, 0);
  assert.equal(ASTRA_REEF_STREAM_API_PILOT_PLAN.plannedCostCeilingUsd, 0.5);
  assert.match(ASTRA_REEF_STREAM_API_PILOT_PLAN.costNote, /planning estimate, not a provider billing cap/);
  assert.match(ASTRA_REEF_STREAM_API_PILOT_PLAN.comparisonNote, /does not claim.*actually equal/);

  let dryRunCalls = 0;
  const plans = [];
  await runCli({
    args: ['--profile', 'astra-reef-stream', '--dry-run'],
    run: async () => { dryRunCalls += 1; },
    log: (value) => plans.push(JSON.parse(value)),
  });
  assert.equal(dryRunCalls, 0);
  assert.deepEqual(plans[0], ASTRA_REEF_STREAM_API_PILOT_PLAN);

  const rootDir = await fixture();
  const reefPrompt = 'Reef instructions\nUSER PROMPT: reef station\n';
  await mkdir(join(rootDir, 'server', 'prompts'), { recursive: true });
  await writeFile(join(rootDir, 'server', 'prompts', 'voxel-loft.txt'), reefPrompt);
  const loft = JSON.stringify({ ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] });
  const terminal = completed(loft);
  const raw = `${sse('response.output_text.delta', { delta: loft })}${sse('response.completed', { response: terminal })}`;
  let requestBody;
  const { record } = await runApiPilot({
    rootDir, profile: 'astra-reef-stream', apiKey: 'mock-key', uuid: () => 'reef',
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return streamResponse([new TextEncoder().encode(raw)]);
    },
  });
  assert.deepEqual(requestBody, buildRequestBody(reefPrompt, 'astra-reef-stream'));
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.prompt, reefPrompt);
  assert.equal(record.promptPath, join(rootDir, 'server', 'prompts', 'voxel-loft.txt'));
  assert.equal(record.profile, 'astra-reef-stream');
  assert.equal(record.method, 'voxel-loft');
  assert.equal(record.requestedModel, 'gpt-6-astra');
  assert.equal(record.reasoningEffort, 'low');
  assert.equal(record.requestedServiceTier, 'priority');
});

test('astra cross-subject profiles change only identity, prompt path, and USER PROMPT subject', async () => {
  const rootDir = join(import.meta.dirname, '..');
  const reefPrompt = await readFile(join(rootDir, 'server', 'prompts', 'voxel-loft.txt'), 'utf8');
  const cases = [
    ['cat', 'cat'],
    ['pickup', 'red pickup truck'],
    ['dragon', 'dragon curled around a lighthouse'],
    ['person', 'person eating spaghetti'],
    ['nostalgia', 'nostalgia'],
  ];
  for (const [slug, subject] of cases) {
    const profile = `astra-${slug}-stream`;
    const actualPrompt = await readFile(join(rootDir, 'tests', 'fixtures', 'prompts', 'api-cross-subject', `${slug}.txt`), 'utf8');
    const expectedPrompt = reefPrompt.replace(/^USER PROMPT:.*$/m, `USER PROMPT: ${subject}`);
    assert.equal(actualPrompt, expectedPrompt, `${slug} prompt must change only the subject line`);
    assert.deepEqual(buildRequestBody(actualPrompt, profile), buildRequestBody(actualPrompt, 'astra-reef-stream'));

    let calls = 0;
    const plans = [];
    await runCli({ args: ['--profile', profile, '--dry-run'], run: async () => { calls += 1; }, log: (value) => plans.push(JSON.parse(value)) });
    assert.equal(calls, 0);
    assert.deepEqual(plans[0], ASTRA_CROSS_SUBJECT_API_PILOT_PLANS[profile]);
    assert.deepEqual(plans[0], {
      ...ASTRA_REEF_STREAM_API_PILOT_PLAN,
      profile,
      promptPath: join('tests', 'fixtures', 'prompts', 'api-cross-subject', `${slug}.txt`),
    });
  }

  const help = [];
  await runCli({ args: ['--help'], run: async () => assert.fail('help must not run'), log: (value) => help.push(value) });
  for (const [slug] of cases) assert.match(help[0], new RegExp(`astra-${slug}-stream`));
});

test('fragmented SSE handles UTF-8 boundaries, CRLF, multiline data, and terminal usage', async () => {
  const rootDir = await fixture();
  const loft = JSON.stringify({ ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] });
  const terminal = completed(loft, {
    model: 'gpt-5.6-sol', service_tier: 'fast',
    usage: { input_tokens: 20, output_tokens: 10, input_tokens_details: { cached_tokens: 2, cache_write_tokens: 3 } },
  });
  const first = sse('response.created', { response: { status: 'in_progress', note: '🙂' } });
  const delta = `event: response.output_text.delta\r\ndata: {"type":"response.output_text.delta",\r\ndata: "delta":${JSON.stringify(loft)}}\r\n\r\n`;
  const raw = `${first}${delta}${sse('response.completed', { response: terminal })}`;
  const encoded = new TextEncoder().encode(raw);
  const chunks = [...encoded].map((_byte, index) => encoded.slice(index, index + 1));
  let calls = 0;
  const { record, recordPath } = await runApiPilot({
    rootDir, profile: 'sol-cat-stream', apiKey: 'secret-key', uuid: () => 'stream-ok',
    fetchImpl: async () => { calls += 1; return streamResponse(chunks); },
  });
  assert.equal(calls, 1);
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.actualModel, 'gpt-5.6-sol');
  assert.equal(record.actualServiceTier, 'fast');
  assert.equal(record.cost.amountUsd, 0.0005516000000000001);
  assert.deepEqual(record.eventLedger.map(({ type }) => type), ['response.created', 'response.output_text.delta', 'response.completed']);
  assert.ok(record.streamTimings.firstEventMs !== null);
  assert.ok(record.streamTimings.firstTextMs !== null);
  assert.ok(record.streamTimings.terminalMs !== null);
  assert.ok(record.streamTimings.eofMs !== null);
  assert.ok(record.streamTimings.localValidationMs >= record.streamTimings.eofMs);
  assert.equal(await readFile(join(recordPath, '..', 'raw-stream.txt'), 'utf8'), raw);
});

test('stream failures preserve bounded artifacts, terminal usage, and never publish', async () => {
  const loft = JSON.stringify({ ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] });
  const terminal = completed(loft, { model: 'gpt-5.6-sol', service_tier: 'fast' });
  for (const [name, raw, expected] of [
    ['missing-terminal', sse('response.output_text.delta', { delta: loft }), /without a response.completed/],
    ['incomplete', sse('response.incomplete', { response: { status: 'incomplete', usage: terminal.usage } }), /response.incomplete/],
    ['bad-completed', sse('response.completed', { response: { ...terminal, status: 'incomplete' } }), /must contain a completed response/],
    ['contradictory', `event: response.completed\ndata: ${JSON.stringify({ type: 'response.failed', response: terminal })}\n\n`, /Contradictory/],
    ['text-mismatch', `${sse('response.output_text.delta', { delta: `${loft} ` })}${sse('response.completed', { response: terminal })}`, /does not match/],
    ['malformed', 'event: response.created\ndata: {\n\n', /Malformed JSON/],
  ]) {
    const rootDir = await fixture();
    const bytes = new TextEncoder().encode(raw);
    const { record, recordPath } = await runApiPilot({ rootDir, profile: 'sol-cat-stream', apiKey: 'secret-key', uuid: () => name, fetchImpl: async () => streamResponse([bytes]) });
    assert.equal(record.status, 'failed', name);
    assert.match(record.error.message, expected, name);
    assert.equal(await readFile(join(recordPath, '..', 'raw-stream.txt'), 'utf8'), raw, name);
    assert.deepEqual(JSON.parse(await readFile(join(rootDir, 'public', 'experiments', 'index.json'))), [], name);
    if (name === 'text-mismatch' || name === 'bad-completed') assert.equal(record.usage.output_tokens, 50);
  }
});

test('SSE byte cap cancels its reader and exposes partial state', async () => {
  const encoder = new TextEncoder();
  let cancelled = 0;
  const response = streamResponse([encoder.encode(sse('response.created')), encoder.encode('12345')], { onCancel: () => { cancelled += 1; } });
  await assert.rejects(readResponseSse(response, { maxBytes: encoder.encode(sse('response.created')).length + 2 }), (error) => {
    assert.match(error.message, /exceeds/);
    assert.match(error.partialResponse, /response.created/);
    assert.equal(error.eventLedger.length, 1);
    return true;
  });
  assert.equal(cancelled, 1);
});

test('stream hard timeout cancels an abort-ignorant reader without awaiting hung cancellation', async () => {
  const rootDir = await fixture();
  const encoder = new TextEncoder();
  let cancelled = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    let first = true;
    return {
      ok: true,
      status: 200,
      body: { getReader: () => ({
        async read() {
          if (first) { first = false; return { done: false, value: encoder.encode(sse('response.created')) }; }
          return new Promise(() => {});
        },
        cancel() { cancelled += 1; return new Promise(() => {}); },
      }) },
    };
  };
  const { record, recordPath } = await runApiPilot({ rootDir, profile: 'sol-cat-stream', apiKey: 'secret-key', timeoutMs: 5, uuid: () => 'stream-timeout', fetchImpl });
  assert.equal(calls, 1);
  assert.equal(cancelled, 1);
  assert.equal(record.status, 'failed');
  assert.equal(record.timedOut, true);
  assert.equal(record.eventLedger.length, 1);
  assert.match(await readFile(join(recordPath, '..', 'raw-stream.txt'), 'utf8'), /response.created/);
  assert.deepEqual(JSON.parse(await readFile(join(rootDir, 'public', 'experiments', 'index.json'))), []);
});

test('cost estimate separates cache writes from ordinary input', () => {
  const usage = {
    input_tokens: 1396,
    output_tokens: 1966,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 1393 },
  };
  assert.equal(estimateCost(usage, 'sol-cat').amountUsd, 0.092594);
});

test('cost estimate rejects missing, nonfinite, negative, and impossible usage counts', () => {
  for (const usage of [
    null,
    { input_tokens: 10 },
    { input_tokens: Number.NaN, output_tokens: 1 },
    { input_tokens: 10, output_tokens: -1 },
    { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } },
    { input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 6, cache_write_tokens: 5 } },
    { input_tokens: 10, output_tokens: 1, input_tokens_details: { cache_write_tokens: Infinity } },
  ]) {
    assert.equal(estimateCost(usage, 'sol-cat').amountUsd, null);
  }
});

test('help and dry-run never run, while unknown CLI arguments are rejected', async () => {
  let calls = 0;
  const run = async () => { calls += 1; };
  await runCli({ args: ['--help'], run, log: () => {} });
  await runCli({ args: ['--dry-run'], run, log: () => {} });
  const plans = [];
  await runCli({ args: ['--profile', 'sol-cat', '--dry-run'], run, log: (value) => plans.push(JSON.parse(value)) });
  assert.equal(plans[0].profile, 'sol-cat');
  assert.equal(plans[0].plannedCostCeilingUsd, 0.25);
  await assert.rejects(runCli({ args: ['--typo'], run, log: () => {} }), /Unknown arguments/);
  await assert.rejects(runCli({ args: ['--profile', 'other'], run, log: () => {} }), /Unknown arguments/);
  await assert.rejects(runCli({ args: ['--dry-run', '--typo'], run, log: () => {} }), /Unknown arguments/);
  await assert.rejects(runCli({ args: [], run, log: () => {} }), /requires explicit --live --max-requests=1/);
  await assert.rejects(runCli({ args: ['--live'], run, log: () => {} }), /requires explicit --live --max-requests=1/);
  assert.equal(calls, 0);
});

test('sol-cat uses the exact loft prompt and compiler and persists profile identity', async () => {
  const rootDir = await fixture();
  const loft = JSON.stringify({ ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] });
  const payload = completed(loft, { model: 'gpt-5.6-sol', service_tier: 'fast' });
  const { record, recordPath } = await runApiPilot({ rootDir, profile: 'sol-cat', apiKey: 'secret-key', uuid: () => 'sol-cat', fetchImpl: async () => response(payload) });
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.profile, 'sol-cat');
  assert.equal(record.method, 'voxel-loft');
  assert.equal(record.promptPath, join(rootDir, 'tests', 'fixtures', 'prompts', 'legacy', 'cat-small-loft.txt'));
  assert.equal(record.requestBody.max_output_tokens, 2000);
  const savedModel = JSON.parse(await readFile(join(recordPath, '..', 'model.json')));
  assert.equal(savedModel.meta.profile, 'sol-cat');
  assert.equal(record.publishedUrl, null);
  assert.equal(JSON.parse(await readFile(recordPath)).requestedModel, 'gpt-5.6-sol');
});

test('missing key makes zero calls and creates no run directory', async () => {
  const rootDir = await fixture();
  let calls = 0;
  await assert.rejects(runApiPilot({ rootDir, apiKey: '', fetchImpl: async () => { calls += 1; } }), /OPENAI_API_KEY is required/);
  assert.equal(calls, 0);
  await assert.rejects(readdir(join(rootDir, 'private-data')));
});

test('HTTP 429 invokes fetch exactly once and cannot publish', async () => {
  const rootDir = await fixture();
  let calls = 0;
  const result = await runApiPilot({ rootDir, apiKey: 'secret-key', uuid: () => '429', fetchImpl: async () => { calls += 1; return response({ error: { message: 'rate limited' } }, 429); } });
  assert.equal(calls, 1);
  assert.equal(result.record.status, 'failed');
  assert.equal(result.record.httpStatus, 429);
  assert.equal(result.record.requestCount, 1);
  assert.equal(result.record.retries, 0);
  assert.equal(result.record.error.stage, 'http-status');
  assert.deepEqual(JSON.parse(await readFile(join(rootDir, 'public', 'experiments', 'index.json'))), []);
});

test('aborted response body records timeout and redacted partial response', async () => {
  const rootDir = await fixture();
  const apiKey = 'sk-partial-secret';
  const encoder = new TextEncoder();
  const fetchImpl = async (_url, options) => ({
    ok: true,
    status: 200,
    body: {
      getReader() {
        let first = true;
        return {
          async read() {
            if (first) { first = false; return { done: false, value: encoder.encode(`partial ${apiKey}`) }; }
            return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
          },
          async cancel() {},
        };
      },
    },
  });
  const { record, recordPath } = await runApiPilot({ rootDir, apiKey, timeoutMs: 5, uuid: () => 'timeout', fetchImpl });
  assert.equal(record.status, 'failed');
  assert.equal(record.timedOut, true);
  assert.equal(record.error.stage, 'response-body');
  assert.equal(record.rawResponse, 'partial [REDACTED]');
  assert.doesNotMatch(await readFile(recordPath, 'utf8'), new RegExp(apiKey));
});

test('malformed, incomplete, and refusal responses never publish', async () => {
  for (const [name, payload] of [
    ['malformed', '{'],
    ['incomplete', completed(validProgram, { status: 'incomplete' })],
    ['refusal', completed(validProgram, { output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'no' }] }] })],
  ]) {
    const rootDir = await fixture();
    const { record } = await runApiPilot({ rootDir, apiKey: 'secret-key', uuid: () => name, fetchImpl: async () => response(payload) });
    assert.equal(record.status, 'failed', name);
    assert.deepEqual(JSON.parse(await readFile(join(rootDir, 'public', 'experiments', 'index.json'))), [], name);
  }
});

test('valid completed response persists a private model and never appends the public index', async () => {
  const rootDir = await fixture();
  const { record, recordPath } = await runApiPilot({ rootDir, apiKey: 'secret-key', uuid: () => 'valid', fetchImpl: async () => response(completed()) });
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.shapeValidation.valid, true);
  assert.equal(JSON.parse(await readFile(recordPath)).publishedUrl, record.publishedUrl);
  assert.equal(record.publishedUrl, null);
  const index = JSON.parse(await readFile(join(rootDir, 'public', 'experiments', 'index.json')));
  assert.deepEqual(index, []);
  assert.equal(JSON.parse(await readFile(join(recordPath, '..', 'model.json'))).meta.provenance, 'generated');
});

test('duplicate API run IDs preserve the first receipt and make no second request', async () => {
  const rootDir = await fixture();
  let calls = 0;
  const options = {
    rootDir, apiKey: 'secret-key', uuid: () => 'duplicate',
    now: () => new Date('2026-09-07T12:00:00.000Z'),
    fetchImpl: async () => { calls += 1; return response(completed()); },
  };
  const first = await runApiPilot(options);
  const original = await readFile(first.recordPath);
  await assert.rejects(runApiPilot(options), (error) => error?.code === 'EEXIST');
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(first.recordPath), original);
});

test('credentials are redacted from all persisted run outputs', async () => {
  const rootDir = await fixture();
  const apiKey = 'sk-test-exact-secret';
  const { recordPath } = await runApiPilot({ rootDir, apiKey, uuid: () => 'redact', fetchImpl: async () => response(completed(validProgram, { echoed: apiKey })) });
  const runDir = join(recordPath, '..');
  for (const name of await readdir(runDir)) assert.doesNotMatch(await readFile(join(runDir, name), 'utf8'), new RegExp(apiKey));
});

test('output parser concatenates assistant output text and rejects tool calls', () => {
  assert.equal(extractProgramText(completed(undefined, { output: [
    { type: 'reasoning' },
    { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"operations":' }, { type: 'output_text', text: '[]}' }] },
  ] })), '{"operations":[]}');
  assert.throws(() => extractProgramText(completed(undefined, { output: [{ type: 'function_call', name: 'x' }] })), /Unexpected response output item/);
});
