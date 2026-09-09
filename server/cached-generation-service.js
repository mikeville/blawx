import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { PROVIDER_SETTINGS } from './codex-provider.js';
import { GenerationError } from './generation-service.js';
import { normalizeSubject } from './prompt-template.js';
import { publicRawModel } from './result-store.js';
import { validateVoxels } from '../src/voxels.js';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');
export const RAW_MODEL_SCHEMA_VERSION = 'voxel-model-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function normalizeCachePrompt(value) {
  return normalizeSubject(value).toLowerCase();
}

export function createGenerationCacheKey({ prompt, generationVersion, options = {} }) {
  if (typeof generationVersion !== 'string' || !generationVersion) throw new TypeError('Generation version is required.');
  return digest(JSON.stringify(stable({ generationVersion, options, prompt: normalizeCachePrompt(prompt) })));
}

export async function createGenerationVersion({
  root = DEFAULT_ROOT,
  templatePath = join(root, 'server', 'prompts', 'voxel-loft.txt'),
  settings = PROVIDER_SETTINGS,
  schemaVersion = RAW_MODEL_SCHEMA_VERSION,
} = {}) {
  const template = await readFile(templatePath, 'utf8');
  return `raw-${digest(JSON.stringify(stable({ template: digest(template), settings, schemaVersion })))}`;
}

function cacheMetadata() {
  return {
    runtime: 'saved-result-cache', generationMs: null, timingScope: null,
    requestedModel: null, actualModel: null, reasoningEffort: null,
    requestedServiceTier: null, actualServiceTier: null, usage: null,
    applicationRetries: 0, cliTransportRetriesControlled: false, qualityPass: null,
  };
}

function publicDiagnostics(value) {
  return Object.fromEntries(['valid', 'errors', 'warnings', 'stats', 'checks']
    .filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
}

function publicGenerationMetadata(value) {
  return Object.fromEntries([
    'runtime', 'generationMs', 'timingScope', 'requestedModel', 'actualModel', 'reasoningEffort',
    'requestedServiceTier', 'actualServiceTier', 'usage', 'applicationRetries',
    'cliTransportRetriesControlled', 'qualityPass',
  ].filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
}

function abortError(reason) {
  return reason instanceof Error ? reason : new DOMException('The operation was aborted.', 'AbortError');
}

export function createCachedGenerationService({ generator, store, generationVersion, options = {}, id = randomUUID, now = () => new Date() }) {
  if (!generator?.generate || !store?.findReusable || !store?.saveSuccess) throw new TypeError('Generator and result store are required.');
  const frozenOptions = stable(options);
  const inflight = new Map();
  let closed = false;

  function responseFor(row, { requestId, submittedPrompt, cacheHit }) {
    return {
      requestId, resultId: row.id, cacheHit, submittedPrompt, saveStatus: 'saved',
      prompt: row.prompt, createdAt: row.createdAt, model: publicRawModel(row.model), diagnostics: publicDiagnostics(row.diagnostics),
      metadata: cacheHit ? cacheMetadata() : publicGenerationMetadata(row.metadata),
    };
  }

  function attach(task, { signal, requestId, submittedPrompt }) {
    if (signal?.aborted) return Promise.reject(abortError(signal.reason));
    const waiter = {};
    task.waiters.add(waiter);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener('abort', cancel);
        task.waiters.delete(waiter);
        callback(value);
      };
      const cancel = () => {
        finish(reject)(abortError(signal.reason));
        if (!task.waiters.size) task.controller.abort(signal.reason);
      };
      signal?.addEventListener('abort', cancel, { once: true });
      task.promise.then(
        finish(value => resolve(value.saved
          ? responseFor(value.row, { requestId, submittedPrompt, cacheHit: false })
          : (() => {
              const { sourceProgram: _privateSourceProgram, ...publicResult } = value.result;
              return {
                requestId, resultId: null, cacheHit: false, submittedPrompt, saveStatus: 'failed',
                prompt: publicResult.prompt, createdAt: value.createdAt,
                model: publicRawModel(publicResult.model), diagnostics: publicDiagnostics(publicResult.diagnostics),
                metadata: publicGenerationMetadata(publicResult.metadata),
              };
            })())),
        finish(reject),
      );
    });
  }

  async function generate(input, { signal } = {}) {
    if (closed) throw new GenerationError('unavailable', 'Generation service is closed.', null);
    if (signal?.aborted) throw abortError(signal.reason);
    const submittedPrompt = normalizeSubject(input);
    const normalizedPrompt = normalizeCachePrompt(submittedPrompt);
    const cacheKey = createGenerationCacheKey({ prompt: submittedPrompt, generationVersion, options: frozenOptions });
    const requestId = id();
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) {
      throw new GenerationError('unavailable', 'Could not create a safe generation receipt.', null);
    }
    const cached = store.findReusable(cacheKey);
    if (cached) return responseFor(cached, { requestId, submittedPrompt, cacheHit: true });

    let task = inflight.get(cacheKey);
    if (!task) {
      if (inflight.size) throw new GenerationError('busy', 'Another generation is already running.', requestId);
      const controller = new AbortController();
      task = { controller, waiters: new Set(), promise: null };
      task.promise = (async () => {
        const result = await generator.generate(submittedPrompt, { signal: controller.signal });
        controller.signal.throwIfAborted();
        const validated = validateVoxels(result.model);
        if (!validated.valid) throw new GenerationError('invalid-output', 'Generator returned an invalid result.', result.requestId);
        const createdAt = now().toISOString();
        try {
          const row = store.saveSuccess({
            cacheKey, generationVersion, normalizedPrompt, options: frozenOptions,
            prompt: result.prompt, createdAt, model: result.model,
            diagnostics: validated, receiptRef: result.requestId,
            provenance: { method: result.model?.meta?.method ?? 'voxel-loft', generationVersion },
          });
          row.metadata = result.metadata;
          return { saved: true, row };
        } catch {
          return { saved: false, result, createdAt };
        }
      })().finally(() => inflight.delete(cacheKey));
      inflight.set(cacheKey, task);
    }
    return attach(task, { signal, requestId, submittedPrompt });
  }

  return {
    generate,
    cancel() { for (const task of inflight.values()) task.controller.abort(); },
    isBusy() { return inflight.size > 0 || Boolean(generator.isBusy?.()); },
    async close() {
      closed = true;
      const tasks = [...inflight.values()].map(task => task.promise);
      for (const task of inflight.values()) task.controller.abort();
      await Promise.allSettled(tasks);
    },
  };
}
