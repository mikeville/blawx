import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

class ClassList {
  constructor() { this.values = new Set(); }
  add(...names) { names.forEach(name => this.values.add(name)); }
  remove(...names) { names.forEach(name => this.values.delete(name)); }
  toggle(name, force) {
    const enabled = force ?? !this.values.has(name);
    if (enabled) this.values.add(name); else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class Node {
  constructor() {
    this.attributes = new Map();
    this.children = [];
    this.classList = new ClassList();
    this.dataset = {};
    this.style = { setProperty(name, value) { this[name] = value; } };
    this.hidden = false;
    this.listeners = new Map();
    this.parentNode = null;
    this.textContent = '';
    this.value = '';
  }
  getBoundingClientRect() { return { left: 900, top: 500, width: 200, height: 14 }; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] ?? null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ defaultPrevented: false, preventDefault() {}, ...event });
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
  insertBefore(node, reference) {
    if (typeof node === 'string') return;
    node.parentNode?.removeChild(node);
    const index = reference ? this.children.indexOf(reference) : this.children.length;
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
  }
  replaceChildren(...nodes) {
    this.children.forEach(node => { node.parentNode = null; });
    this.children = [];
    this.textContent = '';
    this.append(...nodes);
  }
  focus() { globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = null; }
  closest(selector) { return selector === '.prompt-field' ? this.promptField : null; }
  querySelector(selector) { return this.queries?.get(selector) ?? null; }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function installBrowser(hash = '', { mobile = false } = {}) {
  const listeners = new Map();
  const mediaListeners = new Set();
  const media = {
    matches: mobile,
    addEventListener(type, listener) { if (type === 'change') mediaListeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'change') mediaListeners.delete(listener); },
    setMatches(matches) { this.matches = matches; for (const listener of mediaListeners) listener({ matches }); },
  };
  const location = { pathname: '/', search: '', hash };
  const window = {
    location,
    innerWidth: 1200,
    innerHeight: 900,
    scrollX: 0,
    scrollY: 0,
    matchMedia: () => media,
    addEventListener(type, listener) {
      const values = listeners.get(type) ?? new Set();
      values.add(listener);
      listeners.set(type, values);
    },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    dispatch(type) { for (const listener of listeners.get(type) ?? []) listener(); },
    scrollTo(x, y) {
      if (typeof x === 'object') this.scrollY = x.top ?? 0;
      else { this.scrollX = x; this.scrollY = y; }
    },
  };
  window.media = media;
  const setUrl = url => {
    if (url.startsWith('#')) location.hash = url;
    else location.hash = url.includes('#') ? url.slice(url.indexOf('#')) : '';
  };
  globalThis.window = window;
  globalThis.location = location;
  globalThis.history = { pushState(_state, _title, url) { setUrl(url); }, replaceState(_state, _title, url) { setUrl(url); } };
  globalThis.CSS = { escape: value => value };
  globalThis.requestAnimationFrame = callback => { callback(); return 1; };
  globalThis.cancelAnimationFrame = () => {};
  globalThis.sessionStorage = { getItem() { return null; }, setItem() {} };
  globalThis.document = {
    activeElement: null,
    body: new Node(),
    title: '',
    querySelector() { return null; },
    createElement() { return new Node(); },
    createTextNode(text) { const node = new Node(); node.textContent = text; return node; },
  };
  return window;
}

installBrowser();
const bundle = await build({
  entryPoints: ['src/product.js'],
  bundle: true,
  write: false,
  outdir: 'test-output',
  format: 'esm',
  platform: 'browser',
  loader: { '.css': 'empty' },
});
const { mountProductApp } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

function productHost() {
  const selectors = [
    '#home-view', '#detail-view', '.composer', '#prompt-form', '#prompt', '.prompt-status',
    '.form-message', '.recent-host', '.home-hero .hero-mount', '.detail-hero', '.detail-copy h1',
    '.detail-copy p', '.generation-progress-host', '.result-note', '.instructions', '.guide-host',
    '.developer-record', '.developer-generation', '.developer-construction', '.brand', '.about-link', '.home-lead',
  ];
  const nodes = new Map(selectors.map(selector => [selector, new Node()]));
  const host = new Node();
  host.queries = nodes;
  const form = nodes.get('#prompt-form');
  const makeButton = new Node();
  form.queries = new Map([['.make-button', makeButton]]);
  const promptStatus = nodes.get('.prompt-status');
  const publicUse = new Node();
  publicUse.id = 'public-use';
  promptStatus.queries = new Map([['#public-use', publicUse]]);
  const promptField = new Node();
  nodes.get('#prompt').promptField = promptField;
  const statusMarker = new Node();
  form.append(promptStatus, statusMarker);
  return { host, nodes, form };
}

