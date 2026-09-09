import test from 'node:test';
import assert from 'node:assert/strict';
import { guideRangeMarkup } from '../mockups/feed/round2/guide-range.js';

test('guide range isolates its dash without changing the formatted digits', () => {
  assert.equal(
    guideRangeMarkup({ start: 101, end: 125 }),
    '101<span class="r2-guide__range-dash">–</span>125',
  );
});

test('guide range escapes endpoints and leaves a one-number range alone', () => {
  assert.equal(
    guideRangeMarkup({ start: '<12', end: '22&' }),
    '&lt;12<span class="r2-guide__range-dash">–</span>22&amp;',
  );
  assert.equal(guideRangeMarkup({ start: 7, end: 7 }), '7');
});
