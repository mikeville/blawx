import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToPostgresBytea, hashConnection } from '../netlify/functions/_shared/connection-hash.js';
import { deliverSpendAlerts, formatSpendAlert } from '../netlify/functions/_shared/alert-delivery.js';
import { createGenerationStatusHandler } from '../netlify/functions/_shared/generation-status-handler.js';
import { createBackgroundGenerationHandler } from '../netlify/functions/_shared/background-generation-handler.js';
import {
  backgroundGenerationTaskConfig,
  createBackgroundGenerationDispatcher,
  parseSignedGenerationTask,
  serializeGenerationTask,
  signGenerationTask,
} from '../netlify/functions/_shared/background-generation-task.js';
import {
  createPublicGenerationCacheKey,
  createPublicGenerationVersion,
} from '../netlify/functions/_shared/generation-cache.js';
import { createLaunchHandler, launchMessages } from '../netlify/functions/_shared/launch-handler.js';
import {
  buildBoundedOpenAIRequest,
  OPENAI_LAUNCH_POLICY,
  worstCaseRequestMicros,
} from '../netlify/functions/_shared/openai-budget.js';
import {
  createOpenAIProvider,
  OpenAIProviderError,
  usageCostMicros,
} from '../netlify/functions/_shared/openai-provider.js';
import { createResendNotifier } from '../netlify/functions/_shared/resend-notifier.js';
import { createSupabaseLaunchStore } from '../netlify/functions/_shared/supabase-launch-store.js';

const ORIGIN = 'https://blawx.netlify.app';
const FIXED_TIME = new Date('2026-09-09T12:00:00.000Z');
const REQUEST_ID = '00000000-0000-4000-8000-000000000001';
const TEMPLATE = 'Build one compact set.\nUSER PROMPT: placeholder';
const PROGRAM = { ops: [['b', 0, 0, 0, 2, 1, 2, 'R']] };

function openAIResponse(overrides = {}) {
  return {
    id: 'resp_test_1',
    status: 'completed',
    model: 'gpt-6-astra-2026-09-01',
    service_tier: 'default',
    output: [{
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(PROGRAM) }],
    }],
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      input_tokens_details: { cached_tokens: 20 },
    },
    ...overrides,
  };
}

function request(body = { prompt: 'a tiny lighthouse' }, headers = {}) {
  return new Request(`${ORIGIN}/api/generate`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function context(requestId = REQUEST_ID) {
  return { ip: '203.0.113.9', requestId };
}

function baseOptions(overrides = {}) {
  return {
    generationEnabled: true,
    allowedOrigins: [ORIGIN],
    connectionHasher: async () => '\\x' + '11'.repeat(32),
    now: () => FIXED_TIME,
    ...overrides,
  };
}

test('connection identifiers are stable for one UTC day and rotate the next day', async () => {
  const input = { ip: '203.0.113.9', secret: 'a'.repeat(32) };
  const first = await hashConnection({ ...input, now: new Date('2026-09-09T00:00:00Z') });
  const sameDay = await hashConnection({ ...input, now: new Date('2026-09-09T23:59:59Z') });
  const nextDay = await hashConnection({ ...input, now: new Date('2026-09-10T00:00:00Z') });

  assert.equal(first.byteLength, 32);
  assert.deepEqual(first, sameDay);
  assert.notDeepEqual(first, nextDay);
  assert.match(bytesToPostgresBytea(first), /^\\x[0-9a-f]{64}$/);
  assert.doesNotMatch(bytesToPostgresBytea(first), /203\.0\.113\.9/);
});

test('disabled handler fails closed before quota or provider work', async () => {
  let calls = 0;
  const handler = createLaunchHandler(baseOptions({
    generationEnabled: false,
    store: { reserve: async () => { calls += 1; } },
    provider: async () => { calls += 1; },
  }));
  const response = await handler(request(), context());
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error.message, launchMessages.paused);
});

test('handler rejects cross-origin and oversized requests before reservation', async () => {
  let calls = 0;
  const handler = createLaunchHandler(baseOptions({
    store: { reserve: async () => { calls += 1; } },
    provider: async () => ({}),
  }));

  const crossOrigin = await handler(request(undefined, { origin: 'https://example.com' }), context());
  assert.equal(crossOrigin.status, 403);

  const tooLong = await handler(request({ prompt: 'x'.repeat(281) }), context());
  assert.equal(tooLong.status, 400);
  assert.equal((await tooLong.json()).error.code, 'prompt-too-long');

  const oversized = await handler(request({ prompt: 'x'.repeat(5000) }), context());
  assert.equal(oversized.status, 413);
  assert.equal(calls, 0);
});

test('daily quota rejection returns friendly public copy without provider work', async () => {
  let providerCalls = 0;
  const handler = createLaunchHandler(baseOptions({
    store: { reserve: async () => ({ accepted: false, decision: 'daily_attempt_limit' }) },
    provider: async () => { providerCalls += 1; },
  }));

  const response = await handler(request(), context('quota-request'));
  const payload = await response.json();
  assert.equal(response.status, 429);
  assert.equal(payload.error.code, 'daily-limit');
  assert.equal(payload.error.message, launchMessages.quota);
  assert.equal(providerCalls, 0);
});

test('successful provider result is reserved, marked, and finalized once', async () => {
  const calls = [];
  const payload = { requestId: REQUEST_ID, prompt: 'a tiny lighthouse', model: {}, diagnostics: {}, metadata: {} };
  const store = {
    reserve: async (input) => { calls.push(['reserve', input.requestId]); return { accepted: true, decision: 'reserved' }; },
    markProviderStarted: async (input) => { calls.push(['mark', input.requestId]); return true; },
    finalize: async (input) => { calls.push(['finalize', input.outcome, input.actualMicros]); return { finalized: true, decision: 'finalized' }; },
    cancelBeforeProvider: async () => { calls.push(['cancel']); return true; },
  };
  const handler = createLaunchHandler(baseOptions({
    store,
    provider: async (prompt) => {
      calls.push(['provider', prompt]);
      return { actualMicros: 12345, resultId: 'result-1', payload };
    },
  }));

  const response = await handler(request(), context());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), payload);
  assert.deepEqual(calls, [
    ['reserve', REQUEST_ID],
    ['mark', REQUEST_ID],
    ['provider', 'a tiny lighthouse'],
    ['finalize', 'succeeded', 12345],
  ]);
});

