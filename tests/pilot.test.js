import test from 'node:test';
import assert from 'node:assert/strict';
import {
  expandPilotRepresentation,
  expandPilotRepresentationAsync,
  parseEventsJsonl,
  parseConstructionEnvelope,
  serviceTierArgs,
  summarizeProtocol,
  validateReasoningEffort,
  validateRuntimeModel,
  validateServiceTier,
} from '../scripts/run-voxel-pilot.mjs';

test('pilot representation routing preserves existing formats and metadata', () => {
  const meta = { method: 'routing-test' };
  const layers = expandPilotRepresentation('voxel-layers', {
    layers: [{ repeat: 1, rows: ['W'] }],
  }, meta);
  const tuples = expandPilotRepresentation('voxel-tuples', { ops: [['b', 0, 0, 0, 1, 1, 1, 'W']] }, meta);
  const program = expandPilotRepresentation('voxel-program', { operations: [
    { type: 'box', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1, color: 'white' },
  ] }, meta);

  for (const output of [layers, tuples, program]) {
    assert.equal(output.cells.length, 1);
    assert.deepEqual(output.meta, meta);
  }
});

test('construction envelope accepts exactly one string code field', () => {
  assert.equal(parseConstructionEnvelope({ code: 'b(0,0,0,1,1,1,"R");' }), 'b(0,0,0,1,1,1,"R");');
  for (const malformed of [null, [], {}, { code: 1 }, { code: '', extra: true }]) {
    assert.throws(() => parseConstructionEnvelope(malformed), /exactly one code string field/);
  }
});

test('voxel-construction executes an authored tiny body in the isolated runtime', async () => {
  const result = await expandPilotRepresentationAsync('voxel-construction', {
    code: 'b(0, 0, 0, 2, 1, 1, "R"); b(1, 1, 0, 1, 1, 1, "B");',
  }, { method: 'voxel-construction' });

  assert.deepEqual(result.execution.ops, [
    ['b', 0, 0, 0, 2, 1, 1, 'R'],
    ['b', 1, 1, 0, 1, 1, 1, 'B'],
  ]);
  assert.ok(Number.isFinite(result.execution.runtimeMs) && result.execution.runtimeMs >= 0);
  assert.ok(Number.isFinite(result.execution.wallMs) && result.execution.wallMs >= result.execution.runtimeMs);
  assert.equal(result.model.cells.length, 3);
  assert.deepEqual(result.model.meta, { method: 'voxel-construction' });
});

test('async representation wrapper leaves old methods synchronous and unchanged', async () => {
  const value = { ops: [['b', 0, 0, 0, 1, 1, 1, 'W']] };
  const sync = expandPilotRepresentation('voxel-tuples', value, { legacy: true });
  const asyncResult = await expandPilotRepresentationAsync('voxel-tuples', value, { legacy: true });
  assert.deepEqual(asyncResult, { model: sync, execution: null });
  assert.throws(
    () => expandPilotRepresentation('voxel-construction', { code: '' }),
    /requires async expandPilotRepresentationAsync/,
  );
});

test('voxel-detail routing expands a frame with an empty opening', () => {
  const output = expandPilotRepresentation('voxel-detail', { ops: [{
    type: 'frame', x: 0, y: 0, z: 0, w: 3, h: 3, d: 1, axis: 'z', thickness: 1, color: 'D',
  }] }, { method: 'voxel-detail' });

  assert.equal(output.cells.length, 8);
  assert.equal(output.cells.some(({ x, y, z }) => x === 1 && y === 1 && z === 0), false);
  assert.deepEqual(output.meta, { method: 'voxel-detail' });
});

test('voxel-loft routing expands a monotone section loft', () => {
  const output = expandPilotRepresentation('voxel-loft', { ops: [
    ['l', 'x', 'box', 'Y', [[0, 0.5, 0.5, 1, 1], [2, 0.5, 0.5, 1, 1]]],
  ] }, { method: 'voxel-loft' });

  assert.equal(output.cells.length, 2);
  assert.deepEqual(output.meta, { method: 'voxel-loft' });
});

