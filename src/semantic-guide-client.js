import { createSemanticGuideInput, validateSemanticGuideAnnotation, applySemanticGuide } from './semantic-guide.js';
import { appResourcePath } from './app-path.js';

function abortError() {
  return new DOMException('Section naming cancelled.', 'AbortError');
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function waitFor(promise, signal) {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// Inference requires an explicit opt-in from the product. Review/examples remain cache-only.
export function createSemanticGuideClient(fetchImpl = fetch, {
  persist = false, storage, maxEntries = 32,
} = {}) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError('Naming cache size must be a positive integer.');
  let staticIndex;
  const cache = new Map();
  const pending = new Map();
  const attempts = new Map();
  const storageKey = 'blawx:part-names:parallel-fixed-v1:grouping-1';
  const attemptKey = `${storageKey}:attempts`;
  const legacySuccessKey = 'blawx:part-names:consensus-v1';
  if (persist && storage === undefined) {
    try { storage = globalThis.localStorage; } catch { storage = null; }
  }
  const saved = new Map();
  const legacySaved = new Map();
  if (persist && storage) try {
    const entries = JSON.parse(storage.getItem(storageKey) ?? '[]');
    if (Array.isArray(entries)) for (const entry of entries.slice(-maxEntries)) {
      if (Array.isArray(entry) && entry.length === 2 && /^[a-f0-9]{64}$/u.test(entry[0])) saved.set(entry[0], entry[1]);
    }
  } catch { /* Browser storage is optional. */ }
  if (persist && storage) try {
    const entries = JSON.parse(storage.getItem(legacySuccessKey) ?? '[]');
    if (Array.isArray(entries)) for (const entry of entries.slice(-maxEntries)) {
      if (Array.isArray(entry) && entry.length === 2 && /^[a-f0-9]{64}$/u.test(entry[0])) {
        legacySaved.set(entry[0], entry[1]);
      }
    }
  } catch { /* Browser storage is optional. */ }
  if (persist && storage) try {
    const attempted = JSON.parse(storage.getItem(attemptKey) ?? '[]');
    if (Array.isArray(attempted)) for (const fingerprint of attempted.slice(-maxEntries)) {
      if (typeof fingerprint === 'string' && /^[a-f0-9]{64}$/u.test(fingerprint)) {
        attempts.set(fingerprint, new Error('Section naming was already attempted for this guide.'));
      }
    }
  } catch { /* Browser storage is optional. */ }

  function markAttempt(fingerprint) {
    attempts.set(fingerprint, new Error('Section naming was already attempted for this guide.'));
    if (persist && storage) try {
      storage.setItem(attemptKey, JSON.stringify([...attempts.keys()].slice(-maxEntries)));
    } catch { /* Private mode: retain the in-page attempt guard. */ }
  }

  function remember(input, receipt) {
    cache.delete(input.fingerprint);
    cache.set(input.fingerprint, receipt);
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    if (!persist || !storage) return;
    saved.delete(input.fingerprint);
    saved.set(input.fingerprint, receipt);
    while (saved.size > maxEntries || JSON.stringify([...saved]).length > 256_000) {
      saved.delete(saved.keys().next().value);
    }
    try { storage.setItem(storageKey, JSON.stringify([...saved])); } catch { /* Quota/private mode: retain memory cache. */ }
  }

  async function readJson(url, options = {}) {
    const response = await fetchImpl(url, { ...options, headers: { accept: 'application/json', ...options.headers } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Section naming is unavailable (${response.status}).`);
    return response.json();
  }

  function validateReceipt(input, receipt) {
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
    const annotation = validateSemanticGuideAnnotation(input, receipt.annotation);
    return { annotation, metadata: receipt.metadata ?? {} };
  }

  async function load(input, { signal, allowInference }) {
    throwIfAborted(signal);
    let validated = null;
    try {
      staticIndex ??= readJson(appResourcePath('semantic-guides/index.json')).catch(() => null);
      const index = await waitFor(staticIndex, signal);
      throwIfAborted(signal);
      const filename = index?.version === 1 ? index.entries?.[input.fingerprint] : null;
      if (typeof filename === 'string' && /^[a-zA-Z0-9_-]+\.json$/.test(filename)) {
        validated = validateReceipt(input, await readJson(appResourcePath(`semantic-guides/${filename}`), { signal }));
        if (validated) validated.metadata = { ...validated.metadata, cacheHit: true };
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
    }
    throwIfAborted(signal);
    if (!validated) {
      try {
        validated = validateReceipt(input, await readJson(`${appResourcePath('api/semantic-guide')}?fingerprint=${encodeURIComponent(input.fingerprint)}`, { signal }));
        if (validated) validated.metadata = { ...validated.metadata, cacheHit: true };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
      }
    }
    throwIfAborted(signal);
    if (!validated && allowInference) {
      // A concurrent cache-only reader may have found the receipt during lookup.
      if (cache.has(input.fingerprint)) return cache.get(input.fingerprint);
      if (attempts.has(input.fingerprint)) throw attempts.get(input.fingerprint);
      // Consume before POST; persist when possible so reload cannot retry silently.
      markAttempt(input.fingerprint);
      let inferenceError = null;
      try {
        validated = validateReceipt(input, await readJson(appResourcePath('api/semantic-guide'), {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        inferenceError = error;
        attempts.set(input.fingerprint, error);
      }
      if (!validated && inferenceError) throw inferenceError;
    }
    throwIfAborted(signal);
    if (!validated) return null;
    remember(input, validated);
    return validated;
  }

  async function get(input, { signal, allowInference = false } = {}) {
    throwIfAborted(signal);
    if (cache.has(input.fingerprint)) return cache.get(input.fingerprint);
    if (saved.has(input.fingerprint)) {
      try {
        const receipt = validateReceipt(input, saved.get(input.fingerprint));
        if (receipt) {
          receipt.metadata = { ...receipt.metadata, cacheHit: true, browserCacheHit: true };
          remember(input, receipt);
          return receipt;
        }
      } catch { saved.delete(input.fingerprint); }
    }
    if (legacySaved.has(input.fingerprint)) {
      try {
        const legacy = legacySaved.get(input.fingerprint);
        if (legacy?.metadata?.namingPolicy === 'consensus-v1') {
          const receipt = validateReceipt(input, legacy);
          if (receipt) {
            receipt.metadata = {
              ...receipt.metadata,
              cacheHit: true,
              browserCacheHit: true,
              cacheReusedFrom: 'consensus-v1',
            };
            remember(input, receipt);
            return receipt;
          }
        }
      } catch { /* A stale legacy success cannot migrate to the new range cache. */ }
      legacySaved.delete(input.fingerprint);
    }
    const key = `${input.fingerprint}:${allowInference ? 'infer' : 'lookup'}`;
    let task = pending.get(key);
    if (!task) {
      const controller = new AbortController();
      task = { controller, readers: 0, settled: false, promise: null };
      pending.set(key, task);
      task.promise = load(input, { signal: controller.signal, allowInference }).finally(() => {
        task.settled = true;
        if (pending.get(key) === task) pending.delete(key);
      });
    }
    task.readers += 1;
    try { return await waitFor(task.promise, signal); }
    finally {
      task.readers -= 1;
      if (!task.readers && !task.settled) {
        task.controller.abort();
        if (pending.get(key) === task) pending.delete(key);
      }
    }
  }

  return { get };
}

export async function nameConstructionGuide(result, {
  subject = '', client, signal, allowInference = false,
} = {}) {
  const plan = result.instructionPlan ?? result.assemblyPlan;
  if (!plan) return result;
  try {
    const input = createSemanticGuideInput({ plan, guide: result.guide, subject });
    const receipt = await client.get(input, { signal, allowInference });
    throwIfAborted(signal);
    if (!receipt) return { ...result, semanticStatus: 'No saved section names for this exact guide.' };
    return {
      ...result,
      semanticGuide: applySemanticGuide({ plan, guide: result.guide, subject, annotation: receipt.annotation }),
      semanticAnnotation: receipt.annotation,
      semanticMetadata: receipt.metadata,
      semanticStatus: 'Names inferred from this guide’s geometry; structural coverage validated. Semantic accuracy is not certified.',
    };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    return { ...result, semanticStatus: `Section naming unavailable: ${error.message}` };
  }
}
