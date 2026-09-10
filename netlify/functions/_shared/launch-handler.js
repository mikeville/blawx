import { MAX_PROMPT_CHARACTERS, PROMPT_TOO_LONG_MESSAGE } from '../../../src/prompt-policy.js';
import { createPublicGenerationCacheKey, normalizeGenerationPrompt } from './generation-cache.js';
import { validateVoxels } from '../../../src/voxels.js';

const MAX_BODY_BYTES = 4096;
const FRIENDLY_QUOTA_MESSAGE = 'Blawx is getting a lot of building requests today. This connection has used its three fresh builds for now—try again after midnight UTC. You can still explore saved sets, or clone the repo and connect your own API key to build without this demo’s shared limit.';
const FRIENDLY_PAUSED_MESSAGE = 'Fresh builds are paused for a bit while I keep the public demo within its budget. Saved sets are still available. Try again later, or clone the repo and connect your own API key.';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorResponse(status, code, message, requestId = null) {
  return jsonResponse(status, {
    error: { code, message },
    ...(requestId ? { requestId } : {}),
  });
}

function contentTypeIsJson(request) {
  return /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '');
}

function originAllowed(request, allowedOrigins) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

async function readPrompt(request) {
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return { error: errorResponse(413, 'request-too-large', 'Keep the request under 4 KiB.') };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return { error: errorResponse(413, 'request-too-large', 'Keep the request under 4 KiB.') };
  }

  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { error: errorResponse(400, 'invalid-json', 'Send one JSON prompt.') };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).length !== 1 || typeof body.prompt !== 'string') {
    return { error: errorResponse(400, 'invalid-request', 'Send exactly one prompt.') };
  }

  const prompt = body.prompt.trim();
  if (!prompt) return { error: errorResponse(400, 'invalid-prompt', 'Enter a name for your set.') };
  if (Array.from(prompt).length > MAX_PROMPT_CHARACTERS) {
    return { error: errorResponse(400, 'prompt-too-long', PROMPT_TOO_LONG_MESSAGE) };
  }
  if (/\p{Cc}|\p{Cf}/u.test(prompt)) {
    return { error: errorResponse(400, 'invalid-prompt', 'Remove control characters from the set description.') };
  }
  return { prompt };
}

function reservationRejection(reservation, requestId) {
  if (reservation?.decision === 'daily_attempt_limit') {
    return errorResponse(429, 'daily-limit', FRIENDLY_QUOTA_MESSAGE, requestId);
  }
  return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
}

function cacheResponse(row, requestId, submittedPrompt) {
  const model = row?.raw_model;
  const diagnostics = row?.diagnostics;
  const sourceProgram = row?.source_program;
  const validation = validateVoxels(model);
  if (typeof row?.result_id !== 'string' || !row.result_id
      || typeof row.prompt !== 'string' || !row.prompt
      || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))
      || !validation.valid || !diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)
      || !sourceProgram || typeof sourceProgram !== 'object' || Array.isArray(sourceProgram)) {
    throw new Error('cached_result_invalid');
  }
  return jsonResponse(200, {
    requestId,
    resultId: row.result_id,
    cacheHit: true,
    submittedPrompt,
    saveStatus: 'saved',
    prompt: row.prompt,
    createdAt: row.created_at,
    model,
    diagnostics,
    metadata: {
      ...(row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {}),
      runtime: 'saved-result-cache',
      generationMs: null,
      requestCount: 0,
      retries: 0,
    },
  });
}

function publicGeneratedPayload(payload) {
  const { sourceProgram: _privateSourceProgram, ...safe } = payload;
  return safe;
}

function providerFailureResponse(error, requestId) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'openai_timeout') {
    return errorResponse(
      504,
      'generation-timeout',
      'The model service did not finish this build in time. This attempt counted, but no set was saved. Try again later.',
      requestId,
    );
  }
  if (/refusal|program_invalid|output_(?:invalid|missing|unexpected|incomplete)|response_(?:failed|cancelled|incomplete)/.test(code)) {
    return errorResponse(
      502,
      'generation-invalid',
      'The model finished, but its brick plan was not valid enough to build. This attempt counted. Try one compact object with a few defining features.',
      requestId,
    );
  }
  if (/network|http_failure|request_aborted|response_invalid_json/.test(code)) {
    return errorResponse(
      502,
      'generation-interrupted',
      'The connection to the model service broke before Blawx received the set. This attempt counted. Wait a moment before trying again.',
      requestId,
    );
  }
  return errorResponse(
    502,
    'generation-failed',
    'The build stopped after generation began. This attempt counted, but no set was saved. Try again later.',
    requestId,
  );
}

