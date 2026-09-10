import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeFeedPage, mountRecentFeed, restoredFeedTarget } from '../src/recent-feed.js';

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
}

class FakeNode {
  constructor() {
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.attributes = new Map();
    this.isConnected = true;
    this.hidden = false;
    this.textContent = '';
  }
  set innerHTML(_value) {
    this.grid = new FakeNode();
    this.more = new FakeNode();
    this.error = new FakeNode();
  }
  querySelector(selector) {
    return { '.feed-grid': this.grid, '.feed-more': this.more, '.feed-error': this.error }[selector] ?? null;
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = [...nodes]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  addEventListener() {}
}

function installFeedDom() {
  let observer;
  globalThis.document = { createElement: () => new FakeNode() };
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.targets = []; observer = this; }
    observe(target) { this.targets.push(target); }
    unobserve() {}
    disconnect() {}
    setVisible(target, isIntersecting) { this.callback([{ target, isIntersecting }]); }
  };
  return () => observer;
}

const settle = () => new Promise(resolve => setImmediate(resolve));

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

test('returning gallery cards reuse prepared models after releasing their renderer', async () => {
  const getObserver = installFeedDom();
  const model = { kind: 'bricks', bricks: [] };
  let reads = 0;
  let preparations = 0;
  const stages = [];
  const feed = mountRecentFeed(new FakeNode(), {
    client: {
      list: async () => ({ items: [], nextCursor: null }),
      getResult: async () => { reads += 1; return { model }; },
    },
    previewClient: { prepare: async value => { preparations += 1; return value; } },
    onOpenSet() {},
    initialPage: {
      items: [{ id: 'one', prompt: 'a red lighthouse', createdAt: '2026-09-10T12:00:00Z' }],
      nextCursor: null,
    },
    stageFactory: (_host, options) => {
      const stage = { options, disposed: false, dispose() { this.disposed = true; } };
      stages.push(stage);
      return stage;
    },
  });
  await feed.ready;

  const observer = getObserver();
  const stageHost = observer.targets[0];
  observer.setVisible(stageHost, true);
  await settle();
  assert.equal(reads, 1);
  assert.equal(preparations, 1);
  assert.equal(stages.length, 1);

  observer.setVisible(stageHost, false);
  assert.equal(stages[0].disposed, true);
  observer.setVisible(stageHost, true);
  assert.equal(stages.length, 2);
  assert.equal(stages[1].options.model, model);
  assert.equal(reads, 1);
  assert.equal(preparations, 1);
  feed.dispose();
});
