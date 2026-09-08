import test from 'node:test';
import assert from 'node:assert/strict';
import { executeConstructionProgram, CONSTRUCTION_RUNTIME_LIMITS } from '../src/construction-runtime.js';
import { expandLoftProgram } from '../src/loft-program.js';

test('executes authored helper calls with primitive and loft parity', async () => {
  const body = `
    function addBase(color) { b(0, 0, 0, 3, 1, 2, color); }
    addBase("R");
    e(1, 0, 0, 2, 2, 2, "B");
    t(0, 1, 0, 3, 2, 2, "O", 1, 1);
    for (let i = 0; i < 2; i++) b(5 + i, 0, 0, 1, 1, 1, "G");
    l("x", "box", "W", [[0, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1]]);
  `;
  const expectedOps = [
    ['b', 0, 0, 0, 3, 1, 2, 'R'],
    ['e', 1, 0, 0, 2, 2, 2, 'B'],
    ['t', 0, 1, 0, 3, 2, 2, 'O', 1, 1],
    ['b', 5, 0, 0, 1, 1, 1, 'G'],
    ['b', 6, 0, 0, 1, 1, 1, 'G'],
    ['l', 'x', 'box', 'W', [[0, 0.5, 0.5, 1, 1], [1, 0.5, 0.5, 1, 1]]],
  ];
  const result = await executeConstructionProgram(body, { method: 'construction' });
  assert.deepEqual(result.ops, expectedOps);
  assert.deepEqual(result.model, expandLoftProgram({ ops: expectedOps }, { method: 'construction' }));
  assert.ok(Number.isFinite(result.runtimeMs) && result.runtimeMs >= 0);
});

test('interrupts an infinite guest loop', async () => {
  await assert.rejects(executeConstructionProgram('while (true) {}'), /execution failed|deadline/);
});

test('fails closed when guest memory is exhausted', async () => {
  await assert.rejects(
    executeConstructionProgram('const held = []; while (true) held.push(new Array(100000).fill(1));'),
    /execution failed|deadline|worker exited/,
  );
});

test('enforces source, operation, and serialized output limits', async () => {
  await assert.rejects(executeConstructionProgram(' '.repeat(CONSTRUCTION_RUNTIME_LIMITS.maxSourceBytes + 1)), /source exceeds/);
  await assert.rejects(executeConstructionProgram('for (let i = 0; i < 257; i++) b(0,0,0,1,1,1,"R");'), /execution failed/);
  await assert.rejects(
    executeConstructionProgram('const huge = "x".repeat(600); for (let i=0;i<256;i++) b(0,0,0,1,1,1,huge);'),
    /execution failed|output exceeds/,
  );
});

test('passes malformed geometry to strict host validation without repair', async () => {
  await assert.rejects(executeConstructionProgram('b(-1, 0, 0, 1, 1, 1, "R");'), /origin must be nonnegative/);
  await assert.rejects(executeConstructionProgram('l("x", "box", "R", [[0,1,1,1,1]]);'), /between 2 and 16/);
});

test('guest has no Node, network, or module host capabilities', async () => {
  const result = await executeConstructionProgram(`
    const absent = [typeof process, typeof require, typeof fetch, typeof module, typeof Buffer];
    if (absent.some(value => value !== "undefined")) throw new Error("host capability exposed");
    b(0, 0, 0, 1, 1, 1, "R");
  `);
  assert.equal(result.model.cells.length, 1);
});

test('uses a fresh QuickJS runtime for every invocation', async () => {
  await executeConstructionProgram('globalThis.__constructionLeak = 42; b(0,0,0,1,1,1,"R");');
  const result = await executeConstructionProgram('if (typeof __constructionLeak !== "undefined") throw new Error("leaked"); b(0,0,0,1,1,1,"B");');
  assert.equal(result.model.cells[0].color, 'blue');
});

test('rejects pending async work and non-undefined return values', async () => {
  await assert.rejects(executeConstructionProgram('return Promise.resolve();'), /execution failed/);
  await assert.rejects(executeConstructionProgram('return 1;'), /execution failed/);
  await assert.rejects(executeConstructionProgram('Promise.resolve().then(() => b(0,0,0,1,1,1,"R")); b(0,0,0,1,1,1,"B");'), /pending asynchronous work/);
  const result = await executeConstructionProgram('b(0,0,0,1,1,1,"R"); return undefined;');
  assert.equal(result.model.cells.length, 1);
});

test('captured serializer cannot be replaced by guest code', async () => {
  const result = await executeConstructionProgram('JSON.stringify = () => "tampered"; Array.prototype.push = () => 0; b(0,0,0,1,1,1,"R");');
  assert.deepEqual(result.ops, [['b', 0, 0, 0, 1, 1, 1, 'R']]);
});

test('interrupts hostile getters reached during guest serialization', async () => {
  await assert.rejects(
    executeConstructionProgram('const hostile = {}; Object.defineProperty(hostile, "toJSON", { get() { while (true) {} } }); b(0,0,0,1,1,1,hostile);'),
    /execution failed|deadline/,
  );
});

test('quotes source as data before compilation and cannot interpolate host values', async () => {
  const result = await executeConstructionProgram('const probe = `}); ${typeof process}; ${typeof require};`; if (probe !== "}); undefined; undefined;") throw new Error("host interpolation"); b(0,0,0,1,1,1,"R");');
  assert.equal(result.model.cells.length, 1);
});