function mountOptions(overrides = {}) {
  return {
    generationEnabled: true,
    feedClient: { list: async () => ({ items: [] }), getResult: async () => { throw new Error('missing'); }, remember() {} },
    exampleClient: { list: async () => ({ items: [] }), getResult: async () => { throw new Error('missing'); } },
    previewClient: { prepare: async model => model, dispose() {} },
    recentFactory: () => ({ ready: Promise.resolve(), suspend() {}, resume() {}, dispose() {}, refresh() {} }),
    composerFactory: () => ({ setRoute() {}, dispose() {} }),
    viewportFactory: () => ({ dispose() {} }),
    promptFieldFactory: () => ({ sync() {}, dispose() {} }),
    scrollHeaderFactory: () => ({ dispose() {} }),
    progressFactory: () => ({ setPhase() {}, complete() {}, dispose() {} }),
    ...overrides,
  };
}

const settle = () => new Promise(resolve => setImmediate(resolve));
const rawModel = { kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }] };

test('fresh generation displays raw geometry immediately and advances only on real construction milestones', async () => {
  const window = installBrowser();
  const { host, nodes, form } = productHost();
  const generation = deferred();
  const events = [];
  let comparisonCallbacks;
  let stageDisposed = 0;
  let generationSignal;
  let previewCalls = 0;
  const progressActions = new Node();
  const app = mountProductApp(host, mountOptions({
    generationClient: { generate(_prompt, { signal }) { generationSignal = signal; return generation.promise; } },
    previewClient: { async prepare(model) { previewCalls += 1; return model; }, dispose() {} },
    stageFactory(_host, options) {
      events.push(['stage', options.model ?? null]);
      return {
        setModel(model) { events.push(['model', model]); },
        setLoading(value) { events.push(['loading', value]); },
        dispose() { stageDisposed += 1; },
      };
    },
    progressFactory(_host, options) {
      events.push(['phase', 'designing']);
      return {
        setPhase(phase) { events.push(['phase', phase]); },
        complete() { events.push(['complete']); },
        dispose() { events.push(['progress-dispose']); },
        cancel: options.onCancel,
        statusHost: progressActions,
      };
    },
    comparisonFactory(_host, options) {
      comparisonCallbacks = options;
      events.push(['comparison', options.rawModel]);
      return () => events.push(['comparison-dispose']);
    },
  }));

  nodes.get('#prompt').value = 'a tiny observatory';
  form.dispatch('submit');
  assert.equal(nodes.get('.prompt-status').parentNode, progressActions);
  window.media.setMatches(true);
  assert.equal(nodes.get('.prompt-status').parentNode, document.body);
  window.media.setMatches(false);
  assert.equal(nodes.get('.prompt-status').parentNode, progressActions);
  generation.resolve({ resultId: 'fresh-1', prompt: 'a tiny observatory', submittedPrompt: 'a tiny observatory', model: rawModel, saveStatus: 'saved', cacheHit: false });
  await settle();

  assert.deepEqual(events.slice(0, 6), [
    ['stage', null],
    ['phase', 'designing'],
    ['phase', 'bricks'],
    ['model', rawModel],
    ['loading', false],
    ['comparison', rawModel],
  ]);
  assert.equal(nodes.get('.instructions').hidden, true);
  assert.equal(generationSignal.aborted, false);
  assert.equal(previewCalls, 0);

  window.dispatch('hashchange');
  window.dispatch('popstate');
  assert.equal(stageDisposed, 0);
  assert.equal(events.filter(([event]) => event === 'comparison').length, 1);

  comparisonCallbacks.onPhase('guide');
  assert.equal(events.at(-1)[1], 'guide');
  assert.equal(nodes.get('.instructions').hidden, true);
  comparisonCallbacks.onReady();
  assert.equal(nodes.get('.prompt-status').parentNode, form);
  assert.equal(nodes.get('.instructions').hidden, false);
  assert.equal(events.filter(([event]) => event === 'complete').length, 1);
  comparisonCallbacks.onError(new Error('late failure'));
  assert.equal(events.filter(([event]) => event === 'complete').length, 1);
  app.dispose();
});

