export const CONSTRUCTION_CACHE_SCHEMA_VERSION = 1;

// Bump this whenever construction-worker.js or any module in its conversion
// pipeline can produce different placements, plans, guide data, or diagnostics.
// The version is part of every key, so old browser entries become harmless misses.
export const CONSTRUCTION_PIPELINE_VERSION = '2026-09-10.2';

const DATABASE_NAME = 'blawx-construction-cache';
const STORE_NAME = 'results';

function canonicalize(value, seen = new WeakSet()) {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'number:NaN';
    if (value === Infinity) return 'number:Infinity';
    if (value === -Infinity) return 'number:-Infinity';
    if (Object.is(value, -0)) return 'number:-0';
    return `number:${value}`;
  }
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return `boolean:${value}`;
  if (typeof value === 'bigint') return `bigint:${value}`;
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`;
  if (seen.has(value)) throw new TypeError('Construction cache inputs must not be cyclic.');
  seen.add(value);
  let serialized;
  if (Array.isArray(value)) {
    serialized = `array:[${value.map(item => canonicalize(item, seen)).join(',')}]`;
  } else {
    serialized = `object:{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key], seen)}`).join(',')}}`;
  }
  seen.delete(value);
  return serialized;
}

function compactHash(value) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const multipliers = [0x01000193, 0x27d4eb2d, 0x165667b1, 0x9e3779b1];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] = Math.imul(hashes[lane] ^ (code + lane * 131), multipliers[lane]);
    }
  }
  return hashes.map(hash => (hash >>> 0).toString(16).padStart(8, '0')).join('');
}

export function createConstructionCacheKey(input, pipelineVersion = CONSTRUCTION_PIPELINE_VERSION) {
  const material = canonicalize({ pipelineVersion, input });
  return `${pipelineVersion}:${material.length}:${compactHash(material)}`;
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(DATABASE_NAME, CONSTRUCTION_CACHE_SCHEMA_VERSION);
    } catch (error) {
      reject(error);
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('accessedAt', 'accessedAt');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade was blocked.'));
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

async function runTransaction(transaction, action) {
  const completion = transactionCompletion(transaction);
  try {
    const value = await action();
    await completion;
    return value;
  } catch (error) {
    await completion.catch(() => {});
    throw error;
  }
}

export function createIndexedDBConstructionStorage(indexedDB = globalThis.indexedDB) {
  if (!indexedDB) return null;
  let databasePromise;
  const database = () => (databasePromise ??= openDatabase(indexedDB));
  return {
    async get(key) {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      return runTransaction(transaction, async () => {
        const entry = await requestResult(store.get(key));
        if (entry) {
          entry.accessedAt = Date.now();
          await requestResult(store.put(entry));
        }
        return entry;
      });
    },
    async set(key, entry) {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      await runTransaction(transaction, () => requestResult(transaction.objectStore(STORE_NAME).put({ ...entry, key })));
    },
    async delete(key) {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      await runTransaction(transaction, () => requestResult(transaction.objectStore(STORE_NAME).delete(key)));
    },
    async prune(maxEntries) {
      const db = await database();
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      await runTransaction(transaction, async () => {
        const count = await requestResult(store.count());
        let remaining = count - maxEntries;
        if (remaining <= 0) return;
        await new Promise((resolve, reject) => {
          const cursor = store.index('accessedAt').openCursor();
          cursor.onerror = () => reject(cursor.error ?? new Error('IndexedDB cursor failed.'));
          cursor.onsuccess = () => {
            const row = cursor.result;
            if (!row || remaining <= 0) {
              resolve();
              return;
            }
            row.delete();
            remaining -= 1;
            row.continue();
          };
        });
      });
    },
  };
}

function withDeadline(operation, timeoutMs) {
  if (!(timeoutMs > 0)) return operation;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Construction cache operation timed out.')), timeoutMs);
    Promise.resolve(operation).then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function validResult(value) {
  return value != null
    && typeof value === 'object'
    && value.brickModel != null
    && typeof value.brickModel === 'object'
    && Array.isArray(value.brickModel.bricks)
    && value.assemblyPlan != null
    && typeof value.assemblyPlan === 'object'
    && value.instructionPlan != null
    && typeof value.instructionPlan === 'object'
    && value.guide != null
    && typeof value.guide === 'object'
    && Array.isArray(value.guide.sections)
    && value.diagnostics != null
    && typeof value.diagnostics === 'object';
}

function validEntry(entry, key, pipelineVersion) {
  return entry != null
    && entry.schemaVersion === CONSTRUCTION_CACHE_SCHEMA_VERSION
    && entry.pipelineVersion === pipelineVersion
    && entry.key === key
    && validResult(entry.value);
}

function boundedInteger(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback;
}

export function createConstructionCache({
  storage = createIndexedDBConstructionStorage(),
  pipelineVersion = CONSTRUCTION_PIPELINE_VERSION,
  maxMemoryEntries = 2,
  maxPersistentEntries = 8,
  operationTimeoutMs = 250,
} = {}) {
  const memoryLimit = boundedInteger(maxMemoryEntries, 2);
  const persistentLimit = boundedInteger(maxPersistentEntries, 8);
  const deadlineMs = Number.isFinite(operationTimeoutMs) && operationTimeoutMs > 0
    ? operationTimeoutMs
    : 250;
  const memory = new Map();
  const remember = (key, value) => {
    memory.delete(key);
    memory.set(key, value);
    while (memory.size > memoryLimit) memory.delete(memory.keys().next().value);
  };

  return {
    async get(key) {
      if (memory.has(key)) {
        const value = memory.get(key);
        remember(key, value);
        return value;
      }
      if (!storage) return undefined;
      let entry;
      try {
        entry = await withDeadline(storage.get(key), deadlineMs);
      } catch {
        return undefined;
      }
      if (!validEntry(entry, key, pipelineVersion)) {
        if (entry != null) void Promise.resolve(storage.delete(key)).catch(() => {});
        return undefined;
      }
      remember(key, entry.value);
      return entry.value;
    },
    async set(key, value) {
      if (!validResult(value)) return;
      remember(key, value);
      if (!storage) return;
      const entry = {
        key,
        schemaVersion: CONSTRUCTION_CACHE_SCHEMA_VERSION,
        pipelineVersion,
        accessedAt: Date.now(),
        value,
      };
      try {
        await withDeadline(storage.set(key, entry), deadlineMs);
        await withDeadline(storage.prune?.(persistentLimit), deadlineMs);
      } catch {
        // Browser privacy modes, quota pressure, and corrupt stores should only
        // turn persistence into a cache miss; construction itself still works.
      }
    },
  };
}
