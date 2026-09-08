import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BASE_URL, LIMITS, TRELLIS_PROBE_PLAN, createAuthenticatedFetch, parseGradioQueueSse, runCli, runTrellisProbe, validateOutputUrl } from '../scripts/run-trellis-probe.mjs';

const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.from('test-image')]);
const digest = createHash('sha256').update(png).digest('hex');
const inspector = async () => ({ format: 'PNG', width: 512, height: 512, hasAlpha: true, alphaMin: 0 });

async function fixture(overrides = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'trellis-probe-'));
  const imagePath = join(rootDir, 'cat.png');
  const imageRecordPath = join(rootDir, 'image-record.json');
  await writeFile(imagePath, overrides.image ?? png);
  await writeFile(imageRecordPath, JSON.stringify({ prompt: 'A friendly LEGO-like cat', source: 'subscription image generation', imageSha256: digest, imageGenerationMs: 1234, ...overrides.record }));
  return { rootDir, dataRoot: join(rootDir, 'private-data'), allowTestDataRoot: true, imagePath, imageRecordPath };
}

function sse(value, event = 'complete') { return `event: ${event}\ndata: ${JSON.stringify(value)}\n\n`; }
function queueSse(eventId, data, overrides = {}) {
  return `data: ${JSON.stringify({ msg: 'estimation', rank: 0 })}\n\ndata: ${JSON.stringify({ msg: 'process_starts', event_id: eventId })}\n\ndata: ${JSON.stringify({ msg: 'process_completed', event_id: eventId, success: true, output: { data }, ...overrides })}\n\ndata: ${JSON.stringify({ msg: 'close_stream' })}\n\n`;
}
function response(body, status = 200) { return new Response(typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body), { status }); }

function successfulFetch(log) {
  const ids = ['start', 'pre', 'infer', 'export']; let submitted = 0; let currentId;
  const outputs = {
    start: [],
    pre: [{ path: '/tmp/pre.png', url: `${BASE_URL}/gradio_api/file=/tmp/pre.png`, meta: { _type: 'gradio.FileData' } }],
    infer: [null, '<div>preview only</div>'],
    export: [null, { path: '/tmp/result.glb', url: `${BASE_URL}/gradio_api/file=/tmp/result.glb`, meta: { _type: 'gradio.FileData' } }],
  };
  return async (url, options) => {
    log.push({ url, options });
    if (url.endsWith('/upload')) return response(['/tmp/gradio/input.png']);
    if (url.includes('/gradio_api/file=')) return response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]));
    if (options.method === 'POST') { currentId = ids[submitted++]; return response({ event_id: currentId }); }
    if (url.includes('/queue/data?')) return response(queueSse(currentId, outputs[currentId]));
    throw new Error(`Unexpected URL ${url}`);
  };
}

test('dry run is fixed, creates no files, and performs no run', async () => {
  let calls = 0; const output = [];
  await runCli({ args: ['--dry-run'], run: async () => { calls += 1; }, log: (line) => output.push(JSON.parse(line)) });
  assert.equal(calls, 0);
  assert.deepEqual(output[0], { ...TRELLIS_PROBE_PLAN, authMode: 'anonymous' });
  assert.equal(output[0].retries, 0);
});

test('authenticated mode sends one bearer token to every fixed-origin request', async () => {
  const paths = await fixture(); const calls = []; const token = 'hf_testToken123456789';
  const { outcome, runDir } = await runTrellisProbe({ ...paths, authenticated: true, hfToken: token, fetchImpl: successfulFetch(calls), imageInspector: inspector });
  assert.equal(outcome.status, 'downloaded-glb');
  assert.equal(outcome.authMode, 'huggingface-token');
  assert.equal(outcome.providerCost.amountUsd, null);
  assert.match(outcome.providerCost.basis, /unreported/);
  assert.equal(calls.length, 10);
  for (const call of calls) {
    assert.equal(new Headers(call.options.headers).get('authorization'), `Bearer ${token}`);
    assert.equal(call.options.redirect, 'error');
    assert.equal(new URL(call.url).origin, new URL(BASE_URL).origin);
  }
  assert.equal((await readFile(join(runDir, 'plan.json'), 'utf8')).includes(token), false);
});

