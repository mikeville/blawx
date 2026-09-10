import test from 'node:test';
import assert from 'node:assert/strict';
import { mountScrollAwareHeader } from '../src/scroll-aware-header.js';

function fixture({ y = 0, height = 64 } = {}) {
  const listeners = new Map();
  const frames = new Map();
  let nextFrame = 1;
  const style = new Map();
  const rootStyle = new Map();
  let currentHeight = height;
  const header = {
    style: {
      setProperty: (key, value) => style.set(key, value),
      removeProperty: (key) => style.delete(key),
    },
    getBoundingClientRect: () => ({ height: currentHeight }),
  };
  const doc = { documentElement: { style: {
    setProperty: (key, value) => rootStyle.set(key, value),
    removeProperty: (key) => rootStyle.delete(key),
  } } };
  const win = {
    scrollY: y,
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type); },
  };
  const raf = (fn) => { const id = nextFrame++; frames.set(id, fn); return id; };
  const caf = (id) => frames.delete(id);
  const runFrame = () => { const entries = [...frames.entries()]; frames.clear(); entries.forEach(([, fn]) => fn()); };
  return { header, doc, win, raf, caf, style, rootStyle, listeners, frames, runFrame,
    setHeight: (value) => { currentHeight = value; } };
}

function mount(f) { return mountScrollAwareHeader(f.header, { win: f.win, doc: f.doc, raf: f.raf, caf: f.caf }); }

test('moves proportionally down and back up, with clamping', () => {
  const f = fixture(); mount(f);
  f.win.scrollY = 20; f.listeners.get('scroll')(); f.runFrame();
  assert.equal(f.style.get('transform'), 'translateY(-20px)');
  assert.equal(f.rootStyle.get('--header-visible-height'), '44px');
  f.win.scrollY = 100; f.listeners.get('scroll')(); f.runFrame();
  assert.equal(f.style.get('transform'), 'translateY(-64px)');
  f.win.scrollY = 70; f.listeners.get('scroll')(); f.runFrame();
  assert.equal(f.style.get('transform'), 'translateY(-34px)');
});

test('resets at the top and coalesces scroll work into one frame', () => {
  const f = fixture(); mount(f);
  f.win.scrollY = 40; f.listeners.get('scroll')(); f.win.scrollY = 50; f.listeners.get('scroll')();
  assert.equal(f.frames.size, 1);
  f.runFrame(); assert.equal(f.style.get('transform'), 'translateY(-50px)');
  f.win.scrollY = 0; f.listeners.get('scroll')(); f.runFrame();
  assert.equal(f.style.get('transform'), 'translateY(0)');
  assert.equal(f.rootStyle.get('--header-visible-height'), '64px');
});

test('resize remeasures and publishes visible height', () => {
  const f = fixture(); mount(f);
  f.win.scrollY = 24; f.listeners.get('scroll')(); f.runFrame();
  f.setHeight(80); f.listeners.get('resize')(); f.runFrame();
  assert.equal(f.style.get('transform'), 'translateY(-24px)');
  assert.equal(f.rootStyle.get('--header-visible-height'), '56px');
});

test('dispose cancels work, listeners, and inline state', () => {
  const f = fixture(); const controller = mount(f);
  f.win.scrollY = 20; f.listeners.get('scroll')(); assert.equal(f.frames.size, 1);
  controller.dispose();
  assert.equal(f.frames.size, 0); assert.equal(f.listeners.size, 0);
  assert.equal(f.style.size, 0); assert.equal(f.rootStyle.size, 0);
});
