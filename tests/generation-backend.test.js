import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import { buildCodexArgs, createChildEnvironment, runCodex } from '../server/codex-provider.js';
import { createGenerationService, GenerationError } from '../server/generation-service.js';
import { createGenerationMiddleware } from '../server/middleware.js';
import { normalizeSubject, substituteSubject } from '../server/prompt-template.js';

const program = { ops: [['b', 0, 0, 0, 2, 2, 2, 'O']] };
const event = JSON.stringify({ type: 'response.completed', response: { model: 'gpt-6-astra', service_tier: 'fast', usage: { input_tokens: 12, output_tokens: 8 } } });

function outcome(overrides = {}) {
  return {
    exit: { code: 0, signal: null }, timedOut: false, cancelled: false, launchError: null,
    authUnavailable: false, stdinError: null, outputLimitExceeded: false,
    stdout: `${event}\n`, stdoutBytes: Buffer.byteLength(event) + 1, stdoutTruncated: false,
    stderr: '', stderrBytes: 0, stderrTruncated: false,
    finalRaw: JSON.stringify(program), finalTruncated: false, generationMs: 10,
    ...overrides,
  };
}

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), 'blawx-backend-test-'));
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(join(root, 'server', 'prompts'), { recursive: true });
  await writeFile(join(root, 'server', 'prompts', 'voxel-loft.txt'), 'HEADER\nUSER PROMPT: old\nFOOTER\n');
  return root;
}

function privateServiceOptions(root) {
  return { root, dataRoot: join(root, 'app-runs'), allowTestDataRoot: true };
}

test('normalizes a subject to one line while preserving punctuation', () => {
  assert.equal(normalizeSubject('  cat $&\n wearing: a hat?!  '), 'cat $& wearing: a hat?!');
  assert.equal(substituteSubject('A\nUSER PROMPT: old\nB', '$& $` $\''), "A\nUSER PROMPT: $& $` $'\nB");
});

test('Codex invocation is fixed, isolated, and ChatGPT-only', () => {
  const args = buildCodexArgs('/tmp/run/final.json');
  assert.deepEqual(args.slice(0, 4), ['exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check']);
  assert.ok(args.includes('forced_login_method="chatgpt"'));
  assert.equal(args.some((value) => String(value).includes('request_max_retries')), false);
  assert.equal(args.some((value) => String(value).includes('stream_max_retries')), false);
  assert.ok(args.includes('gpt-6-astra'));
  assert.ok(args.includes('service_tier="fast"'));
  assert.equal(args.at(-1), '-');
  const env = createChildEnvironment({ OPENAI_API_KEY: 'secret', CODEX_API_KEY: 'secret2', OPENAI_BASE_URL: 'bad', SAFE: 'no', PATH: '/bin', HOME: '/safe-home', CODEX_HOME: '/safe-codex' });
  assert.deepEqual(env, { PATH: '/bin', HOME: '/safe-home', CODEX_HOME: '/safe-codex' });
});

function fakeChild({ output = '', hang = false } = {}) {
  const child = new EventEmitter();
  child.pid = 999_999_991;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  let closed = false;
  const close = (code = 0, signal = null) => {
    if (closed) return;
    closed = true;
    child.stdout.end(); child.stderr.end();
    queueMicrotask(() => child.emit('close', code, signal));
  };
  child.kill = () => { close(null, 'SIGKILL'); return true; };
  queueMicrotask(() => {
    if (output) child.stdout.write(output);
    if (!hang) close();
  });
  return child;
}

test('provider preflight blocks non-ChatGPT auth before exec', async () => {
  const calls = [];
  const result = await runCodex('prompt', {
    spawn: (_command, args) => { calls.push(args); return fakeChild({ output: 'Logged in using an API key\n' }); },
    timeoutMs: 30,
  });
  assert.equal(result.authUnavailable, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['login', 'status']);
});

test('provider applies the total timeout and kills a hanging exec process', async () => {
  let calls = 0;
  const result = await runCodex('prompt', {
    spawn: () => (++calls === 1 ? fakeChild({ output: 'Logged in using ChatGPT\n' }) : fakeChild({ hang: true })),
    timeoutMs: 20,
  });
  assert.equal(calls, 2);
  assert.equal(result.timedOut, true);
  assert.equal(result.exit.signal, 'SIGKILL');
});

