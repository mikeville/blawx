import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFeedPage, restoredFeedTarget } from '../src/recent-feed.js';

test('feed pages merge in server order and deduplicate stable ids', () => {
  const first = [{ id:'a' }, { id:'b' }];
  const merged = mergeFeedPage(first, { items:[{ id:'b' }, { id:'c' }, null], nextCursor:'next' });
  assert.deepEqual(merged.items.map(item=>item.id), ['a','b','c']);
  assert.equal(merged.nextCursor, 'next');
});

test('restoration never shrinks an already expanded feed', () => {
  assert.equal(restoredFeedTarget(0), 9);
  assert.equal(restoredFeedTarget(18, 9), 18);
  assert.equal(restoredFeedTarget(3, 12), 12);
  assert.equal(restoredFeedTarget(-2, -1), 0);
});