test('launch returns a job receipt only after a true background dispatch is accepted', async () => {
  const calls = [];
  const generationVersion = 'raw-' + 'd'.repeat(64);
  const store = {
    findCachedResult: async () => null,
    reserve: async () => ({ accepted: true, decision: 'reserved' }),
    cancelBeforeProvider: async () => { throw new Error('dispatch should not be cancelled'); },
  };
  const provider = async () => { throw new Error('provider must run only in the worker'); };
  provider.prepare = async (userPrompt) => ({ input: userPrompt, userPrompt });
  const response = await createLaunchHandler(baseOptions({
    store,
    provider,
    generationVersion,
    dispatchGeneration: async (task) => { calls.push(task); },
  }))(request(), context());

  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { requestId: REQUEST_ID, status: 'pending' });
  assert.deepEqual(calls, [{ requestId: REQUEST_ID, submittedPrompt: 'a tiny lighthouse' }]);
});

test('failed background dispatch refunds the pre-provider attempt', async () => {
  const calls = [];
  const store = {
    reserve: async () => ({ accepted: true, decision: 'reserved' }),
    cancelBeforeProvider: async (input) => { calls.push(input); return true; },
  };
  const provider = async () => { throw new Error('provider must not run'); };
  provider.prepare = async (prompt) => prompt;
  const response = await createLaunchHandler(baseOptions({
    store,
    provider,
    dispatchGeneration: async () => { throw new Error('background unavailable'); },
  }))(request(), context());
  const payload = await response.json();

  assert.equal(response.status, 503);
  assert.equal(payload.error.code, 'generation-not-started');
  assert.match(payload.error.message, /not counted/i);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].failureCode, 'background_dispatch_failed');
});

