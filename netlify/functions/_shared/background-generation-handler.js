import { createPublicGenerationCacheKey } from './generation-cache.js';
import { runReservedGeneration } from './launch-handler.js';
import { parseSignedGenerationTask } from './background-generation-task.js';

function response(status, message) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export function createBackgroundGenerationHandler({
  secret,
  store,
  provider,
  generationVersion,
  now = () => new Date(),
  logEvent = () => {},
}) {
  const log = (event) => {
    try { logEvent(event); } catch { /* Observability must never affect generation. */ }
  };
  return async function handle(request) {
    let task;
    try {
      task = await parseSignedGenerationTask(request, secret);
    } catch {
      return response(403, 'Forbidden');
    }
    const { requestId, prompt } = task;
    log({ requestId, stage: 'worker-received' });
    if (!store || typeof provider !== 'function' || typeof generationVersion !== 'string' || !generationVersion) {
      log({ requestId, stage: 'worker-unavailable' });
      return response(503, 'Unavailable');
    }

    let providerInput;
    let cacheKey;
    try {
      providerInput = typeof provider.prepare === 'function' ? await provider.prepare(prompt) : prompt;
      cacheKey = await createPublicGenerationCacheKey({ prompt, generationVersion });
    } catch {
      log({ requestId, stage: 'worker-preflight-failed' });
      try {
        await store.cancelBeforeProvider({
          requestId,
          failureCode: 'background_preflight_failed',
          now: now(),
        });
      } catch { /* The reservation remains fail-closed if cleanup fails. */ }
      return response(500, 'Preflight failed');
    }

    return runReservedGeneration({
      requestId,
      submittedPrompt: prompt,
      providerInput,
      provider,
      store,
      cacheKey,
      generationVersion,
      now,
      signal: undefined,
      log,
    });
  };
}
