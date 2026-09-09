import test from 'node:test';
import assert from 'node:assert/strict';
import { mountAppRoutes, normalizeSetHash } from '../mockups/feed/round2/routes.js';

test('normalizeSetHash returns canonical safe set hashes', () => {
  assert.equal(normalizeSetHash('#set/cat'), '#set/cat');
  assert.equal(normalizeSetHash('set/pickup_2'), '#set/pickup_2');
  assert.equal(normalizeSetHash('#set/TV-1986'), '#set/TV-1986');
  assert.equal(normalizeSetHash(''), '');
  assert.equal(normalizeSetHash('#'), '');
});

test('normalizeSetHash rejects malformed and unsafe routes', () => {
  for (const hash of [
    '#set/',
    '#set/cat/more',
    '#set/cat?mode=raw',
    '#set/cat%20',
    '#set/ca t',
    '#set/café',
    '#other/cat',
    'javascript:alert(1)',
  ]) assert.equal(normalizeSetHash(hash), '', hash);
});

test('preview navigation delegates one route change to its same-origin parent', () => {
  const originalWindow = globalThis.window;
  const events = new EventTarget();
  const messages = [];
  const replacements = [];
  const changes = [];
  const parent = {
    location: { origin: 'https://example.test' },
    postMessage(message, origin) { messages.push({ message, origin }); },
  };
  const location = {
    origin: 'https://example.test',
    pathname: '/mockups/feed/round2/app.html',
    search: '?preview=1&composer=circle',
    hash: '',
  };
  globalThis.window = {
    parent,
    location,
    history: { replaceState(_state, _title, url) {
      replacements.push(url);
      location.hash = String(url).includes('#') ? String(url).slice(String(url).indexOf('#')) : '';
    } },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };

  try {
    const routes = mountAppRoutes({ onChange(hash) { changes.push(hash); } });
    assert.deepEqual(messages.shift(), {
      message: { type: 'blawx:ready' },
      origin: 'https://example.test',
    });
    routes.navigate('#set/cat');
    assert.deepEqual(messages.shift(), {
      message: { type: 'blawx:navigate', hash: '#set/cat', replace: false },
      origin: 'https://example.test',
    });
    assert.equal(location.hash, '');

    const routeMessage = new Event('message');
    Object.defineProperties(routeMessage, {
      source: { value: parent },
      origin: { value: 'https://example.test' },
      data: { value: { type: 'blawx:route', hash: '#set/cat' } },
    });
    events.dispatchEvent(routeMessage);
    assert.deepEqual(replacements, ['/mockups/feed/round2/app.html?preview=1&composer=circle#set/cat']);
    assert.deepEqual(changes, ['#set/cat']);
    routes.dispose();
  } finally {
    globalThis.window = originalWindow;
  }
});
