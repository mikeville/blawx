import { validateVoxels } from './voxels.js';
import { appResourcePath } from './app-path.js';

const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
async function json(response, message) {
  if (!response.ok) throw new Error(response.status === 404 ? 'That set is no longer available.' : message);
  try { return await response.json(); } catch { throw new Error(message); }
}
function summary(value) {
  if (!isRecord(value) || typeof value.id !== 'string' || !SAFE_ID.test(value.id) || typeof value.prompt !== 'string'
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !isRecord(value.provenance)
    || !(value.thumbnailUrl == null || typeof value.thumbnailUrl === 'string')
    || !(value.previewStage == null || isRecord(value.previewStage))) throw new Error('Recent sets couldn’t load.');
  return value;
}
function result(value, id, { allowMissingProvenance = false } = {}) {
  if (!isRecord(value) || value.id !== id || !SAFE_ID.test(value.id) || typeof value.prompt !== 'string'
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))
    || (!allowMissingProvenance && !isRecord(value.provenance))
    || !isRecord(value.model) || !validateVoxels(value.model).valid) throw new Error('That set could not be previewed.');
  return value;
}
function awaitCaller(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function createFeedClient(fetchImpl = fetch, base = appResourcePath('api'), { now = Date.now, resultTtlMs = 60_000, maxResults = 24 } = {}) {
  const results = new Map();
  function remember(value) {
    const checked = result(value, value?.id, { allowMissingProvenance: true });
    results.delete(checked.id);
    results.set(checked.id, { promise: Promise.resolve(checked), expiresAt: now() + resultTtlMs });
    while (results.size > maxResults) results.delete(results.keys().next().value);
    return checked;
  }
  return {
    async list({ cursor, signal } = {}) {
      if (cursor != null && typeof cursor !== 'string') throw new Error('Recent sets couldn’t load.');
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const payload = await fetchImpl(`${base}/feed${query}`, { signal }).then(response => json(response, 'Recent sets couldn’t load.'));
      if (!isRecord(payload) || !Array.isArray(payload.items) || payload.items.length > 9
        || !(payload.nextCursor == null || typeof payload.nextCursor === 'string')) throw new Error('Recent sets couldn’t load.');
      return { items: payload.items.map(summary), nextCursor: payload.nextCursor ?? null };
    },
    getResult(id, { signal } = {}) {
      if (typeof id !== 'string' || !SAFE_ID.test(id)) return Promise.reject(new Error('That set could not be previewed.'));
      const cached = results.get(id);
      if (cached && cached.expiresAt > now()) {
        results.delete(id); results.set(id, cached);
        return awaitCaller(cached.promise, signal);
      }
      results.delete(id);
      const record = { promise: null, expiresAt: Infinity };
      record.promise = fetchImpl(`${base}/results/${encodeURIComponent(id)}`)
        .then(response => json(response, 'Recent sets couldn’t load.')).then(value => result(value, id))
        .then(value => { record.expiresAt = now() + resultTtlMs; return value; })
        .catch(error => { if (results.get(id) === record) results.delete(id); throw error; });
      results.set(id, record);
      while (results.size > maxResults) results.delete(results.keys().next().value);
      return awaitCaller(record.promise, signal);
    },
    remember,
  };
}