function storedFailureCode(error) {
  const code = typeof error?.code === 'string' ? error.code : '';
  if (code === 'openai_timeout') return 'provider_timeout';
  if (/refusal|program_invalid|output_(?:invalid|missing|unexpected|incomplete)|response_(?:failed|cancelled|incomplete)/.test(code)) {
    return 'provider_invalid';
  }
  if (/network|http_failure|request_aborted|response_invalid_json/.test(code)) {
    return 'provider_interrupted';
  }
  return Number.isInteger(error?.actualMicros) && error.actualMicros >= 0
    ? 'provider_failure'
    : 'provider_usage_unknown';
}

async function runReservedGeneration({
  requestId,
  submittedPrompt,
  providerInput,
  provider,
  store,
  cacheKey,
  generationVersion,
  now,
  signal,
  log,
}) {
  let providerStarted = false;
  try {
    providerStarted = await store.markProviderStarted({ requestId, now: now(), signal });
    if (!providerStarted) throw new Error('provider_start_rejected');
    log({ requestId, stage: 'provider-started' });

    const generated = await provider(providerInput, { requestId, signal });
    if (!generated || typeof generated !== 'object' || !Number.isInteger(generated.actualMicros)
        || generated.actualMicros < 0 || typeof generated.resultId !== 'string'
        || !generated.payload || typeof generated.payload !== 'object') {
      throw new Error('provider_result_invalid');
    }
    log({ requestId, stage: 'provider-completed' });

    if (cacheKey && typeof store.completeGeneration === 'function') {
      const saved = await store.completeGeneration({
        requestId,
        actualMicros: generated.actualMicros,
        cacheKey,
        generationVersion,
        normalizedPrompt: normalizeGenerationPrompt(submittedPrompt),
        prompt: generated.payload.prompt,
        rawModel: generated.payload.model,
        sourceProgram: generated.payload.sourceProgram,
        diagnostics: generated.payload.diagnostics,
        metadata: generated.payload.metadata,
        providerResultId: generated.resultId,
        now: now(),
        signal,
      });
      if (!saved || typeof saved.result_id !== 'string') {
        const error = new Error('generation_persistence_invalid');
        error.actualMicros = generated.actualMicros;
        throw error;
      }
      log({ requestId, stage: 'finalized' });
      return jsonResponse(200, {
        requestId,
        resultId: saved.result_id,
        cacheHit: saved.result_id !== requestId,
        submittedPrompt,
        saveStatus: 'saved',
        prompt: saved.prompt,
        createdAt: saved.created_at,
        model: saved.raw_model,
        diagnostics: saved.diagnostics,
        metadata: saved.metadata,
      });
    }

    const finalization = await store.finalize({
      requestId,
      outcome: 'succeeded',
      actualMicros: generated.actualMicros,
      resultId: requestId,
      failureCode: null,
      now: now(),
      signal,
    });
    if (!finalization?.finalized || finalization.decision !== 'finalized') {
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
    }
    log({ requestId, stage: 'finalized' });
    if (cacheKey && typeof store.saveGenerationResult === 'function') {
      try {
        const saved = await store.saveGenerationResult({
          resultId: requestId,
          cacheKey,
          generationVersion,
          normalizedPrompt: normalizeGenerationPrompt(submittedPrompt),
          prompt: generated.payload.prompt,
          rawModel: generated.payload.model,
          sourceProgram: generated.payload.sourceProgram,
          diagnostics: generated.payload.diagnostics,
          metadata: generated.payload.metadata,
          providerResultId: generated.resultId,
          now: now(),
          signal,
        });
        return jsonResponse(200, {
          ...publicGeneratedPayload(generated.payload),
          resultId: saved.result_id,
          cacheHit: false,
          submittedPrompt,
          saveStatus: 'saved',
          createdAt: saved.created_at,
        });
      } catch {
        return jsonResponse(200, {
          ...publicGeneratedPayload(generated.payload),
          resultId: null,
          cacheHit: false,
          submittedPrompt,
          saveStatus: 'failed',
        });
      }
    }
    return jsonResponse(200, publicGeneratedPayload(generated.payload));
  } catch (error) {
    const failureCode = storedFailureCode(error);
    log({ requestId, stage: 'failed', failureCode });
    try {
      if (!providerStarted) {
        await store.cancelBeforeProvider({
          requestId,
          failureCode: 'pre_provider_failure',
          now: now(),
        });
      } else {
        const knownActual = Number.isInteger(error?.actualMicros) && error.actualMicros >= 0
          ? error.actualMicros
          : null;
        await store.finalize({
          requestId,
          outcome: knownActual === null ? 'unknown' : 'failed',
          actualMicros: knownActual,
          resultId: null,
          failureCode,
          now: now(),
        });
      }
    } catch {
      // The database reservation remains fail-closed if cleanup cannot complete.
    }
    return providerFailureResponse(error, requestId);
  }
}

