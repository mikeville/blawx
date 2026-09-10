import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONSENSUS_NAMING_STAGE_ENVELOPE,
  PARALLEL_FIXED_NAMING_POLICY,
  PARALLEL_FIXED_NAMING_STAGE_ENVELOPE,
  NAMING_CONSENSUS_POLICY,
  NAMING_PHASE_POLICIES,
  NAMING_POLICY,
  NAMING_STAGE_ENVELOPE,
  createNamingApiRequest,
  createNamingStageReservation,
  createParallelFixedNamingStageBudget,
  createParallelFixedNamingStageReservation,
  createConsensusNamingStageBudget,
  createNamingStageBudget,
  validateNamingImages,
} from '../server/naming-budget.js';

function png(width, height, bytes = 24) {
  const value = Buffer.alloc(bytes);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(value);
  value.writeUInt32BE(13, 8);
  value.write('IHDR', 12, 'ascii');
  value.writeUInt32BE(width, 16);
  value.writeUInt32BE(height, 20);
  return value;
}

test('naming policy pins Luna standard inference and a sub-cent worst-case envelope', () => {
  assert.deepEqual(NAMING_POLICY, {
    model: 'gpt-5.6-luna',
    reasoningEffort: 'low',
    serviceTier: 'default',
    overheadTokenAllowance: 1_024,
    maxImages: 4,
    maxImageDimension: 1_024,
    maxImageBytes: 4_194_304,
    maxCostUsd: 0.01,
    pricingAsOf: '2026-09-08',
  });
  assert.deepEqual(NAMING_PHASE_POLICIES, {
    proposal: { maxPromptBytes: 10_000, maxOutputTokens: 1_536, maxCostUsd: 0.0058292 },
    captions: { maxPromptBytes: 2_000, maxOutputTokens: 1_280, maxCostUsd: 0.003522 },
  });

  const { body, budget } = createNamingApiRequest('x'.repeat(NAMING_PHASE_POLICIES.proposal.maxPromptBytes));
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.service_tier, 'default');
  assert.deepEqual(body.reasoning, { effort: 'low' });
  assert.equal(body.max_output_tokens, 1_536);
  assert.deepEqual(body.tools, []);
  assert.equal(body.store, false);
  assert.equal(body.stream, false);
  assert.deepEqual(body.text, { format: { type: 'json_object' } });
  assert.equal(budget.phase, 'proposal');
  assert.equal(budget.maxInputTokens, 11_024);
  assert.equal(budget.imageCount, 0);
  assert.equal(budget.imageTokens, 0);
  assert.equal(budget.maxOutputTokens, 1_536);
  assert.equal(budget.maxInputCostUsd, 0.002756);
  assert.equal(budget.maxOutputCostUsd, 0.0018432);
  assert.equal(budget.maxCostUsd, 0.0045992);
  assert.ok(budget.maxCostUsd < NAMING_POLICY.maxCostUsd);
});

test('fixed proposal and caption envelopes reserve the whole naming stage below one cent', () => {
  const images = Array.from({ length: 4 }, (_, index) => ({
    png: png(1024, 1024), width: 1024, height: 1024, view: `view ${index + 1}`,
  }));
  const { body, budget } = createNamingApiRequest('x'.repeat(10_000), { images, phase: 'proposal' });
  assert.equal(budget.imageCount, 4);
  assert.equal(budget.imageTokens, 4 * (Math.ceil(32 * 32 * 1.2) + 1));
  assert.equal(budget.maxInputTokens, 15_944);
  assert.equal(budget.maxCostUsd, 0.0058292);
  assert.ok(budget.maxCostUsd < NAMING_POLICY.maxCostUsd);
  assert.equal(Array.isArray(body.input), true);
  assert.equal(body.input[0].role, 'user');
  assert.deepEqual(body.input[0].content[0], { type: 'input_text', text: 'x'.repeat(10_000) });
  assert.equal(body.input[0].content.slice(1).every((item) => (
    item.type === 'input_image' && item.detail === 'high' && item.image_url.startsWith('data:image/png;base64,')
  )), true);

  const captions = createNamingApiRequest('x'.repeat(2_000), { images, phase: 'captions' });
  assert.equal(captions.body.max_output_tokens, 1_280);
  assert.equal(captions.budget.maxInputTokens, 7_944);
  assert.equal(captions.budget.maxCostUsd, 0.003522);
  assert.deepEqual(createNamingStageBudget(), NAMING_STAGE_ENVELOPE);
  assert.equal(NAMING_STAGE_ENVELOPE.phases.proposal.maxCostUsd, 0.0058292);
  assert.equal(NAMING_STAGE_ENVELOPE.phases.captions.maxCostUsd, 0.003522);
  assert.equal(NAMING_STAGE_ENVELOPE.maxCostUsd, 0.0093512);
  assert.ok(NAMING_STAGE_ENVELOPE.maxCostUsd < NAMING_POLICY.maxCostUsd);
});