test('signed background worker runs and atomically saves the reserved generation', async () => {
  const calls = [];
  const secret = 'w'.repeat(32);
  const generationVersion = 'raw-' + 'e'.repeat(64);
  const body = serializeGenerationTask({ requestId: REQUEST_ID, submittedPrompt: 'a tiny lighthouse' });
  const signature = await signGenerationTask(body, secret);
  const workerRequest = new Request(`${ORIGIN}/.netlify/functions/generation-worker`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', [backgroundGenerationTaskConfig.signatureHeader]: signature },
    body,
  });
  const store = {
    markProviderStarted: async ({ signal }) => { calls.push(['mark', signal]); return true; },
    completeGeneration: async (input) => {
      calls.push(['complete', input.requestId, input.actualMicros]);
      return {
        result_id: input.requestId,
        prompt: input.prompt,
        created_at: FIXED_TIME.toISOString(),
        raw_model: input.rawModel,
        source_program: input.sourceProgram,
        diagnostics: input.diagnostics,
        metadata: input.metadata,
      };
    },
    finalize: async () => { throw new Error('atomic completion should be used'); },
  };
  const provider = async (_prepared, { requestId, signal }) => {
    calls.push(['provider', signal]);
    return {
      actualMicros: 42000,
      resultId: 'resp-worker-1',
      payload: {
        requestId,
        prompt: 'a tiny lighthouse',
        model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: {} },
        sourceProgram: PROGRAM,
        diagnostics: { valid: true },
        metadata: { runtime: 'mock' },
      },
    };
  };
  provider.prepare = async (prompt) => ({ input: prompt, userPrompt: prompt });
  const response = await createBackgroundGenerationHandler({
    secret, store, provider, generationVersion, now: () => FIXED_TIME,
  })(workerRequest);

  assert.equal(response.status, 200);
  assert.deepEqual(calls, [
    ['mark', undefined],
    ['provider', undefined],
    ['complete', REQUEST_ID, 42000],
  ]);
});

test('background task signatures prevent public worker entry and dispatcher requires a 202 acknowledgement', async () => {
  const secret = 's'.repeat(32);
  let dispatched;
  const dispatch = createBackgroundGenerationDispatcher({
    url: `${ORIGIN}/.netlify/functions/generation-worker`,
    secret,
    fetchImpl: async (url, init) => { dispatched = { url, init }; return { status: 202 }; },
  });
  await dispatch({ requestId: REQUEST_ID, submittedPrompt: 'a tiny lighthouse' });
  assert.equal(dispatched.url.href, `${ORIGIN}/.netlify/functions/generation-worker`);
  assert.deepEqual(
    await parseSignedGenerationTask(new Request(dispatched.url, dispatched.init), secret),
    { version: 1, requestId: REQUEST_ID, prompt: 'a tiny lighthouse' },
  );
  await assert.rejects(
    parseSignedGenerationTask(new Request(dispatched.url, {
      ...dispatched.init,
      headers: { ...dispatched.init.headers, [backgroundGenerationTaskConfig.signatureHeader]: '0'.repeat(64) },
    }), secret),
    /worker_signature_invalid/,
  );
  const rejected = createBackgroundGenerationDispatcher({
    url: `${ORIGIN}/.netlify/functions/generation-worker`, secret, fetchImpl: async () => ({ status: 200 }),
  });
  await assert.rejects(rejected({ requestId: REQUEST_ID, submittedPrompt: 'a tiny lighthouse' }), /worker_dispatch_rejected/);
});

test('generation status stays pending, is connection-bound, and returns a saved result', async () => {
  const pendingStore = {
    pollGeneration: async ({ connectionHash }) => connectionHash === 'same-connection'
      ? { request_state: 'reserved', failure_code: null }
      : null,
  };
  const statusRequest = new Request(`${ORIGIN}/api/generations/${REQUEST_ID}`);
  const statusContext = { ip: '203.0.113.9', params: { id: REQUEST_ID } };
  const pendingHandler = createGenerationStatusHandler({
    store: pendingStore,
    connectionHasher: async () => 'same-connection',
    now: () => FIXED_TIME,
  });
  const pending = await pendingHandler(statusRequest, statusContext);
  assert.equal(pending.status, 202);
  assert.deepEqual(await pending.json(), { requestId: REQUEST_ID, status: 'pending' });

  const hidden = await createGenerationStatusHandler({
    store: pendingStore,
    connectionHasher: async () => 'another-connection',
  })(statusRequest, statusContext);
  assert.equal(hidden.status, 404);

  const completed = await createGenerationStatusHandler({
    store: {
      pollGeneration: async () => ({
        request_state: 'succeeded',
        failure_code: null,
        result_id: REQUEST_ID,
        prompt: 'wacky pipe organ',
        created_at: FIXED_TIME.toISOString(),
        raw_model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: {} },
        diagnostics: { valid: true },
        metadata: { runtime: 'mock' },
      }),
    },
    connectionHasher: async () => 'same-connection',
  })(statusRequest, statusContext);
  assert.equal(completed.status, 200);
  const payload = await completed.json();
  assert.equal(payload.resultId, REQUEST_ID);
  assert.equal(payload.prompt, 'wacky pipe organ');
  assert.equal(payload.sourceProgram, undefined);
});