test('authenticated fetch rejects external origins without exposing the token', async () => {
  const token = 'hf_testToken123456789'; let calls = 0;
  const fetchImpl = createAuthenticatedFetch(async () => { calls += 1; }, token);
  await assert.rejects(fetchImpl('https://evil.invalid/file', {}), /Refusing to send HF_TOKEN/);
  assert.equal(calls, 0);
});

test('authenticated CLI requires a valid token before running and dry-run loads no secrets', async () => {
  let runs = 0; let reads = 0;
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  await assert.rejects(runCli({ args: ['--authenticated', '--live', '--max-sessions=1', '--image', 'x.png', '--image-record', 'x.json'], env: {}, readFileImpl: async () => { reads += 1; throw missing; }, run: async () => { runs += 1; } }), /requires HF_TOKEN/);
  assert.equal(runs, 0); assert.equal(reads, 1);
  await runCli({ args: ['--authenticated', '--dry-run'], env: {}, readFileImpl: async () => { reads += 1; throw missing; }, run: async () => { runs += 1; }, log: () => {} });
  assert.equal(runs, 0); assert.equal(reads, 1);
});

test('authenticated failures redact the exact token from every artifact and outcome', async () => {
  const paths = await fixture(); const token = 'hf_secretToken123456789';
  const { outcome, runDir } = await runTrellisProbe({ ...paths, authenticated: true, hfToken: token, imageInspector: inspector, fetchImpl: async () => { throw new Error(`provider echoed ${token}`); } });
  assert.equal(outcome.status, 'failed'); assert.equal(JSON.stringify(outcome).includes(token), false);
  for (const name of await readdir(runDir)) {
    const contents = await readFile(join(runDir, name));
    assert.equal(contents.includes(Buffer.from(token)), false, name);
  }
});

test('successful state flow uses one session and exact request settings', async () => {
  const paths = await fixture(); const calls = [];
  const { outcome, runDir } = await runTrellisProbe({ ...paths, fetchImpl: successfulFetch(calls), imageInspector: inspector, uuid: (() => { const values = ['session-uuid', 'run-uuid']; return () => values.shift(); })() });
  assert.equal(outcome.status, 'downloaded-glb');
  assert.equal(outcome.requestCount, 10);
  assert.equal(outcome.retries, 0);
  assert.deepEqual(outcome.eventIds, { start_session: 'start', preprocess_image: 'pre', image_to_3d: 'infer', extract_glb: 'export' });
  const posts = calls.filter((call) => call.url.includes('/call/') && call.options.method === 'POST').map((call) => JSON.parse(call.options.body));
  assert.equal(posts.length, 4);
  assert.ok(posts.every(({ session_hash }) => session_hash === 'session-uuid'));
  assert.deepEqual(posts[0].data, []);
  assert.deepEqual(posts[2].data.slice(1), [0, '512', 7.5, 0.7, 12, 5, 7.5, 0.5, 12, 3, 1, 0, 12, 3]);
  assert.deepEqual(posts[3].data, [null, 100000, 1024]);
  const queueUrls = calls.filter(({ url }) => url.includes('/queue/data?')).map(({ url }) => url);
  assert.deepEqual(queueUrls, Array(4).fill(`${BASE_URL}/gradio_api/queue/data?session_hash=session-uuid`));
  assert.equal((await readdir(runDir)).filter((name) => name === 'result.glb').length, 1);
  assert.equal((await readFile(join(runDir, 'image_to_3d-events.txt'), 'utf8')).includes('<div>preview only</div>'), true);
  assert.equal(outcome.imagePlusProbeMs, outcome.imageGenerationMs + outcome.probeThroughDownloadMs);
});