test('consensus-v1 reserves all three Luna phases atomically before provider entry', () => {
  assert.deepEqual(NAMING_CONSENSUS_POLICY, {
    maxPromptBytes: 4_000,
    maxOutputTokens: 1_024,
    maxImages: 0,
    maxCostUsd: 0.0024848,
  });
  assert.deepEqual(createConsensusNamingStageBudget(), CONSENSUS_NAMING_STAGE_ENVELOPE);
  assert.equal(CONSENSUS_NAMING_STAGE_ENVELOPE.maxCostUsd, 0.011836);
  assert.equal(CONSENSUS_NAMING_STAGE_ENVELOPE.ceilingUsd, 0.015);
  assert.equal(CONSENSUS_NAMING_STAGE_ENVELOPE.phases.consensus.maxInputTokens, 5_024);

  const request = createNamingApiRequest('x'.repeat(4_000), { phase: 'consensus' });
  assert.equal(request.body.model, 'gpt-5.6-luna');
  assert.equal(request.body.input.length, 4_000);
  assert.equal(request.body.max_output_tokens, 1_024);
  assert.equal(request.budget.maxCostUsd, 0.0024848);
  assert.throws(() => createNamingApiRequest('x'.repeat(4_001), { phase: 'consensus' }), /4,000-byte/);
  assert.throws(() => createNamingApiRequest('x', {
    phase: 'consensus', images: [{ png: png(1, 1), width: 1, height: 1, view: 'front' }],
  }), /do not accept images/);

  const reservation = createNamingStageReservation('request-1');
  assert.equal(reservation.requestId, 'request-1');
  assert.equal(reservation.strategy, 'consensus-v1');
  assert.equal(reservation.amountUsd, 0.011836);
  assert.equal(reservation.envelope, CONSENSUS_NAMING_STAGE_ENVELOPE);
});

test('parallel-fixed-v1 reserves the two existing vision envelopes atomically', () => {
  assert.deepEqual(PARALLEL_FIXED_NAMING_POLICY, {
    strategy: 'parallel-fixed-v1', groupingVersion: 1, maxCostUsd: 0.01,
  });
  assert.deepEqual(createParallelFixedNamingStageBudget(), PARALLEL_FIXED_NAMING_STAGE_ENVELOPE);
  assert.equal(PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.maxCostUsd, 0.0093512);
  assert.equal(PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.phases, NAMING_STAGE_ENVELOPE.phases);
  assert.equal(PARALLEL_FIXED_NAMING_STAGE_ENVELOPE.groupingVersion, 1);
  const reservation = createParallelFixedNamingStageReservation('parallel-request-1');
  assert.equal(reservation.strategy, 'parallel-fixed-v1');
  assert.equal(reservation.groupingVersion, 1);
  assert.equal(reservation.amountUsd, 0.0093512);
  assert.equal(reservation.envelope, PARALLEL_FIXED_NAMING_STAGE_ENVELOPE);
});

test('image validation enforces count, bytes, dimensions, signature, and matching IHDR', () => {
  const good = { png: png(640, 480), width: 640, height: 480, view: 'front' };
  const [validated] = validateNamingImages([good]);
  assert.notEqual(validated.png, good.png);
  assert.equal(validated.imageTokens, Math.ceil(20 * 15 * 1.2) + 1);
  assert.throws(() => validateNamingImages(Array(5).fill(good)), /at most 4 images/);
  assert.throws(() => validateNamingImages([{ ...good, png: Buffer.alloc(4 * 1024 * 1024 + 1) }]), /4194304-byte limit/);
  assert.throws(() => validateNamingImages([{ ...good, width: 1025 }]), /1 to 1024/);
  assert.throws(() => validateNamingImages([{ ...good, png: Buffer.alloc(24) }]), /PNG signature/);
  assert.throws(() => validateNamingImages([{ ...good, width: 641 }]), /IHDR dimensions/);
  assert.equal(validateNamingImages([{ ...good, view: 'v'.repeat(256) }])[0].view.length, 256);
  assert.throws(() => validateNamingImages([{ ...good, view: 'v'.repeat(257) }]), /1-256 plain-text/);
});

test('UTF-8 bytes bound the prompt without truncation', () => {
  const prompt = 'é'.repeat(5_000);
  const request = createNamingApiRequest(prompt);
  assert.equal(request.budget.promptBytes, 10_000);
  assert.equal(request.body.input, prompt);
  assert.throws(() => createNamingApiRequest(`${prompt}é`), /10,000-byte production limit/);
  const captions = 'é'.repeat(1_000);
  assert.equal(createNamingApiRequest(captions, { phase: 'captions' }).budget.promptBytes, 2_000);
  assert.throws(() => createNamingApiRequest(`${captions}é`, { phase: 'captions' }), /2,000-byte production limit/);
  assert.throws(() => createNamingApiRequest('prompt', { phase: 'unknown' }), /proposal or captions/);
  for (const phase of ['toString', '__proto__', 'constructor']) {
    assert.throws(() => createNamingApiRequest('prompt', { phase }), /proposal or captions/);
  }
  assert.throws(() => createNamingApiRequest(Buffer.from('prompt')), /must be a string/);
});
