import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NAMING_PHASE_POLICIES,
  NAMING_POLICY,
  NAMING_STAGE_ENVELOPE,
  createNamingApiRequest,
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
  assert.throws(() => createNamingApiRequest(Buffer.from('prompt')), /must be a string/);
});
