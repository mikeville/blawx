import { validateVoxels } from '../../../src/voxels.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function failureResponse(row, requestId) {
  if (row.request_state === 'cancelled') {
    return errorResponse(
      503,
      'generation-not-started',
      'The build could not start, so this attempt was not counted. Try again.',
      requestId,
    );
  }
  if (row.failure_code === 'provider_timeout') {
    return errorResponse(
      504,
      'generation-timeout',
      'The model service did not finish this build in time. This attempt counted, but no set was saved. Try again later.',
      requestId,
    );
  }
  if (row.failure_code === 'provider_invalid') {
    return errorResponse(
      502,
      'generation-invalid',
      'The model finished, but its brick plan was not valid enough to build. This attempt counted. Try one compact object with a few defining features.',
      requestId,
    );
  }
  if (row.failure_code === 'provider_interrupted') {
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

function validCompletedRow(row) {
  return typeof row.result_id === 'string' && UUID.test(row.result_id)
    && typeof row.prompt === 'string' && row.prompt.length > 0
    && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
    && validateVoxels(row.raw_model).valid
    && row.diagnostics && typeof row.diagnostics === 'object' && !Array.isArray(row.diagnostics)
    && row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata);
}

export function createGenerationStatusHandler({
  store,
  connectionHasher,
  now = () => new Date(),
}) {
  return async function handle(request, context = {}) {
    if (request.method !== 'GET') return errorResponse(405, 'method-not-allowed', 'Use GET for build status.');
    const requestId = context.params?.id;
    if (typeof requestId !== 'string' || !UUID.test(requestId) || new URL(request.url).search) {
      return errorResponse(404, 'not-found', 'Build not found.');
    }
    if (!store || typeof connectionHasher !== 'function') {
      return errorResponse(503, 'status-unavailable', 'Build status is temporarily unavailable.', requestId);
    }

    let row;
    try {
      const requestTime = now();
      const connectionHash = await connectionHasher({ ip: context.ip, now: requestTime });
      row = await store.pollGeneration({
        requestId,
        connectionHash,
        signal: request.signal,
      });
    } catch {
      return errorResponse(503, 'status-unavailable', 'Build status is temporarily unavailable.', requestId);
    }
    if (!row) return errorResponse(404, 'not-found', 'Build not found.');
    if (row.request_state === 'reserved') {
      return jsonResponse(202, { requestId, status: 'pending' });
    }
    if (row.request_state !== 'succeeded') return failureResponse(row, requestId);
    if (!validCompletedRow(row)) {
      return errorResponse(
        503,
        'result-unavailable',
        'The set was generated but could not be loaded safely. This attempt counted. Try again later.',
        requestId,
      );
    }
    return jsonResponse(200, {
      requestId,
      resultId: row.result_id,
      cacheHit: row.result_id !== requestId,
      submittedPrompt: row.prompt,
      saveStatus: 'saved',
      prompt: row.prompt,
      createdAt: row.created_at,
      model: row.raw_model,
      diagnostics: row.diagnostics,
      metadata: row.metadata,
    });
  };
}
