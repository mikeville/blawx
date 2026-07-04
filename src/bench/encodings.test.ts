import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractViews, parseMaskText } from './encodings.ts';

test('extractViews reads labeled fences', () => {
  const res = 'intro text\n```front\n.#\n##\n```\n```side\n##\n##\n```\n```top\n#.\n..\n```\n';
  const v = extractViews(res);
  assert.equal(v.front?.trim(), '.#\n##');
  assert.equal(v.side?.trim(), '##\n##');
  assert.equal(v.top?.trim(), '#.\n..');
});

test('extractViews reads label-on-previous-line fences', () => {
  const res = 'FRONT\n```\n.#\n```\n\n**side**\n```\n##\n```\ntop:\n```\n#.\n```';
  const v = extractViews(res);
  assert.equal(v.front?.trim(), '.#');
  assert.equal(v.side?.trim(), '##');
  assert.equal(v.top?.trim(), '#.');
});

test('char parsing: clean mask has zero malformed rows', () => {
  const { mask, malformedRows } = parseMaskText('.#\n##', 2, 'char');
  assert.equal(malformedRows, 0);
  assert.deepEqual(mask, [[false, true], [true, true]]);
});

test('char parsing repairs and counts bad rows', () => {
  // row 0 too long, row 1 bad char, row 2 missing (size 3)
  const { mask, malformedRows } = parseMaskText('####\n.x#', 3, 'char');
  assert.equal(malformedRows, 3);
  assert.deepEqual(mask, [
    [true, true, true],
    [false, false, true],
    [false, false, false],
  ]);
});

test('extra rows count as drift', () => {
  const { malformedRows } = parseMaskText('##\n##\n##', 2, 'char');
  assert.equal(malformedRows, 1);
});

test('rle parsing: clean rows', () => {
  const { mask, malformedRows } = parseMaskText('1.2#1.\n4#\n4.\n1.2#1.', 4, 'rle');
  assert.equal(malformedRows, 0);
  assert.deepEqual(mask, [
    [false, true, true, false],
    [true, true, true, true],
    [false, false, false, false],
    [false, true, true, false],
  ]);
});

test('rle parsing repairs and counts bad rows', () => {
  // row 0 sums to 3 not 4; row 1 has trailing garbage; rows 2-3 missing
  const { mask, malformedRows } = parseMaskText('1.2#\n4#x', 4, 'rle');
  assert.equal(malformedRows, 4);
  assert.deepEqual(mask[0], [false, true, true, false]);
  assert.deepEqual(mask[1], [true, true, true, true]);
});