test('generation status reports durable provider failure states with specific copy', async () => {
  const requestForStatus = new Request(`${ORIGIN}/api/generations/${REQUEST_ID}`);
  const handler = createGenerationStatusHandler({
    store: { pollGeneration: async () => ({ request_state: 'failed', failure_code: 'provider_invalid' }) },
    connectionHasher: async () => 'same-connection',
  });
  const response = await handler(requestForStatus, { ip: '203.0.113.9', params: { id: REQUEST_ID } });
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.error.code, 'generation-invalid');
  assert.match(payload.error.message, /brick plan.*attempt counted/i);
});

test('unknown provider usage is finalized fail-closed at the database reservation', async () => {
  const calls = [];
  const store = {
    reserve: async () => ({ accepted: true, decision: 'reserved' }),
    markProviderStarted: async () => true,
    finalize: async (input) => { calls.push(input); return { finalized: true, decision: 'finalized' }; },
    cancelBeforeProvider: async () => { throw new Error('should not cancel after provider entry'); },
  };
  const handler = createLaunchHandler(baseOptions({
    store,
    provider: async () => { throw new Error('network disappeared'); },
  }));

  const response = await handler(request(), context('unknown-usage'));
  assert.equal(response.status, 502);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].outcome, 'unknown');
  assert.equal(calls[0].actualMicros, null);
  assert.equal(calls[0].failureCode, 'provider_usage_unknown');
});