test('provider cancellation kills the isolated exec process group', async () => {
  let calls = 0;
  const controller = new AbortController();
  const running = runCodex('prompt', {
    signal: controller.signal,
    spawn: () => (++calls === 1 ? fakeChild({ output: 'Logged in using ChatGPT\n' }) : fakeChild({ hang: true })),
    timeoutMs: 1000,
  });
  while (calls < 2) await new Promise((resolve) => setImmediate(resolve));
  controller.abort();
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.equal(result.exit.signal, 'SIGKILL');
});

test('service returns expanded raw voxels and preserves a complete private receipt', async () => {
  const root = await fixtureRoot();
  let sentPrompt;
  const service = createGenerationService({ ...privateServiceOptions(root), id: () => 'request-1', provider: async (prompt) => { sentPrompt = prompt; return outcome(); } });
  const result = await service.generate('  orange   cat!  ');
  assert.match(sentPrompt, /^USER PROMPT: orange cat!$/m);
  assert.equal(result.prompt, 'orange cat!');
  assert.equal(result.model.kind, 'voxels');
  assert.equal(result.diagnostics.valid, true);
  assert.equal(result.metadata.actualModel, 'gpt-6-astra');
  assert.equal(result.metadata.qualityPass, null);
  const record = JSON.parse(await readFile(join(root, 'app-runs', 'generation', 'request-1', 'record.json'), 'utf8'));
  assert.equal(record.status, 'generated-schema-valid');
  assert.equal(record.applicationRetries, 0);
  assert.equal(record.cliTransportRetriesControlled, false);
  const saved = JSON.parse(await readFile(join(root, 'app-runs', 'generation', 'request-1', 'model.json'), 'utf8'));
  assert.deepEqual(saved.sourceProgram, program);
  assert.equal(saved.model.cells.length, 8);
});

test('duplicate generation IDs preserve the first receipt and make no second provider call', async () => {
  const root = await fixtureRoot();
  let calls = 0;
  const service = createGenerationService({
    ...privateServiceOptions(root), id: () => 'duplicate-id',
    provider: async () => { calls += 1; return outcome(); },
  });
  await service.generate('cat');
  const recordPath = join(root, 'app-runs', 'generation', 'duplicate-id', 'record.json');
  const original = await readFile(recordPath);
  await assert.rejects(service.generate('dog'), (error) => error?.code === 'EEXIST');
  assert.equal(calls, 1);
  assert.deepEqual(await readFile(recordPath), original);
});

test('service rejects invalid output, maps auth before validation, and keeps receipts', async () => {
  const root = await fixtureRoot();
  const invalid = createGenerationService({ ...privateServiceOptions(root), id: () => 'bad', provider: async () => outcome({ finalRaw: '{' }) });
  await assert.rejects(invalid.generate('cat'), (error) => error instanceof GenerationError && error.code === 'invalid-output');
  const auth = createGenerationService({ ...privateServiceOptions(root), id: () => 'auth', provider: async () => outcome({ exit: { code: null, signal: null }, authUnavailable: true, finalRaw: null }) });
  await assert.rejects(auth.generate('cat'), (error) => error instanceof GenerationError && error.code === 'unavailable');
  assert.equal(JSON.parse(await readFile(join(root, 'app-runs', 'generation', 'auth', 'record.json'))).status, 'failed');
});

test('nonzero CLI exits report generator failure before missing-final validation', async () => {
  const root = await fixtureRoot();
  const service = createGenerationService({
    ...privateServiceOptions(root), id: () => 'config-failure',
    provider: async () => outcome({
      exit: { code: 1, signal: null }, finalRaw: null,
      stderr: 'Invalid configuration while preparing ChatGPT subscription execution.',
    }),
  });
  await assert.rejects(service.generate('cat'), (error) => error.code === 'generator-failed');
  const record = JSON.parse(await readFile(join(root, 'app-runs', 'generation', 'config-failure', 'record.json')));
  assert.equal(record.exit.code, 1);
  assert.match(record.validationError, /complete bounded final response/);
});

test('service allows one request and relays cancellation, including pre-aborted signals', async () => {
  const root = await fixtureRoot();
  let finish;
  const provider = (_prompt, { signal }) => new Promise((resolve) => {
    finish = () => resolve(outcome({ cancelled: signal.aborted }));
    if (signal.aborted) return finish();
    signal.addEventListener('abort', finish, { once: true });
  });
  const service = createGenerationService({ ...privateServiceOptions(root), id: (() => { let i = 0; return () => `r${++i}`; })(), provider });
  const controller = new AbortController();
  const first = service.generate('cat', { signal: controller.signal });
  while (!service.isBusy()) await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.generate('dog'), (error) => error.code === 'busy');
  controller.abort();
  await assert.rejects(first, (error) => error.code === 'cancelled');

  const pre = new AbortController(); pre.abort();
  const second = service.generate('bird', { signal: pre.signal });
  await new Promise((resolve) => setImmediate(resolve));
  finish?.();
  await assert.rejects(second, (error) => error.code === 'cancelled');
});

