import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const cssPath = new URL('../mockups/feed/round2/guide.css', import.meta.url);
const guidePath = new URL('../mockups/feed/round2/guide.js', import.meta.url);

test('feed guide source retains the fixed responsive layout contract', async () => {
  const [css, guide] = await Promise.all([
    readFile(cssPath, 'utf8'),
    readFile(guidePath, 'utf8'),
  ]);

  assert.doesNotMatch(guide, /density|type="range"/i);
  assert.match(css, /@media \(min-width: 641px\)[\s\S]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(min-width: 1024px\)[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /grid-template-columns: 116px minmax\(0, 1fr\) auto 44px 44px/);
  assert.match(css, /\.r2-guide__total-parts \{ width: min\(900px/);
  assert.match(css, /\.r2-guide__diagram::after \{[^}]*inset: auto 0 0/);
  assert.doesNotMatch(css, /\.r2-guide__diagram::after \{[^}]*100vw/);
});
