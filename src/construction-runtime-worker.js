import { parentPort, workerData } from 'node:worker_threads';
import { getQuickJS } from 'quickjs-emscripten';

const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const STACK_LIMIT_BYTES = 256 * 1024;
const EXECUTION_DEADLINE_MS = 250;
const MAX_INTERRUPT_CHECKS = 100_000;
const MAX_OPS = 256;
const MAX_JSON_CHARS = 128 * 1024;

function guestProgram(body) {
  return `
    (() => {
      "use strict";
      const SafeFunction = Function;
      const safePush = Function.call.bind(Array.prototype.push);
      const safeStringify = Function.call.bind(JSON.stringify);
      const ops = [];
      const append = (opcode, args) => {
        if (ops.length >= ${MAX_OPS}) throw new RangeError("Construction program exceeds the ${MAX_OPS}-operation limit.");
        safePush(ops, [opcode, ...args]);
      };
      const b = (...args) => append("b", args);
      const e = (...args) => append("e", args);
      const t = (...args) => append("t", args);
      const l = (...args) => append("l", args);
      const run = SafeFunction("b", "e", "t", "l", "\\\"use strict\\\";\\n" + ${JSON.stringify(body)});
      const returned = run(b, e, t, l);
      if (returned !== undefined) throw new TypeError("Construction program body must not return a value.");
      const json = safeStringify(null, { ops });
      if (typeof json !== "string") throw new TypeError("Construction program did not produce serializable operations.");
      if (json.length > ${MAX_JSON_CHARS}) throw new RangeError("Construction program output exceeds the ${MAX_JSON_CHARS}-character limit.");
      return json;
    })()
  `;
}

async function evaluate(source) {
  const QuickJS = await getQuickJS();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(STACK_LIMIT_BYTES);

  const deadline = Date.now() + EXECUTION_DEADLINE_MS;
  let interruptChecks = 0;
  runtime.setInterruptHandler(() => Date.now() > deadline || ++interruptChecks > MAX_INTERRUPT_CHECKS);

  const context = runtime.newContext();
  try {
    const result = context.evalCode(guestProgram(source), 'construction-program.js', { type: 'global', strict: true });
    if (result.error) {
      result.error.dispose();
      throw new Error('Construction program execution failed.');
    }
    if (runtime.hasPendingJob()) {
      result.value.dispose();
      throw new TypeError('Construction program must not leave pending asynchronous work.');
    }
    return result.value.consume((handle) => {
      if (context.typeof(handle) !== 'string') throw new TypeError('Construction runtime produced a non-string result.');
      return context.getString(handle);
    });
  } finally {
    context.dispose();
    runtime.dispose();
  }
}

const startedAt = performance.now();
try {
  const json = await evaluate(workerData.source);
  parentPort.postMessage({ ok: true, json, runtimeMs: performance.now() - startedAt });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: 'Construction program failed.' },
  });
}
