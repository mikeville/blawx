import test from 'node:test';
import assert from 'node:assert/strict';

import { mountPromptField } from '../src/prompt-field.js';

class ClassList {
  constructor() { this.values = new Set(); }
  toggle(name, force) { if (force) this.values.add(name); else this.values.delete(name); }
  contains(name) { return this.values.has(name); }
}

class Style {
  removeProperty(name) {
    const property = name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    delete this[property];
  }
}

class Target {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  emit(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

class Media extends Target {
  constructor(matches) { super(); this.matches = matches; }
  set(matches) { this.matches = matches; this.emit('change', { matches }); }
}

function fixture({ mobile = false, value = '', scrollHeight = 72, maxHeight = '120px' } = {}) {
  const media = new Media(mobile);
  const field = { classList: new ClassList(), width: 500, getBoundingClientRect() { return { width: this.width }; } };
  const form = { classList: new ClassList(), submissions: 0, requestSubmit() { this.submissions += 1; } };
  const input = new Target();
  Object.assign(input, {
    value, scrollHeight, clientHeight: Math.min(scrollHeight, Number.parseFloat(maxHeight)),
    scrollTop: 0, selectionStart: 0, selectionEnd: 0,
    style: new Style(), attributes: new Map(), wrap: '',
    closest: selector => selector === '.prompt-field' ? field : null,
    setAttribute(name, next) { this.attributes.set(name, String(next)); },
    removeAttribute(name) { this.attributes.delete(name); },
    getAttribute(name) { return this.attributes.get(name) ?? null; },
  });
  const note = { id: 'public-note', hidden: true };
  const windowTarget = new Target();
  Object.assign(windowTarget, {
    matchMedia: () => media, scrollX: 0, scrollY: 0,
    scrollTo(x, y) { this.scrollX = x; this.scrollY = y; },
  });
  let nextFrame = 0;
  const frames = new Map();
  let observer;
  globalThis.window = windowTarget;
  globalThis.document = { activeElement: null, fonts: undefined };
  globalThis.getComputedStyle = () => ({ maxHeight });
  globalThis.requestAnimationFrame = callback => { const id = ++nextFrame; frames.set(id, callback); return id; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; this.disconnected = false; observer = this; }
    observe(target) { this.target = target; }
    disconnect() { this.disconnected = true; }
  };
  const flush = () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(callback => callback()); };
  return { media, field, form, input, note, windowTarget, flush, get observer() { return observer; } };
}

function keydown(view, overrides = {}) {
  let prevented = false;
  view.input.emit('keydown', {
    key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13, defaultPrevented: false,
    preventDefault() { prevented = true; }, ...overrides,
  });
  return prevented;
}

test('initial restored draft and later typing keep state and public note in sync', () => {
  const view = fixture({ value: '  a red dragon  ' });
  const controller = mountPromptField({ input: view.input, form: view.form, publicNote: view.note });
  assert.equal(view.form.classList.contains('has-prompt'), true);
  assert.equal(view.field.classList.contains('has-prompt'), true);
  assert.equal(view.note.hidden, false);
  assert.equal(view.input.getAttribute('aria-describedby'), 'public-note');

  view.input.value = '   ';
  view.input.emit('input');
  assert.equal(view.form.classList.contains('has-prompt'), false);
  assert.equal(view.note.hidden, true);
  assert.equal(view.input.getAttribute('aria-describedby'), null);
  view.input.value = 'pickup';
  controller.sync();
  assert.equal(view.note.hidden, false);
  controller.dispose();
});

test('desktop autosizes and caps overflow, while mobile restores the compact native field', () => {
  const view = fixture({ scrollHeight: 84, maxHeight: '100px' });
  const controller = mountPromptField({ input: view.input, form: view.form, publicNote: view.note });
  assert.equal(view.input.wrap, 'soft');
  assert.equal(view.input.style.height, '84px');
  assert.equal(view.input.style.overflowY, 'hidden');
  assert.equal(view.input.style.overflowX, 'hidden');

  view.input.scrollHeight = 160;
  view.input.emit('input');
  assert.equal(view.input.style.height, '100px');
  assert.equal(view.input.style.overflowY, 'auto');

  view.media.set(true);
  view.flush();
  assert.equal(view.input.wrap, 'off');
  assert.equal(view.input.style.height, undefined);
  assert.equal(view.input.style.overflowY, undefined);
  assert.equal(view.input.style.overflowX, undefined);

  view.media.set(false);
  view.flush();
  assert.equal(view.input.wrap, 'soft');
  assert.equal(view.input.style.height, '100px');
  controller.dispose();
  assert.equal(view.observer.disconnected, true);
  assert.equal(view.media.listeners.get('change').size, 0);
  assert.equal(view.windowTarget.listeners.get('resize').size, 0);
});

test('desktop autosize preserves internal scroll and keeps only an active end caret at the bottom', () => {
  const view = fixture({ value: 'A'.repeat(500), scrollHeight: 1378, maxHeight: '370px' });
  view.input.scrollTop = 240;
  view.input.selectionStart = 250;
  view.input.selectionEnd = 250;
  globalThis.document.activeElement = view.input;
  const controller = mountPromptField({ input: view.input, form: view.form, publicNote: view.note });
  assert.equal(view.input.scrollTop, 240, 'middle editing keeps its prior internal position');

  view.input.selectionStart = view.input.value.length;
  view.input.selectionEnd = view.input.value.length;
  view.input.scrollTop = 0;
  controller.sync();
  assert.equal(view.input.scrollTop, 1008, 'collapsed end caret is revealed at the bottom');

  globalThis.document.activeElement = null;
  view.input.scrollTop = 315;
  controller.sync();
  assert.equal(view.input.scrollTop, 315, 'inactive textarea also preserves internal scroll');
  controller.dispose();
});

test('resize observation ignores height-only changes and disposal cancels queued work', () => {
  const view = fixture();
  const controller = mountPromptField({ input: view.input, form: view.form, publicNote: view.note });
  view.observer.callback([{ target: view.field, contentRect: { width: 500, height: 40 } }]);
  view.flush();
  view.input.style.height = 'sentinel';
  view.observer.callback([{ target: view.field, contentRect: { width: 500, height: 90 } }]);
  view.flush();
  assert.equal(view.input.style.height, 'sentinel');
  view.windowTarget.emit('resize');
  controller.dispose();
  view.flush();
  assert.equal(view.input.style.height, 'sentinel');
});

test('Enter submits except composition and desktop Shift+Enter; mobile Shift+Enter submits', () => {
  const view = fixture({ value: '' });
  const controller = mountPromptField({ input: view.input, form: view.form, publicNote: view.note });
  assert.equal(keydown(view), true);
  assert.equal(view.form.submissions, 1, 'empty input still uses native requestSubmit validation path');
  assert.equal(keydown(view, { isComposing: true }), false);
  assert.equal(keydown(view, { keyCode: 229 }), false);
  assert.equal(keydown(view, { defaultPrevented: true }), false);
  assert.equal(keydown(view, { shiftKey: true }), false);
  assert.equal(view.form.submissions, 1);

  view.media.set(true);
  view.flush();
  assert.equal(keydown(view, { shiftKey: true }), true);
  assert.equal(view.form.submissions, 2);
  controller.dispose();
});
