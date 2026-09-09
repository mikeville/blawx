import test from 'node:test';
import assert from 'node:assert/strict';
import { PREVIEW_CREATED_AT, PREVIEW_NOW, formatCreationAge } from '../mockups/feed/round2/activity.js';

test('preview creation times are ordered independently of editorial IDs', () => {
  const dates = Object.values(PREVIEW_CREATED_AT).map(Date.parse);
  assert.ok(dates.every((date, index) => date < PREVIEW_NOW && (!index || date < dates[index - 1])));
  assert.equal(formatCreationAge(PREVIEW_CREATED_AT.tv, PREVIEW_NOW), '5m ago');
  assert.equal(formatCreationAge(PREVIEW_CREATED_AT.spaghetti, PREVIEW_NOW), '18m ago');
});

test('creation age formats minutes, hours, days and years without rewriting source time', () => {
  const timestamp = '2026-01-01T00:00:00Z';
  const created = Date.parse(timestamp);
  for (const [elapsedMinutes, expected] of [[0, 'just now'], [.9, 'just now'], [59, '59m ago'], [60, '1h ago'], [1440, '1d ago'], [525600, '1y ago']]) {
    assert.equal(formatCreationAge(timestamp, created + elapsedMinutes * 60_000), expected);
  }
  assert.equal(timestamp, '2026-01-01T00:00:00Z');
});

test('missing or invalid times stay absent; slight future clock skew is just now', () => {
  assert.equal(formatCreationAge(undefined, PREVIEW_NOW), '');
  assert.equal(formatCreationAge('bad', PREVIEW_NOW), '');
  assert.equal(formatCreationAge(PREVIEW_CREATED_AT.tv, NaN), '');
  assert.equal(formatCreationAge('2026-09-07T16:00:30Z', PREVIEW_NOW), 'just now');
});
