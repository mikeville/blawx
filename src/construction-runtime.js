import { Worker } from 'node:worker_threads';
import { expandLoftProgram } from './loft-program.js';

export const CONSTRUCTION_RUNTIME_LIMITS = Object.freeze({
  maxSourceBytes: 16 * 1024,
  maxOutputBytes: 128 * 1024,
  maxOperations: 256,
  guestDeadlineMs: 250,
  workerDeadlineMs: 2_000,
  memoryLimitBytes: 16 * 1024 * 1024,
  stackLimitBytes: 256 * 1024,
});

function validateSource(source) {
  if (typeof source !== 'string') throw new TypeError('Construction program source must be a string function body.');
  if (Buffer.byteLength(source, 'utf8') > CONSTRUCTION_RUNTIME_LIMITS.maxSourceBytes) {
    throw new RangeError(`Construction program source exceeds the ${CONSTRUCTION_RUNTIME_LIMITS.maxSourceBytes}-byte limit.`);
  }
}

function runWorker(source) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./construction-runtime-worker.js', import.meta.url), {
      workerData: { source },
      env: {},
      execArgv: [],
    });
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate().finally(() => reject(new RangeError(`Construction program exceeded the ${CONSTRUCTION_RUNTIME_LIMITS.workerDeadlineMs}ms worker deadline.`)));
    }, CONSTRUCTION_RUNTIME_LIMITS.workerDeadlineMs);

    worker.once('message', (message) => {
      if (!message?.ok) {
        const error = new Error(message?.error?.message || 'Construction program failed.');
        error.name = message?.error?.name || 'Error';
        finish(reject, error);
        return;
      }
      finish(resolve, message);
    });
    worker.once('error', (error) => finish(reject, error));
    worker.once('exit', (code) => {
      finish(reject, new Error(`Construction worker exited with code ${code} before returning a result.`));
    });
  });
}

export async function executeConstructionProgram(source, meta = {}) {
  validateSource(source);
  const result = await runWorker(source);
  if (Buffer.byteLength(result.json, 'utf8') > CONSTRUCTION_RUNTIME_LIMITS.maxOutputBytes) {
    throw new RangeError(`Construction program output exceeds the ${CONSTRUCTION_RUNTIME_LIMITS.maxOutputBytes}-byte limit.`);
  }
  const program = JSON.parse(result.json);
  const model = expandLoftProgram(program, meta);
  return { ops: program.ops, model, runtimeMs: result.runtimeMs };
}