async function requestMiddleware(service, { method = 'POST', headers = {}, body = '', url = '/api/generate' } = {}) {
  const request = Readable.from(body ? [Buffer.from(body)] : []);
  request.method = method;
  request.url = url;
  request.headers = { host: '127.0.0.1:5178', ...headers };
  const response = new EventEmitter();
  response.headers = {};
  response.destroyed = false;
  response.writableEnded = false;
  response.setHeader = (key, value) => { response.headers[key] = value; };
  const finished = new Promise((resolve) => {
    response.end = (value = '') => { response.writableEnded = true; resolve({ status: response.statusCode, body: value ? JSON.parse(value) : null }); };
  });
  createGenerationMiddleware(service)(request, response, () => response.end());
  return finished;
}

test('HTTP adapter enforces method, host/origin, content type, size, prompt, busy and timeout mappings', async () => {
  let mode = 'success';
  const service = { generate: async (prompt) => {
    normalizeSubject(prompt);
    if (mode === 'busy') throw new GenerationError('busy', 'busy');
    if (mode === 'timeout') throw new GenerationError('timeout', 'timeout', '123e4567-e89b-42d3-a456-426614174000');
    return { prompt };
  } };
  await (async () => {
    assert.equal((await requestMiddleware(service, { method: 'GET' })).status, 405);
    assert.equal((await requestMiddleware(service, { body: '{}' })).status, 415);
    assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json', origin: 'https://evil.test' }, body: '{}' })).status, 403);
    assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: '{}' })).status, 400);
    assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x'.repeat(501) }) })).status, 400);
    assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: 'x'.repeat(3000) }) })).status, 413);
    mode = 'busy';
    assert.equal((await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: '{"prompt":"cat"}' })).status, 409);
    mode = 'timeout';
    const response = await requestMiddleware(service, { headers: { 'content-type': 'application/json' }, body: '{"prompt":"cat"}' });
    assert.equal(response.status, 504);
    assert.equal(response.body.requestId, '123e4567-e89b-42d3-a456-426614174000');
  })();
});

test('HTTP adapter never exposes an unexpected absolute path', async () => {
  const response = await requestMiddleware({ generate: async () => { throw new Error('/Users/private/project/.env'); } }, {
    headers: { 'content-type': 'application/json' }, body: '{"prompt":"cat"}',
  });
  assert.equal(response.status, 502);
  assert.deepEqual(response.body.error, { code: 'generator-failed', message: 'Generator failed.' });
  assert.doesNotMatch(JSON.stringify(response.body), /Users|\.env/);
});

test('HTTP adapter never echoes adversarial validation text or non-UUID request IDs', async () => {
  const sentinel = '/Users/private/project/.env?token=secret';
  const response = await requestMiddleware({
    generate: async () => { throw Object.assign(new TypeError(`Prompt must not be empty. ${sentinel}`), { requestId: sentinel }); },
  }, { headers: { 'content-type': 'application/json' }, body: '{"prompt":"cat"}' });
  assert.equal(response.status, 400);
  assert.deepEqual(response.body, { error: { code: 'bad-request', message: 'Invalid generation request.' } });
  assert.doesNotMatch(JSON.stringify(response.body), /Users|token|secret/);
});

test('HTTP response disconnect aborts the active generation signal', async () => {
  let observedAbort = false;
  const service = { generate: (_prompt, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      observedAbort = true;
      reject(new GenerationError('cancelled', 'cancelled', 'gone'));
    }, { once: true });
  }) };
  const request = Readable.from([Buffer.from('{"prompt":"cat"}')]);
  request.method = 'POST'; request.url = '/api/generate';
  request.headers = { host: '127.0.0.1:5178', 'content-type': 'application/json' };
  const response = new EventEmitter();
  response.destroyed = false; response.writableEnded = false;
  response.setHeader = () => {};
  response.end = () => { response.writableEnded = true; };
  const serving = createGenerationMiddleware(service)(request, response, () => {});
  await new Promise((resolve) => setImmediate(resolve));
  response.destroyed = true;
  response.emit('close');
  await serving;
  assert.equal(observedAbort, true);
});
