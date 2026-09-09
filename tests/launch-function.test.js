import assert from 'node:assert/strict';
import test from 'node:test';
import { bytesToPostgresBytea, hashConnection } from '../netlify/functions/_shared/connection-hash.js';
import { deliverSpendAlerts, formatSpendAlert } from '../netlify/functions/_shared/alert-delivery.js';
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
  assert.doesNotMatch(calls[0].init.body, /test-key-never-sent-to-openai/);
  assert.deepEqual(JSON.parse(calls[0].init.body), buildBoundedOpenAIRequest(prepared.input));
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
    (error) => error.code === 'openai_request_aborted' && error.actualMicros === undefined,
  );
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