test('voxel-loft-bidirectional routing expands descending sections', () => {
  const output = expandPilotRepresentation('voxel-loft-bidirectional', { ops: [
    ['l', 'x', 'box', 'Y', [[2, 0.5, 0.5, 1, 1], [0, 0.5, 0.5, 1, 1]]],
  ] }, { method: 'voxel-loft-bidirectional' });

  assert.equal(output.cells.length, 2);
  assert.deepEqual(output.cells.map(({ x }) => String(x)), ['0', '1']);
  assert.deepEqual(output.meta, { method: 'voxel-loft-bidirectional' });
});

test('pilot representation routing rejects unknown methods and malformed detail programs', () => {
  assert.throws(
    () => expandPilotRepresentation('generated-code', {}),
    /Representation must be voxel-layers, voxel-program, voxel-tuples, voxel-detail, voxel-loft, voxel-loft-bidirectional, or voxel-construction/,
  );
  assert.throws(
    () => expandPilotRepresentation('voxel-detail', { ops: [{
      type: 'frame', x: 0, y: 0, z: 0, w: 3, h: 3, d: 1, axis: 'z', thickness: 1, color: 'D', extra: true,
    }] }),
    /unknown field "extra"/,
  );
});

test('reasoning effort preserves legacy defaults and accepts none only for Sol', () => {
  assert.equal(validateReasoningEffort(), 'medium');
  assert.equal(validateReasoningEffort('low'), 'low');
  assert.equal(validateReasoningEffort('medium'), 'medium');
  assert.equal(validateReasoningEffort('none', 'gpt-5.6-sol'), 'none');
  assert.throws(
    () => validateReasoningEffort('none', 'gpt-6-astra'),
    /none is only supported for gpt-5\.6-sol/,
  );
  assert.throws(
    () => validateReasoningEffort('none', 'gpt-5.4-mini'),
    /none is only supported for gpt-5\.6-sol/,
  );
  assert.throws(
    () => validateReasoningEffort('high'),
    /VOXEL_PILOT_REASONING_EFFORT must be low or medium/,
  );
});

test('runtime model defaults to astra and only accepts the bounded comparison model', () => {
  assert.equal(validateRuntimeModel(), 'gpt-6-astra');
  assert.equal(validateRuntimeModel('gpt-6-astra'), 'gpt-6-astra');
  assert.equal(validateRuntimeModel('gpt-5.6-sol'), 'gpt-5.6-sol');
  assert.equal(validateRuntimeModel('gpt-5.4-mini'), 'gpt-5.4-mini');
  assert.throws(
    () => validateRuntimeModel('nonexistent'),
    /VOXEL_PILOT_MODEL must be gpt-6-astra, gpt-5\.6-sol, or gpt-5\.4-mini/,
  );
});

test('service tier defaults to no override and only accepts fast', () => {
  assert.equal(validateServiceTier(), null);
  assert.deepEqual(serviceTierArgs(validateServiceTier()), []);
  assert.equal(validateServiceTier('fast'), 'fast');
  assert.deepEqual(serviceTierArgs(validateServiceTier('fast')), [
    '--enable', 'fast_mode', '-c', 'service_tier="fast"',
  ]);
  assert.throws(
    () => validateServiceTier('auto'),
    /VOXEL_PILOT_SERVICE_TIER must be unset or fast/,
  );
  assert.throws(
    () => validateServiceTier(''),
    /VOXEL_PILOT_SERVICE_TIER must be unset or fast/,
  );
});

test('JSONL parsing preserves good events and reports malformed line numbers', () => {
  const result = parseEventsJsonl('{"type":"thread.started"}\nnot-json\n{"type":"turn.completed","usage":{"input_tokens":12}}\n');
  assert.equal(result.events.length, 2);
  assert.deepEqual(result.malformedLines, [2]);
});

test('protocol summary discovers model, latest usage, observed service tier, and nested tool use', () => {
  const result = summarizeProtocol([
    { type: 'thread.started', model: 'gpt-6-astra' },
    { type: 'item.started', item: { type: 'command_execution', command: 'pwd' } },
    { type: 'item.completed', item: { type: 'file_change', path: 'model.json' } },
    { type: 'function_call', name: 'unexpected' },
    { type: 'response.completed', response: { service_tier: 'fast' } },
    { type: 'turn.completed', usage: { input_tokens: 10, output_tokens: 20 } },
  ]);
  assert.equal(result.model, 'gpt-6-astra');
  assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 20 });
  assert.equal(result.serviceTier, 'fast');
  assert.equal(result.toolUseViolations.length, 3);
  assert.equal(result.toolUseViolations[0].type, 'command_execution');
});