test('Supabase adapter uses the secret only as an API header and calls the exact RPC', async () => {
  const seen = [];
  const store = createSupabaseLaunchStore({
    projectUrl: 'https://project-ref.supabase.co/path-is-ignored',
    secretKey: 'server-secret',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return new Response(JSON.stringify([{ accepted: true, decision: 'reserved' }]), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  const result = await store.reserve({
    requestId: 'request-1',
    connectionHash: '\\x' + '11'.repeat(32),
    now: FIXED_TIME,
  });
  assert.equal(result.accepted, true);
  assert.equal(seen[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/blawx_reserve_generation');
  assert.equal(seen[0].init.headers.apikey, 'server-secret');
  assert.equal(seen[0].init.headers.authorization, undefined);
  assert.doesNotMatch(seen[0].init.body, /server-secret/);
});

test('Supabase adapter completes and polls deferred generations through bounded RPCs', async () => {
  const seen = [];
  const store = createSupabaseLaunchStore({
    projectUrl: 'https://project-ref.supabase.co',
    secretKey: 'server-secret',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      seen.push({ url, body });
      if (url.endsWith('/blawx_complete_generation')) {
        return new Response(JSON.stringify([{
          result_id: REQUEST_ID,
          prompt: 'pipe organ',
          created_at: FIXED_TIME.toISOString(),
          raw_model: { version: 1 },
          source_program: PROGRAM,
          diagnostics: {},
          metadata: {},
        }]), { status: 200 });
      }
      return new Response(JSON.stringify([{ request_state: 'reserved', failure_code: null }]), { status: 200 });
    },
  });

  const saved = await store.completeGeneration({
    requestId: REQUEST_ID,
    actualMicros: 1234,
    cacheKey: 'a'.repeat(64),
    generationVersion: 'raw-v1',
    normalizedPrompt: 'pipe organ',
    prompt: 'pipe organ',
    rawModel: { version: 1 },
    sourceProgram: PROGRAM,
    diagnostics: {},
    metadata: {},
    providerResultId: 'resp-1',
    now: FIXED_TIME,
  });
  assert.equal(saved.result_id, REQUEST_ID);
  assert.equal(seen[0].body.p_actual_micros, 1234);
  assert.equal(seen[0].body.p_now, FIXED_TIME.toISOString());

  const polled = await store.pollGeneration({ requestId: REQUEST_ID, connectionHash: '\\x' + '11'.repeat(32) });
  assert.equal(polled.request_state, 'reserved');
  assert.equal(seen[1].url, 'https://project-ref.supabase.co/rest/v1/rpc/blawx_poll_generation');
  assert.deepEqual(seen[1].body, {
    p_request_id: REQUEST_ID,
    p_connection_hash: '\\x' + '11'.repeat(32),
  });
});

test('OpenAI launch request is fixed, tool-free, and cannot exceed the database reservation', () => {
  assert.equal(worstCaseRequestMicros(), 187500);
  assert.equal(worstCaseRequestMicros() <= OPENAI_LAUNCH_POLICY.requestReserveMicros, true);
  assert.deepEqual(buildBoundedOpenAIRequest('bounded prompt'), {
    model: 'gpt-6-astra',
    reasoning: { effort: 'low' },
    service_tier: 'default',
    max_output_tokens: 2000,
    store: false,
    tools: [],
    input: 'bounded prompt',
  });
  assert.throws(
    () => buildBoundedOpenAIRequest('x'.repeat(OPENAI_LAUNCH_POLICY.maxInputBytes + 1)),
    /openai_input_too_large/,
  );
});

test('OpenAI usage accounting handles uncached, cached, cache-write, and output tokens', () => {
  assert.equal(usageCostMicros({
    input_tokens: 110,
    output_tokens: 50,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 10 },
  }), 3445);
  assert.throws(
    () => usageCostMicros({ input_tokens: 10, output_tokens: 1, input_tokens_details: { cached_tokens: 11 } }),
    OpenAIProviderError,
  );
});

test('OpenAI provider performs exactly one bounded request and returns a validated model', async () => {
  const calls = [];
  const provider = createOpenAIProvider({
    apiKey: 'test-key-never-sent-to-openai',
    promptTemplate: TEMPLATE,
    nowMs: (() => { let time = 1000; return () => (time += 25); })(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(openAIResponse()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const prepared = await provider.prepare('a tiny lighthouse');
  const result = await provider(prepared, { requestId: 'request-openai-1' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/responses');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.authorization, 'Bearer test-key-never-sent-to-openai');
  assert.equal(calls[0].init.headers['idempotency-key'], 'request-openai-1');
  assert.doesNotMatch(calls[0].init.body, /test-key-never-sent-to-openai/);
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    ...buildBoundedOpenAIRequest(prepared.input),
    background: true,
  });
  assert.equal(result.actualMicros, 3320);
  assert.equal(result.resultId, 'resp_test_1');
  assert.equal(result.payload.requestId, 'request-openai-1');
  assert.equal(result.payload.prompt, 'a tiny lighthouse');
  assert.deepEqual(result.payload.sourceProgram, PROGRAM);
  assert.equal(result.payload.model.cells.length, 4);
  assert.equal(result.payload.diagnostics.valid, true);
  assert.equal(result.payload.metadata.requestCount, 1);
  assert.equal(result.payload.metadata.retries, 0);
});

test('OpenAI provider retrieves one acknowledged background response without another model attempt', async () => {
  const calls = [];
  const provider = createOpenAIProvider({
    apiKey: 'test-key',
    promptTemplate: TEMPLATE,
    pollIntervalMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const payload = calls.length === 1
        ? openAIResponse({ status: 'queued', output: [], usage: null })
        : openAIResponse();
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });

  const result = await provider(await provider.prepare('pipe organ'), { requestId: 'request-background-1' });
  assert.equal(result.resultId, 'resp_test_1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(JSON.parse(calls[0].init.body).background, true);
  assert.equal(calls[1].url, 'https://api.openai.com/v1/responses/resp_test_1');
  assert.equal(calls[1].init.method, 'GET');
});

test('OpenAI provider tolerates a transient retrieval failure without repeating the model request', async () => {
  const calls = [];
  const provider = createOpenAIProvider({
    apiKey: 'test-key',
    promptTemplate: TEMPLATE,
    pollIntervalMs: 0,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (calls.length === 1) {
        return new Response(JSON.stringify(openAIResponse({ status: 'in_progress', output: [], usage: null })), { status: 200 });
      }
      if (calls.length === 2) {
        return new Response(JSON.stringify({ error: { code: 'server_error' } }), { status: 503 });
      }
      return new Response(JSON.stringify(openAIResponse()), { status: 200 });
    },
  });

  const result = await provider(await provider.prepare('roller coaster'), { requestId: 'request-background-2' });
  assert.equal(result.payload.prompt, 'roller coaster');
  assert.equal(calls.filter(({ init }) => init.method === 'POST').length, 1);
  assert.equal(calls.filter(({ init }) => init.method === 'GET').length, 2);
});

test('OpenAI provider never retries an HTTP rejection', async () => {
  let calls = 0;
  const provider = createOpenAIProvider({
    apiKey: 'test-key',
    promptTemplate: TEMPLATE,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify(openAIResponse()), { status: 429 });
    },
  });
  const prepared = await provider.prepare('a tiny lighthouse');
  await assert.rejects(
    provider(prepared, { requestId: 'request-openai-429' }),
    (error) => error.code === 'openai_http_failure' && error.actualMicros === 3320,
  );
  assert.equal(calls, 1);
});

test('OpenAI provider fails closed when usage is missing and preserves known usage on invalid output', async () => {
  const responses = [
    openAIResponse({ usage: undefined }),
    openAIResponse({
      output: [{
        type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"ops":[]}' }],
      }],
    }),
  ];
  const provider = createOpenAIProvider({
    apiKey: 'test-key',
    promptTemplate: TEMPLATE,
    fetchImpl: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }),
  });
  const prepared = await provider.prepare('a tiny lighthouse');

  await assert.rejects(
    provider(prepared, { requestId: 'missing-usage' }),
    (error) => error.code === 'openai_usage_unknown' && error.actualMicros === undefined,
  );
  await assert.rejects(
    provider(prepared, { requestId: 'invalid-program' }),
    (error) => error.code === 'openai_program_invalid' && error.actualMicros === 3320,
  );
});

test('OpenAI provider rejects oversized responses and aborts at its deadline', async () => {
  const tinyPolicy = { ...OPENAI_LAUNCH_POLICY, maxResponseBytes: 10, timeoutMs: 10 };
  const oversized = createOpenAIProvider({
    apiKey: 'test-key', promptTemplate: TEMPLATE, policy: tinyPolicy,
    fetchImpl: async () => new Response('01234567890', { status: 200, headers: { 'content-length': '11' } }),
  });
  await assert.rejects(
    oversized(await oversized.prepare('cat'), { requestId: 'oversized' }),
    (error) => error.code === 'openai_response_too_large',
  );

  const timeoutPolicy = { ...OPENAI_LAUNCH_POLICY, timeoutMs: 5 };
  const timedOut = createOpenAIProvider({
    apiKey: 'test-key', promptTemplate: TEMPLATE, policy: timeoutPolicy,
    fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }),
  });
  await assert.rejects(
    timedOut(await timedOut.prepare('cat'), { requestId: 'timeout' }),
    (error) => error.code === 'openai_timeout' && error.actualMicros === undefined,
  );

  let cancelled = false;
  const stuckBody = createOpenAIProvider({
    apiKey: 'test-key', promptTemplate: TEMPLATE, policy: timeoutPolicy,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: {
        getReader: () => ({
          read: () => new Promise(() => {}),
          cancel: async () => { cancelled = true; },
        }),
      },
    }),
  });
  await assert.rejects(
    stuckBody(await stuckBody.prepare('cat'), { requestId: 'stuck-body' }),
    (error) => error.code === 'openai_timeout',
  );
  assert.equal(cancelled, true);
});

