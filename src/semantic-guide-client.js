import { createSemanticGuideInput, validateSemanticGuideAnnotation, applySemanticGuide } from './semantic-guide.js';

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

// Saved sets are read-only: loading one must never launch subscription inference.
export function createSemanticGuideClient(fetchImpl = fetch) {
  let staticIndex;
  const cache = new Map();

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

  async function get(input, { signal, allowInference = false } = {}) {
    throwIfAborted(signal);
    if (cache.has(input.fingerprint)) return cache.get(input.fingerprint);
    let validated = null;
    try {
      staticIndex ??= readJson('/semantic-guides/index.json').catch(() => null);
      const index = await waitFor(staticIndex, signal);
      throwIfAborted(signal);
      const filename = index?.version === 1 ? index.entries?.[input.fingerprint] : null;
      if (typeof filename === 'string' && /^[a-zA-Z0-9_-]+\.json$/.test(filename)) {
        validated = validateReceipt(input, await readJson(`/semantic-guides/${filename}`, { signal }));
        if (validated) validated.metadata = { ...validated.metadata, cacheHit: true };
      }
    } catch (error) {
      if (error.name === 'AbortError') throw error;
    }
    throwIfAborted(signal);
    if (!validated) {
      try {
        validated = validateReceipt(input, await readJson(`/api/semantic-guide?fingerprint=${encodeURIComponent(input.fingerprint)}`, { signal }));
        if (validated) validated.metadata = { ...validated.metadata, cacheHit: true };
      } catch (error) {
        if (error.name === 'AbortError') throw error;
      }
    }
    throwIfAborted(signal);
    if (!validated && allowInference) {
      let inferenceError = null;
      try {
        validated = validateReceipt(input, await readJson('/api/semantic-guide', {
          method: 'POST', signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }));
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        inferenceError = error;
      }
      if (!validated && inferenceError) throw inferenceError;
    }
    throwIfAborted(signal);
    if (!validated) return null;
    cache.set(input.fingerprint, validated);
    return validated;
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
