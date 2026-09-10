import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PROMPT_CHARACTERS,
  promptCharacterCount,
  promptSizeTier,
  truncatePrompt,
} from '../src/prompt-policy.js';

test('the public prompt policy keeps detailed prompts within a 280-character ceiling', () => {
  assert.equal(MAX_PROMPT_CHARACTERS, 280);
  assert.equal(promptCharacterCount('🧱'.repeat(280)), 280);
  assert.equal(truncatePrompt('🧱'.repeat(281)), '🧱'.repeat(280));
});

test('detail prompt sizing steps down as copy grows', () => {
  assert.equal(promptSizeTier('x'.repeat(56)), 'short');
  assert.equal(promptSizeTier('x'.repeat(57)), 'medium');
  assert.equal(promptSizeTier('x'.repeat(113)), 'long');
  assert.equal(promptSizeTier('x'.repeat(197)), 'extended');
});