export function createLaunchHandler({
  generationEnabled,
  allowedOrigins,
  store,
  provider,
  connectionHasher,
  generationVersion = null,
  now = () => new Date(),
  logEvent = () => {},
  defer = null,
}) {
  const origins = new Set(allowedOrigins ?? []);
  const log = (event) => {
    try { logEvent(event); } catch { /* Observability must never affect generation. */ }
  };

  return async function handle(request, context = {}) {
    if (request.method !== 'POST') {
      return errorResponse(405, 'method-not-allowed', 'Use POST for fresh builds.');
    }
    if (!originAllowed(request, origins)) {
      return errorResponse(403, 'origin-not-allowed', 'This build request must come from the Blawx site.');
    }
    if (!contentTypeIsJson(request)) {
      return errorResponse(415, 'content-type', 'Send the prompt as JSON.');
    }
    if (!store) {
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE);
    }

    const parsed = await readPrompt(request);
    if (parsed.error) return parsed.error;

    let providerInput = parsed.prompt;
    try {
      if (typeof provider.prepare === 'function') providerInput = await provider.prepare(parsed.prompt);
    } catch (error) {
      if (error?.publicStatus === 400) {
        return errorResponse(400, 'prompt-too-complex', 'That description is too complex for the public demo. Try a shorter version.');
      }
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE);
    }

    const requestId = typeof context.requestId === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(context.requestId)
      ? context.requestId
      : crypto.randomUUID();
    let cacheKey = null;
    if (typeof generationVersion === 'string' && generationVersion
        && typeof store.findCachedResult === 'function') {
      try {
        cacheKey = await createPublicGenerationCacheKey({ prompt: parsed.prompt, generationVersion });
        const cached = await store.findCachedResult({
          cacheKey,
          generationVersion,
          signal: request.signal,
        });
        if (cached) return cacheResponse(cached, requestId, parsed.prompt);
      } catch {
        return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
      }
    }

    if (!generationEnabled || typeof provider !== 'function' || typeof connectionHasher !== 'function') {
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
    }
    const requestTime = now();
    let connectionHash;
    try {
      connectionHash = await connectionHasher({ ip: context.ip, now: requestTime });
    } catch {
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
    }

    let reservation;
    try {
      reservation = await store.reserve({ requestId, connectionHash, now: requestTime, signal: request.signal });
    } catch {
      return errorResponse(503, 'generation-paused', FRIENDLY_PAUSED_MESSAGE, requestId);
    }
    if (!reservation?.accepted) return reservationRejection(reservation, requestId);
    log({ requestId, stage: 'reserved' });

    const run = () => runReservedGeneration({
      requestId,
      submittedPrompt: parsed.prompt,
      providerInput,
      provider,
      store,
      cacheKey,
      generationVersion,
      now,
      signal: typeof defer === 'function' ? undefined : request.signal,
      log,
    });

    if (typeof defer === 'function') {
      const completion = Promise.resolve().then(run);
      defer(completion.then(() => undefined));
      log({ requestId, stage: 'dispatched' });
      return jsonResponse(202, { requestId, status: 'pending' });
    }
    return run();
  };
}

export const launchMessages = Object.freeze({
  quota: FRIENDLY_QUOTA_MESSAGE,
  paused: FRIENDLY_PAUSED_MESSAGE,
});