test('provider prompt preparation happens before any quota reservation', async () => {
  const calls = [];
  const provider = async () => { calls.push('provider'); };
  provider.prepare = async () => {
    const error = new Error('too_large');
    error.publicStatus = 400;
    throw error;
  };
  const handler = createLaunchHandler(baseOptions({
    store: { reserve: async () => { calls.push('reserve'); } },
    provider,
  }));

  const response = await handler(request(), context('preflight'));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error.code, 'prompt-too-complex');
  assert.deepEqual(calls, []);
});

test('provider failures distinguish timeout, invalid plan, and interrupted transport for the user', async () => {
  for (const [providerCode, publicCode, status, messagePattern] of [
    ['openai_timeout', 'generation-timeout', 504, /did not finish.*attempt counted/i],
    ['openai_program_invalid', 'generation-invalid', 502, /brick plan.*attempt counted/i],
    ['openai_network_failure', 'generation-interrupted', 502, /connection.*attempt counted/i],
  ]) {
    const store = {
      reserve: async () => ({ accepted: true, decision: 'reserved' }),
      markProviderStarted: async () => true,
      finalize: async () => ({ finalized: true, decision: 'finalized' }),
    };
    const provider = async () => {
      const error = new Error(providerCode);
      error.code = providerCode;
      if (providerCode === 'openai_program_invalid') error.actualMicros = 1234;
      throw error;
    };
    const response = await createLaunchHandler(baseOptions({ store, provider }))(request(), context());
    const payload = await response.json();
    assert.equal(response.status, status);
    assert.equal(payload.error.code, publicCode);
    assert.match(payload.error.message, messagePattern);
    assert.equal(payload.requestId, REQUEST_ID);
  }
});

