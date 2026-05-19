import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRevised } from './extractRevised.ts';

test('happy path: extracts critique and revised', () => {
  const text = `critique:
The draft is too blocky and the eye is missing.

revised:
y=0
........
........`;
  const r = extractRevised(text);
  assert.match(r.critique, /too blocky/);
  assert.match(r.revised, /y=0/);
});

test('case-insensitive markers', () => {
  const text = `Critique:
hmm

Revised:
y=0`;
  const r = extractRevised(text);
  assert.equal(r.critique, 'hmm');
  assert.match(r.revised, /y=0/);
});

test('missing critique: returns just revised', () => {
  const text = `revised:
y=0
........`;
  const r = extractRevised(text);
  assert.equal(r.critique, '');
  assert.match(r.revised, /y=0/);
});

test('missing revised: returns full text as revised', () => {
  const text = `y=0
........`;
  const r = extractRevised(text);
  assert.match(r.revised, /y=0/);
});
