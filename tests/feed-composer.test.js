import test from 'node:test';
import assert from 'node:assert/strict';

import { mountComposer } from '../mockups/feed/round2/composer.js';

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

class FakeNode {
  constructor(tagName = '') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.classList = new ClassList();
    this.attributes = new Map();
    this.listeners = new Map();
    this.textContent = '';
    this.id = '';
    this.disabled = false;
    this.inert = false;
    this.hidden = false;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const index = this.parentNode.children.indexOf(this);
    return this.parentNode.children[index + 1] ?? null;
  }
  set className(value) {
    this.classList = new ClassList();
    value.split(/\s+/).filter(Boolean).forEach(name => this.classList.add(name));
  }
  set innerHTML(value) { this.textContent = value; }
  append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
  prepend(...nodes) { [...nodes].reverse().forEach(node => this.insertBefore(node, this.children[0] ?? null)); }
  insertBefore(node, reference) {
    node.parentNode?.removeChild(node);
    const index = reference === null ? this.children.length : this.children.indexOf(reference);
    this.children.splice(index < 0 ? this.children.length : index, 0, node);
    node.parentNode = this;
    return node;
  }
  removeChild(node) {
    const index = this.children.indexOf(node);
    if (index >= 0) this.children.splice(index, 1);
    node.parentNode = null;
  }
  remove() { this.parentNode?.removeChild(this); }
  replaceChildren(...nodes) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = [];
    this.textContent = nodes.filter(node => typeof node === 'string').join('');
    this.append(...nodes.filter(node => typeof node !== 'string'));
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  listenerCount(type) { return this.listeners.get(type)?.size ?? 0; }
  contains(node) {
    return this === node || this.children.some(child => child.contains(node));
  }
  matches(selector) {
    if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    return false;
  }
  querySelector(selector) {
    if (this.matches(selector)) return this;
    for (const child of this.children) {
      const match = child.querySelector(selector);
      if (match) return match;
    }
    return null;
  }
  closest(selector) {
    return this.matches(selector) ? this : this.parentNode?.closest(selector) ?? null;
  }
  focus() { globalThis.document.activeElement = this; }
  blur() { if (globalThis.document.activeElement === this) globalThis.document.activeElement = null; }
}

class FakeMedia {
  constructor(matches) {
    this.matches = matches;
    this.listeners = new Set();
  }
  addEventListener(type, listener) { if (type === 'change') this.listeners.add(listener); }
  removeEventListener(type, listener) { if (type === 'change') this.listeners.delete(listener); }
  set(matches) {
    this.matches = matches;
    for (const listener of this.listeners) listener({ matches });
  }
}

function fixture({ mobile = false, hash = '' } = {}) {
  const body = new FakeNode('body');
  const home = new FakeNode('section');
  const hero = new FakeNode('div');
  const composer = new FakeNode('div');
  composer.className = 'composer';
  const form = new FakeNode('form');
  const field = new FakeNode('div');
  field.className = 'prompt-field';
  const input = new FakeNode('input');
  input.id = 'prompt';
  input.value = 'a red dragon';
  const make = new FakeNode('button');
  make.className = 'make-button';
  make.textContent = 'Make it';
  const message = new FakeNode('p');
  message.id = 'form-message';
  field.append(input);
  form.append(field, make);
  composer.append(form, message);
  home.append(hero, composer);
  body.append(home);
  const media = new FakeMedia(mobile);
  globalThis.document = {
    body,
    activeElement: null,
    createElement: tag => new FakeNode(tag),
    createComment: () => new FakeNode('#comment'),
  };
  globalThis.window = { location: { hash }, matchMedia: () => media };
  return { body, home, composer, form, field, input, make, message, media };
}

test('circle composer restores the native desktop form and preserves its draft across breakpoints', () => {
  const view = fixture({ mobile: false });
  const controller = mountComposer({
    composer: view.composer,
    promptInput: view.input,
    form: view.form,
    mode: 'circle',
    homeHost: view.home,
  });

  assert.equal(view.composer.parentNode, view.home);
  assert.equal(view.input.disabled, false);
  assert.equal(view.composer.classList.contains('floating-composer'), false);

  view.media.set(true);
  assert.equal(view.composer.parentNode, view.body);
  assert.equal(view.make.getAttribute('aria-expanded'), 'true');
  view.input.value = 'a blue pickup truck';

  view.media.set(false);
  assert.equal(view.composer.parentNode, view.home);
  assert.equal(view.input.disabled, false);
  assert.equal(view.input.inert, false);
  assert.equal(view.input.value, 'a blue pickup truck');
  assert.equal(view.make.textContent, 'Make it');

  view.home.hidden = true;
  assert.equal(view.composer.parentNode.hidden, true);
  controller.dispose();
  assert.equal(view.media.listeners.size, 0);
  assert.equal(view.form.listenerCount('submit'), 0);
});

test('direct mobile detail starts collapsed and remains usable after desktop restoration', () => {
  const view = fixture({ mobile: true, hash: '#set/cat' });
  const controller = mountComposer({
    composer: view.composer,
    promptInput: view.input,
    form: view.form,
    mode: 'circle',
    homeHost: view.home,
  });

  assert.equal(view.composer.parentNode, view.body);
  assert.equal(view.composer.classList.contains('is-collapsed'), true);
  assert.equal(view.input.disabled, true);
  assert.equal(view.field.inert, true);
  assert.equal(view.make.getAttribute('aria-expanded'), 'false');

  view.media.set(false);
  assert.equal(view.composer.parentNode, view.home);
  assert.equal(view.input.disabled, false);
  assert.equal(view.field.inert, false);
  assert.equal(view.input.value, 'a red dragon');

  controller.dispose();
  assert.equal(view.media.listeners.size, 0);
});
