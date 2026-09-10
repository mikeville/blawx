import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeveloperMode } from '../src/developer-mode.js';

test('developer UI is available only when the dev URL flag is present', () => {
  assert.equal(isDeveloperMode(''), false);
  assert.equal(isDeveloperMode('?preview=1'), false);
  assert.equal(isDeveloperMode('?dev'), true);
  assert.equal(isDeveloperMode('?preview=1&dev=1'), true);
});