test('construction failure leaves the raw model visible and completes the loading UI', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  let callbacks;
  const models = [];
  let completed = 0;
  let disposedStages = 0;
  const app = mountProductApp(host, mountOptions({
    generationClient: { async generate() { return { resultId: 'error-1', prompt: 'a bridge', model: rawModel, saveStatus: 'saved', cacheHit: false }; } },
    stageFactory: () => ({ setModel(model) { models.push(model); }, setLoading() {}, dispose() { disposedStages += 1; } }),
    progressFactory: () => ({ setPhase() {}, complete() { completed += 1; }, dispose() {} }),
    comparisonFactory(_host, options) { callbacks = options; return () => {}; },
  }));
  nodes.get('#prompt').value = 'a bridge';
  form.dispatch('submit');
  await settle();
  assert.deepEqual(models, [rawModel]);
  callbacks.onPhase('guide');
  callbacks.onError(new Error('conversion failed'));
  assert.deepEqual(models, [rawModel]);
  assert.equal(disposedStages, 0);
  assert.equal(nodes.get('.instructions').hidden, false);
  assert.equal(completed, 1);
  app.dispose();
});

test('a synchronous comparison mount failure preserves raw and reveals the unavailable instructions state', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  const models = [];
  let completed = 0;
  const app = mountProductApp(host, mountOptions({
    generationClient: { async generate() { return { resultId: 'mount-error-1', prompt: 'a ferry', model: rawModel, saveStatus: 'saved', cacheHit: false }; } },
    stageFactory: () => ({ setModel(model) { models.push(model); }, setLoading() {}, dispose() {} }),
    progressFactory: () => ({ setPhase() {}, complete() { completed += 1; }, dispose() {} }),
    comparisonFactory() { throw new Error('comparison mount failed'); },
  }));
  nodes.get('#prompt').value = 'a ferry';
  form.dispatch('submit');
  await settle();
  assert.deepEqual(models, [rawModel]);
  assert.match(nodes.get('.guide-host').innerHTML, /Instructions unavailable/);
  assert.equal(nodes.get('.instructions').hidden, false);
  assert.equal(completed, 1);
  app.dispose();
});

test('late comparison callbacks are ignored after cancellation', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  let callbacks;
  const phases = [];
  let completed = 0;
  const app = mountProductApp(host, mountOptions({
    generationClient: { async generate() { return { resultId: 'cancel-1', prompt: 'a kite', model: rawModel, saveStatus: 'saved', cacheHit: true }; } },
    stageFactory: () => ({ setModel() {}, setLoading() {}, dispose() {} }),
    progressFactory: () => ({ setPhase: phase => phases.push(phase), complete: () => { completed += 1; }, dispose() {} }),
    comparisonFactory(_host, options) { callbacks = options; return () => {}; },
  }));
  nodes.get('#prompt').value = 'a kite';
  form.dispatch('submit');
  await settle();
  assert.deepEqual(phases, ['bricks']);
  nodes.get('.brand').dispatch('click');
  assert.equal(nodes.get('.prompt-status').parentNode, form);
  callbacks.onPhase('guide');
  callbacks.onReady();
  assert.deepEqual(phases, ['bricks']);
  assert.equal(completed, 0);
  app.dispose();
});

test('the brand exposes a real home URL and leaves command-click to the browser', () => {
  const window = installBrowser('#set/recent-1');
  const { host, nodes } = productHost();
  const app = mountProductApp(host, mountOptions());
  let prevented = false;

  assert.equal(nodes.get('.brand').attributes.get('href'), '/');
  nodes.get('.brand').dispatch('click', {
    button: 0,
    metaKey: true,
    preventDefault() { prevented = true; },
  });

  assert.equal(prevented, false);
  assert.equal(window.location.hash, '#set/recent-1');
  app.dispose();
});

