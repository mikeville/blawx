import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hasModifiedLinkIntent,
  homeHref,
  resultHref,
  shouldHandleLinkClick,
} from '../src/link-navigation.js';

test('home and result destinations are real URLs that preserve the app location', () => {
  assert.equal(homeHref({ pathname: '/blawx/', search: '?dev' }), '/blawx/?dev');
  assert.equal(resultHref('set with spaces'), '#set/set%20with%20spaces');
});

test('only an unmodified primary activation is handled as in-tab navigation', () => {
  assert.equal(shouldHandleLinkClick({ button: 0 }), true);
  assert.equal(shouldHandleLinkClick({ button: 0, defaultPrevented: true }), false);

  for (const event of [
    { button: 0, metaKey: true },
    { button: 0, ctrlKey: true },
    { button: 0, shiftKey: true },
    { button: 0, altKey: true },
    { button: 1 },
  ]) {
    assert.equal(hasModifiedLinkIntent(event), true);
    assert.equal(shouldHandleLinkClick(event), false);
  }
});