test('spend alert delivery claims once, uses idempotency keys, and acknowledges each result', async () => {
  const claimToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const alerts = [
    {
      id: 1,
      alert_key: 'spend_threshold:day:2099-05-17:95',
      alert_kind: 'spend_threshold',
      threshold_percent: 95,
      period_kind: 'day',
      period_start: '2099-05-17',
      amount_micros: 190_000_000,
      cap_micros: 200_000_000,
      delivery_attempts: 1,
    },
    {
      id: 2,
      alert_key: 'usage_unknown:00000000-0000-0000-0000-000000000001',
      alert_kind: 'usage_unknown',
      threshold_percent: null,
      period_kind: 'day',
      period_start: '2099-05-17',
      amount_micros: 200_000,
      cap_micros: 200_000_000,
      delivery_attempts: 1,
    },
  ];
  const calls = [];
  const store = {
    claimAlerts: async (input) => { calls.push(['claim', input.claimToken, input.limit]); return alerts; },
    finishAlert: async (input) => { calls.push(['finish', input.id, input.sent, input.failureCode]); return true; },
  };
  const notifier = {
    send: async (message) => {
      calls.push(['send', message.idempotencyKey, message.severity]);
      if (message.idempotencyKey.startsWith('usage_unknown')) {
        const error = new Error('provider details stay private');
        error.code = 'Provider.Timeout';
        throw error;
      }
    },
  };

  const summary = await deliverSpendAlerts({ store, notifier, claimToken, limit: 2, now: () => FIXED_TIME });
  assert.deepEqual(summary, { claimed: 2, sent: 1, failed: 1 });
  assert.deepEqual(calls, [
    ['claim', claimToken, 2],
    ['send', alerts[0].alert_key, 'critical'],
    ['finish', 1, true, null],
    ['send', alerts[1].alert_key, 'critical'],
    ['finish', 2, false, 'provider_timeout'],
  ]);
  assert.doesNotMatch(formatSpendAlert(alerts[1]).text, /00000000|usage_unknown/);
});

test('Resend notifier sends a bounded idempotent text email without exposing configuration', async () => {
  const calls = [];
  const notifier = createResendNotifier({
    apiKey: 're_private',
    from: 'Blawx Alerts <alerts@example.com>',
    to: 'owner@example.com',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    },
  });
  await notifier.send({
    subject: 'Blawx daily spend reached 95%',
    text: 'Blawx has reserved or recorded $190.00.',
    idempotencyKey: 'spend_threshold:day:2099-05-17:95',
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.resend.com/emails');
  assert.equal(calls[0].init.headers.authorization, 'Bearer re_private');
  assert.equal(calls[0].init.headers['idempotency-key'], 'spend_threshold:day:2099-05-17:95');
  assert.equal(calls[0].init.headers['user-agent'], 'blawx-spend-alerts/1.0');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    from: 'Blawx Alerts <alerts@example.com>',
    to: ['owner@example.com'],
    subject: 'Blawx daily spend reached 95%',
    text: 'Blawx has reserved or recorded $190.00.',
  });
});

test('Resend notifier rejects header injection and reports provider failures safely', async () => {
  assert.throws(() => createResendNotifier({
    apiKey: 're_private', from: 'alerts@example.com\r\nBcc: attacker@example.com', to: 'owner@example.com',
  }), /resend_from_invalid/);
  const notifier = createResendNotifier({
    apiKey: 're_private', from: 'alerts@example.com', to: 'owner@example.com',
    fetchImpl: async () => new Response('{}', { status: 429 }),
  });
  await assert.rejects(
    notifier.send({ subject: 'Alert', text: 'Spend alert.', idempotencyKey: 'alert-1' }),
    error => error.code === 'resend_http_429' && !String(error).includes('re_private'),
  );
});

test('Supabase alert adapter calls only the exact claim and acknowledgement RPCs', async () => {
  const seen = [];
  const store = createSupabaseLaunchStore({
    projectUrl: 'https://project-ref.supabase.co',
    secretKey: 'server-secret',
    fetchImpl: async (url, init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      const payload = url.endsWith('/blawx_claim_spend_alerts') ? [] : true;
      return new Response(JSON.stringify(payload), { status: 200 });
    },
  });
  const claimToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.deepEqual(await store.claimAlerts({ claimToken, now: FIXED_TIME, limit: 5 }), []);
  assert.equal(await store.finishAlert({
    id: 7, claimToken, sent: false, failureCode: 'notification_failed', now: FIXED_TIME,
  }), true);
  assert.equal(seen[0].url, 'https://project-ref.supabase.co/rest/v1/rpc/blawx_claim_spend_alerts');
  assert.deepEqual(seen[0].body, {
    p_claim_token: claimToken,
    p_now: FIXED_TIME.toISOString(),
    p_limit: 5,
  });
  assert.equal(seen[1].url, 'https://project-ref.supabase.co/rest/v1/rpc/blawx_finish_spend_alert');
  assert.equal(seen[1].body.p_failure_code, 'notification_failed');
});

