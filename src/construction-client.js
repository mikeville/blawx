import {
  CONSTRUCTION_PIPELINE_VERSION,
  createConstructionCache,
  createConstructionCacheKey,
} from './construction-cache.js';

function cancelled() {
  return new DOMException('Conversion cancelled.', 'AbortError');
}

function readWithSignal(operation, signal) {
  if (!signal) return operation;
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(
      value => { signal.removeEventListener('abort', abort); resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

function runWorker(makeWorker, timeoutMs, input, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    let worker;
    try {
      worker = makeWorker();
    } catch (error) {
      reject(error);
      return;
    }
    let timer;
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error); else resolve(result);
    };
    const abort = () => finish(cancelled());
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
    worker.onerror = () => finish(new Error('The local construction worker stopped. Raw geometry is still available.'));
    timer = setTimeout(() => finish(new Error('Conversion exceeded its 60-second local limit. Raw geometry is still available.')), timeoutMs);
    try { worker.postMessage(input); } catch (error) { finish(error); }
  });
}

// A disposable worker keeps local packing off the UI thread. Successful full
// results are cached on this browser origin; cancellation and failures never are.
export function createConstructionClient(
  makeWorker = () => new Worker(new URL('./construction-worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = 60_000,
  { cache, pipelineVersion = CONSTRUCTION_PIPELINE_VERSION } = {},
) {
  const resultCache = cache ?? createConstructionCache({ pipelineVersion });
  return {
    async convert(input, { signal } = {}) {
      if (signal?.aborted) throw cancelled();
      let key;
      try {
        key = createConstructionCacheKey(input, pipelineVersion);
        const cached = await readWithSignal(resultCache.get(key), signal);
        if (cached !== undefined) return cached;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        key = undefined;
      }
      const result = await runWorker(makeWorker, timeoutMs, input, signal);
      if (key !== undefined) void Promise.resolve(resultCache.set(key, result)).catch(() => {});
      return result;
    },
  };
}
