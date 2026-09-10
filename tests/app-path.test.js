import test from 'node:test';
import assert from 'node:assert/strict';
import { appResourcePath, isGenerationEnabled } from '../src/app-path.js';

test('resource paths are root-relative for a standalone site and relative for a /blawx/ proxy', () => {
  assert.equal(appResourcePath('/examples/index.json', '/'), '/examples/index.json');
  assert.equal(appResourcePath('api/generate', './'), './api/generate');
  assert.equal(appResourcePath('/semantic-guides/index.json', '/blawx/'), '/blawx/semantic-guides/index.json');
});

test('generation defaults off in production but can be explicitly enabled', () => {
  assert.equal(isGenerationEnabled({ DEV: false }), false);
  assert.equal(isGenerationEnabled({ DEV: false, VITE_GENERATION_ENABLED: 'false' }), false);
  assert.equal(isGenerationEnabled({ DEV: false, VITE_GENERATION_ENABLED: 'true' }), true);
  assert.equal(isGenerationEnabled({ DEV: true }), true);
});