test('duplicate TRELLIS run IDs preserve the first receipt and make no second request', async () => {
  const paths = await fixture();
  const calls = [];
  const values = ['session-one', 'duplicate', 'session-two', 'duplicate'];
  const options = {
    ...paths,
    fetchImpl: successfulFetch(calls),
    imageInspector: inspector,
    now: () => new Date('2026-09-07T12:00:00.000Z'),
    uuid: () => values.shift(),
  };
  const first = await runTrellisProbe(options);
  const original = await readFile(join(first.runDir, 'outcome.json'));
  await assert.rejects(runTrellisProbe(options), (error) => error?.code === 'EEXIST');
  assert.equal(calls.length, 10);
  assert.deepEqual(await readFile(join(first.runDir, 'outcome.json')), original);
});

test('fragmented queue SSE and status messages select the exact completion target', () => {
  const parsed = parseGradioQueueSse('data: {"msg":"heartbeat"}\n\ndata: {"msg":"estimation"}\n\ndata: {"msg":"process_starts"}\n\ndata: {"msg":"process_completed",\ndata: "event_id":"target","success":true,"output":{"data":[{"ok":true}]}}\n\ndata: {"msg":"close_stream"}\n\n', 'target');
  assert.deepEqual(parsed.data, [{ ok: true }]);
  assert.throws(() => parseGradioQueueSse(queueSse('other', []), 'target'), /event_id mismatch/);
  assert.throws(() => parseGradioQueueSse('data: {"msg":"close_stream"}\n\n', 'target'), /without process_completed/);
  assert.throws(() => parseGradioQueueSse(`data: ${JSON.stringify({ msg: 'process_completed', event_id: 'target', success: false, output: { error: 'quota exhausted' } })}\n\n`, 'target'), /quota exhausted/);
});

test('HTTP quota failure is recorded with no retry', async () => {
  const paths = await fixture(); let calls = 0;
  const { outcome } = await runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl: async () => { calls += 1; return response('quota', 429); } });
  assert.equal(calls, 1); assert.equal(outcome.requestCount, 1); assert.equal(outcome.retries, 0); assert.equal(outcome.failure.httpStatus, 429);
});

test('hanging event stream hits deadline and preserves partial bytes with unknown remote status', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const paths = await fixture(); let calls = 0;
  let streamReadyResolve;
  const streamReady = new Promise((resolve) => { streamReadyResolve = resolve; });
  const fetchImpl = async (_url, options) => {
    calls += 1;
    if (options.method === 'POST') return response({ event_id: 'hanging' });
    const prefix = new TextEncoder().encode('event: heartbeat\n\n'); let sent = false;
    return { ok: true, status: 200, body: { getReader: () => ({ read: async () => {
      if (!sent) { sent = true; return { done: false, value: prefix }; }
      streamReadyResolve();
      return new Promise(() => {});
    }, cancel: async () => {} }) } };
  };
  const running = runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl, stageMs: 10, globalMs: 100 });
  await streamReady;
  assert.equal(calls, 2);
  t.mock.timers.tick(10);
  const { outcome, runDir } = await running;
  assert.equal(calls, 2); assert.match(outcome.failure.remoteStatus, /unknown/);
  assert.equal(await readFile(join(runDir, 'start_session-events-partial.txt'), 'utf8'), 'event: heartbeat\n\n');
});

