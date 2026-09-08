import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardInset } from '../mockups/feed/round2/viewport.js';

test('fixed composer clears an overlaid keyboard without counting viewport panning twice', () => {
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: 510 }), 334);
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: 450, offsetTop: 60 }), 334);
});

test('native layout resizing needs no extra keyboard lift', () => {
  assert.equal(keyboardInset({ focused: true, layoutHeight: 510, visibleHeight: 510 }), 0);
});

test('do not follow browser toolbar movement, pinch zoom or an unfocused keyboard', () => {
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: 760 }), 0);
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: 422, scale: 2 }), 0);
  assert.equal(keyboardInset({ focused: false, layoutHeight: 844, visibleHeight: 510 }), 0);
});

test('invalid and overshooting viewport measurements cannot displace the composer', () => {
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: 900 }), 0);
  assert.equal(keyboardInset({ focused: true, layoutHeight: 844, visibleHeight: NaN }), 0);
});
