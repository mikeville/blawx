import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadViewState,
  normalizeViewState,
  saveViewState,
  viewStateKey,
} from '../mockups/feed/round2/view-state.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test('view state parses valid session data and remains scoped by composer mode', () => {
  const storage = memoryStorage();
  storage.setItem(viewStateKey('circle'), JSON.stringify({
    prompt: 'a red dragon', galleryCount: 6, homeScrollY: 412.5,
  }));

  assert.deepEqual(loadViewState({ mode: 'circle', recentCount: 9, storage }), {
    prompt: 'a red dragon', galleryCount: 6, homeScrollY: 412.5,
  });
  assert.deepEqual(loadViewState({ mode: 'fixed', recentCount: 9, storage }), {
    prompt: '', galleryCount: 3, homeScrollY: 0,
  });
});

test('view state rejects malformed fields and clamps gallery bounds', () => {
  assert.deepEqual(normalizeViewState({
    prompt: 'x'.repeat(10_001), galleryCount: 99, homeScrollY: -4,
  }, 7), { prompt: '', galleryCount: 7, homeScrollY: 0 });
  assert.deepEqual(normalizeViewState({ galleryCount: 1 }, 8), {
    prompt: '', galleryCount: 3, homeScrollY: 0,
  });
  assert.deepEqual(normalizeViewState({ galleryCount: 3 }, 2), {
    prompt: '', galleryCount: 2, homeScrollY: 0,
  });
});

test('load and save tolerate invalid JSON and unavailable storage', () => {
  const corrupt = { getItem: () => '{not json', setItem: () => {} };
  const failing = {
    getItem() { throw new Error('blocked'); },
    setItem() { throw new Error('blocked'); },
  };

  assert.deepEqual(loadViewState({ mode: 'circle', recentCount: 6, storage: corrupt }), {
    prompt: '', galleryCount: 3, homeScrollY: 0,
  });
  assert.deepEqual(loadViewState({ mode: 'circle', recentCount: 6, storage: failing }), {
    prompt: '', galleryCount: 3, homeScrollY: 0,
  });
  assert.equal(saveViewState({
    mode: 'circle', recentCount: 6, state: { prompt: 'cat', galleryCount: 3, homeScrollY: 2 }, storage: failing,
  }), false);
});

test('save writes normalized state', () => {
  const storage = memoryStorage();
  assert.equal(saveViewState({
    mode: 'circle', recentCount: 5, state: { prompt: 'reef', galleryCount: 12, homeScrollY: Number.NaN }, storage,
  }), true);
  assert.deepEqual(JSON.parse(storage.values.get(viewStateKey('circle'))), {
    prompt: 'reef', galleryCount: 5, homeScrollY: 0,
  });
});