test('preprocess and export reject arbitrary provider URLs before fetching them', async () => {
  for (const badStage of ['pre', 'export']) {
    const paths = await fixture(); const calls = [];
    const base = successfulFetch(calls);
    let queueGets = 0;
    const fetchImpl = async (url, options) => {
      if (url.includes('/queue/data?')) {
        queueGets += 1;
        const targetIndex = badStage === 'pre' ? 2 : 4;
        if (queueGets === targetIndex) return response(queueSse(badStage, [{ url: 'https://evil.invalid/file.glb' }]));
      }
      return base(url, options);
    };
    const { outcome } = await runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl });
    assert.equal(outcome.status, 'failed'); assert.match(outcome.failure.message, /Rejected/); assert.equal(calls.some(({ url }) => url.startsWith('https://evil.invalid')), false);
  }
  assert.throws(() => validateOutputUrl([{ url: 'https://evil.invalid/x' }]), /Rejected output URL/);
});

test('response and GLB caps fail without retries', async () => {
  const paths = await fixture(); let calls = 0;
  const fetchImpl = async (_url, options) => { calls += 1; if (options.method === 'POST') return response(new Uint8Array(LIMITS.response + 1)); throw new Error('unexpected'); };
  const { outcome } = await runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl });
  assert.equal(calls, 1); assert.match(outcome.failure.message, /exceeds/); assert.equal(outcome.retries, 0);

  const glbPaths = await fixture(); const log = []; const base = successfulFetch(log);
  const oversizedGlb = new Uint8Array(LIMITS.glb + 1);
  const glbResult = await runTrellisProbe({ ...glbPaths, imageInspector: inspector, fetchImpl: async (url, options) => url.includes('/gradio_api/file=') && url.endsWith('result.glb') ? response(oversizedGlb) : base(url, options) });
  assert.equal(glbResult.outcome.status, 'failed'); assert.match(glbResult.outcome.failure.message, /exceeds/);
  assert.equal((await readFile(join(glbResult.runDir, 'result-partial.glb'))).byteLength, LIMITS.glb);
});

test('header wait obeys the stage deadline even when fetch ignores abort', async () => {
  const paths = await fixture();
  const { outcome } = await runTrellisProbe({ ...paths, imageInspector: inspector, stageMs: 10, globalMs: 100, fetchImpl: async () => new Promise(() => {}) });
  assert.equal(outcome.requestCount, 1); assert.match(outcome.failure.message, /deadline exceeded/);
});

test('malformed upload paths are rejected before preprocessing', async () => {
  const paths = await fixture(); const log = []; const base = successfulFetch(log);
  const { outcome } = await runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl: async (url, options) => url.endsWith('/upload') ? response(['//evil.invalid/file.png']) : base(url, options) });
  assert.equal(outcome.status, 'failed'); assert.match(outcome.failure.message, /protocol-relative/);
  assert.equal(log.some(({ url }) => url.includes('/preprocess_image')), false);
});

test('bad image and provenance fail before run directory and network', async () => {
  for (const mutate of [
    { record: { prompt: '' } },
    { record: { imageSha256: '0'.repeat(64) } },
    { record: { imageGenerationMs: -1 } },
  ]) {
    const paths = await fixture(mutate); let calls = 0;
    await assert.rejects(runTrellisProbe({ ...paths, imageInspector: inspector, fetchImpl: async () => { calls += 1; } }));
    assert.equal(calls, 0);
    await assert.rejects(readdir(join(paths.rootDir, 'experiments')));
  }
  const paths = await fixture(); let calls = 0;
  await assert.rejects(runTrellisProbe({ ...paths, imageInspector: async () => ({ format: 'PNG', width: 512, height: 512, hasAlpha: true, alphaMin: 255 }), fetchImpl: async () => { calls += 1; } }), /actual transparency/);
  assert.equal(calls, 0); await assert.rejects(readdir(join(paths.rootDir, 'experiments')));

  const largeDimensions = await fixture();
  await assert.rejects(runTrellisProbe({ ...largeDimensions, imageInspector: async () => ({ format: 'PNG', width: 5000, height: 1, hasAlpha: true, alphaMin: 0 }), fetchImpl: async () => { throw new Error('network must not run'); } }), /dimensions exceed/);
  await assert.rejects(readdir(join(largeDimensions.rootDir, 'experiments')));
});