test('a failed request restores the shared status node before retry and cancellation', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  const retry = deferred();
  const progressActions = new Node();
  let calls = 0;
  const app = mountProductApp(host, mountOptions({
    generationClient: {
      generate() {
        calls += 1;
        if (calls === 1) return Promise.reject(new Error('Temporary failure'));
        return retry.promise;
      },
    },
    stageFactory: () => ({ dispose() {} }),
    progressFactory: () => ({ statusHost: progressActions, setPhase() {}, complete() {}, dispose() {} }),
  }));
  nodes.get('#prompt').value = 'a small windmill';
  form.dispatch('submit');
  assert.equal(nodes.get('.prompt-status').parentNode, progressActions);
  await settle();
  assert.equal(nodes.get('.prompt-status').parentNode, form);
  nodes.get('.form-message').children.at(-1).onclick();
  assert.equal(nodes.get('.prompt-status').parentNode, progressActions);
  nodes.get('.brand').dispatch('click');
  assert.equal(nodes.get('.prompt-status').parentNode, form);
  app.dispose();
});

test('a timed-out accepted build offers Check again and resumes without another generation POST', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  const completed = deferred();
  let generateCalls = 0;
  let resumeCalls = 0;
  const timeout = Object.assign(new Error('Still building.'), {
    code: 'generation-status-timeout',
    requestId: 'accepted-job-1',
  });
  const app = mountProductApp(host, mountOptions({
    generationClient: {
      generate() { generateCalls += 1; return Promise.reject(timeout); },
      resume(requestId) {
        resumeCalls += 1;
        assert.equal(requestId, 'accepted-job-1');
        return completed.promise;
      },
    },
    stageFactory: () => ({ dispose() {} }),
    progressFactory: () => ({ setPhase() {}, complete() {}, dispose() {} }),
  }));
  nodes.get('#prompt').value = 'a small windmill';
  form.dispatch('submit');
  await settle();

  const action = nodes.get('.form-message').children.at(-1);
  assert.equal(action.textContent, 'Check again');
  action.onclick();
  assert.equal(generateCalls, 1);
  assert.equal(resumeCalls, 1);
  completed.reject(new DOMException('Cancelled', 'AbortError'));
  await settle();
  app.dispose();
});

test('opening a cached recent set mounts raw immediately and honors an explicit naming opt-out', async () => {
  const window = installBrowser('#set/recent-1');
  const { host } = productHost();
  let reads = 0;
  let previewCalls = 0;
  const stageModels = [];
  let comparisonOptions;
  let progressCalls = 0;
  let progressOptions;
  const progressPhases = [];
  let progressCompleted = 0;
  const result = { id: 'recent-1', title: 'Tiny train', prompt: 'a tiny train', model: rawModel, cacheHit: true, saveStatus: 'saved' };
  const app = mountProductApp(host, mountOptions({
    allowSemanticInference: false,
    feedClient: { list: async () => ({ items: [result] }), async getResult() { reads += 1; return result; } },
    previewClient: { async prepare(model) { previewCalls += 1; return model; }, dispose() {} },
    stageFactory(_host, options) { stageModels.push(options.model); return { setModel() {}, dispose() {} }; },
    progressFactory(_host, options) {
      progressCalls += 1;
      progressOptions = options;
      return { setPhase(phase) { progressPhases.push(phase); }, complete() { progressCompleted += 1; }, dispose() {} };
    },
    comparisonFactory(_host, options) { comparisonOptions = options; return () => {}; },
  }));
  await settle();
  assert.deepEqual(stageModels, [rawModel]);
  assert.equal(previewCalls, 0);
  assert.equal(comparisonOptions.allowSemanticInference, false);
  assert.equal(progressCalls, 1);
  assert.equal(progressOptions.initialPhase, 'bricks');
  assert.equal(host.querySelector('.instructions').hidden, true);
  assert.equal(host.querySelector('.detail-copy h1').textContent, 'a tiny train');
  assert.equal(host.querySelector('.detail-copy h1').dataset.promptSize, 'short');
  assert.equal(host.querySelector('.detail-copy p').textContent, '');

  comparisonOptions.onPhase('guide');
  assert.deepEqual(progressPhases, ['guide']);
  comparisonOptions.onReady();
  assert.equal(progressCompleted, 1);
  assert.equal(host.querySelector('.instructions').hidden, false);

  window.dispatch('hashchange');
  window.dispatch('popstate');
  await settle();
  assert.equal(reads, 1);
  assert.deepEqual(stageModels, [rawModel]);
  app.dispose();
});