test('generation cache identity includes the exact prompt template and fixed provider policy', async () => {
  const firstVersion = await createPublicGenerationVersion({
    promptTemplate: TEMPLATE,
    policy: OPENAI_LAUNCH_POLICY,
  });
  const sameVersion = await createPublicGenerationVersion({
    promptTemplate: TEMPLATE,
    policy: { ...OPENAI_LAUNCH_POLICY },
  });
  const changedVersion = await createPublicGenerationVersion({
    promptTemplate: `${TEMPLATE}\nChanged`,
    policy: OPENAI_LAUNCH_POLICY,
  });
  assert.equal(firstVersion, sameVersion);
  assert.notEqual(firstVersion, changedVersion);
  assert.equal(firstVersion.length, 68);
  assert.equal(
    await createPublicGenerationCacheKey({ prompt: '  Tiny   LIGHTHOUSE ', generationVersion: firstVersion }),
    await createPublicGenerationCacheKey({ prompt: 'tiny lighthouse', generationVersion: firstVersion }),
  );
  assert.notEqual(
    await createPublicGenerationCacheKey({ prompt: 'tiny lighthouse', generationVersion: firstVersion }),
    await createPublicGenerationCacheKey({ prompt: 'tiny lighthouse', generationVersion: changedVersion }),
  );
});

test('an exact durable cache hit bypasses kill switches, quota, and provider work', async () => {
  const calls = [];
  const generationVersion = 'raw-' + 'a'.repeat(64);
  const cacheKey = await createPublicGenerationCacheKey({ prompt: 'a tiny lighthouse', generationVersion });
  const handler = createLaunchHandler(baseOptions({
    generationEnabled: false,
    generationVersion,
    store: {
      findCachedResult: async (input) => {
        calls.push(['cache', input.cacheKey]);
        return {
          result_id: REQUEST_ID,
          prompt: 'A tiny lighthouse',
          created_at: FIXED_TIME.toISOString(),
          raw_model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: {} },
          source_program: PROGRAM,
          diagnostics: { valid: true },
          metadata: { actualModel: 'gpt-6-astra-test' },
        };
      },
      reserve: async () => { calls.push(['reserve']); },
    },
    provider: async () => { calls.push(['provider']); },
  }));

  const response = await handler(request(), context());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.cacheHit, true);
  assert.equal(payload.resultId, REQUEST_ID);
  assert.equal(payload.sourceProgram, undefined);
  assert.equal(payload.metadata.runtime, 'saved-result-cache');
  assert.deepEqual(calls, [['cache', cacheKey]]);
});

test('fresh generation finalizes spend before durable save and remains usable if saving fails', async () => {
  const generationVersion = 'raw-' + 'b'.repeat(64);
  const calls = [];
  const store = {
    findCachedResult: async () => null,
    reserve: async () => ({ accepted: true, decision: 'reserved' }),
    markProviderStarted: async () => true,
    finalize: async (input) => {
      calls.push(['finalize', input.resultId]);
      return { finalized: true, decision: 'finalized' };
    },
    saveGenerationResult: async (input) => {
      calls.push(['save', input.resultId, input.providerResultId]);
      throw new Error('database unavailable after safe accounting');
    },
  };
  const provider = async (_prepared, { requestId }) => ({
    actualMicros: 1234,
    resultId: 'resp-provider-1',
    payload: {
      requestId,
      prompt: 'a tiny lighthouse',
      model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }], meta: {} },
      sourceProgram: PROGRAM,
      diagnostics: { valid: true },
      metadata: { runtime: 'mock' },
    },
  });
  provider.prepare = async (userPrompt) => ({ input: userPrompt, userPrompt });
  const handler = createLaunchHandler(baseOptions({ store, provider, generationVersion }));

  const response = await handler(request(), context());
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.saveStatus, 'failed');
  assert.equal(payload.resultId, null);
  assert.equal(payload.sourceProgram, undefined);
  assert.deepEqual(calls, [
    ['finalize', REQUEST_ID],
    ['save', REQUEST_ID, 'resp-provider-1'],
  ]);
});