test('a saved set keeps its studded raw preview when instruction setup fails synchronously', async () => {
  installBrowser('#set/recent-error');
  const { host } = productHost();
  const models = [];
  let progressCompleted = 0;
  const result = { id: 'recent-error', prompt: 'a tiny ferry', model: rawModel, saveStatus: 'saved' };
  const app = mountProductApp(host, mountOptions({
    feedClient: { list: async () => ({ items: [result] }), async getResult() { return result; } },
    stageFactory(_host, options) { models.push(options.model); return { setModel() {}, dispose() {} }; },
    progressFactory: () => ({ setPhase() {}, complete() { progressCompleted += 1; }, dispose() {} }),
    comparisonFactory() { throw new Error('comparison mount failed'); },
  }));

  await settle();
  assert.deepEqual(models, [rawModel]);
  assert.match(host.querySelector('.guide-host').innerHTML, /Instructions unavailable/);
  assert.equal(host.querySelector('.instructions').hidden, false);
  assert.equal(progressCompleted, 1);
  assert.equal(host.querySelector('.detail-copy h1').textContent, 'a tiny ferry');
  app.dispose();
});

test('a metadata-free saved set can request local background naming', async () => {
  installBrowser('#set/recent-2');
  const { host } = productHost();
  let previewCalls = 0;
  const stageModels = [];
  let comparisonOptions;
  const result = { id: 'recent-2', prompt: 'a small garden', model: rawModel, saveStatus: 'saved' };
  const app = mountProductApp(host, mountOptions({
    allowSemanticInference: true,
    feedClient: { list: async () => ({ items: [result] }), async getResult() { return result; } },
    previewClient: { async prepare(model) { previewCalls += 1; return model; }, dispose() {} },
    stageFactory(_host, options) { stageModels.push(options.model); return { setModel() {}, dispose() {} }; },
    comparisonFactory(_host, options) { comparisonOptions = options; return () => {}; },
  }));

  await settle();
  assert.deepEqual(stageModels, [rawModel]);
  assert.equal(previewCalls, 0);
  assert.equal(comparisonOptions.allowSemanticInference, true);
  app.dispose();
});

test('a fresh raw cache hit can request local background naming', async () => {
  installBrowser();
  const { host, nodes, form } = productHost();
  let previewCalls = 0;
  const stageModels = [];
  let comparisonOptions;
  const app = mountProductApp(host, mountOptions({
    allowSemanticInference: true,
    generationClient: {
      async generate() {
        return { resultId: 'cache-hit-1', prompt: 'a small greenhouse', model: rawModel, cacheHit: true, saveStatus: 'saved' };
      },
    },
    previewClient: { async prepare(model) { previewCalls += 1; return model; }, dispose() {} },
    stageFactory(_host, options) {
      if (options.model) stageModels.push(options.model);
      return { setModel(model) { stageModels.push(model); }, setLoading() {}, dispose() {} };
    },
    progressFactory: () => ({ setPhase() {}, complete() {}, dispose() {} }),
    comparisonFactory(_host, options) { comparisonOptions = options; return () => {}; },
  }));

  nodes.get('#prompt').value = 'a small greenhouse';
  form.dispatch('submit');
  await settle();
  assert.deepEqual(stageModels, [rawModel]);
  assert.equal(previewCalls, 0);
  assert.equal(comparisonOptions.allowSemanticInference, true);
  app.dispose();
});

test('saved examples remain cache-only when local naming is enabled', async () => {
  installBrowser('#set/example-1');
  const { host } = productHost();
  let comparisonOptions;
  const result = { id: 'example-1', prompt: 'a saved lighthouse', model: rawModel, example: true };
  const app = mountProductApp(host, mountOptions({
    allowSemanticInference: true,
    exampleClient: { list: async () => ({ items: [result] }), async getResult() { return result; } },
    stageFactory: () => ({ setModel() {}, dispose() {} }),
    comparisonFactory(_host, options) { comparisonOptions = options; return () => {}; },
  }));

  await settle();
  assert.equal(comparisonOptions.allowSemanticInference, false);
  app.dispose();
});
