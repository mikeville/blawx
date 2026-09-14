import test from 'node:test';
import assert from 'node:assert/strict';

import { staticPreviewScene } from '../src/static-model-stage.js';
import { mountModelStage } from '../src/model-stage.js';

test('static fallback derives a drawable isometric scene from generated bricks', () => {
  const model = {
    version: 1,
    kind: 'bricks',
    meta: { scale: { studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 } },
    bricks: [
      { id: 'top', x: 0, y: 1, z: 0, w: 1, d: 1, color: 'red' },
      { id: 'base', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'blue' },
    ],
  };
  const before = JSON.stringify(model);
  const scene = staticPreviewScene(model);

  assert.deepEqual(scene.bodies.map(body => body.id), ['base', 'top']);
  assert.ok(scene.studs.length > 0);
  assert.ok(scene.bounds.maxX > scene.bounds.minX);
  assert.ok(scene.bounds.maxY > scene.bounds.minY);
  assert.equal(JSON.stringify(model), before);
});

test('static fallback supports raw 1×1 source geometry before packing finishes', () => {
  const scene = staticPreviewScene({
    version: 1,
    kind: 'voxels',
    cells: [{ x: 0, y: 0, z: 0, color: 'yellow' }],
  });

  assert.equal(scene.bodies.length, 1);
  assert.equal(scene.bodies[0].color, 'yellow');
  assert.equal(scene.studs.length, 1);
});

test('shared stage mounts the static canvas when WebGL creation fails', () => {
  const drawings = { polygons: 0, studs: 0 };
  const context = {
    beginPath() {}, clearRect() {}, closePath() {}, fill() { drawings.polygons += 1; },
    lineTo() {}, moveTo() {}, setTransform() {}, stroke() {},
    ellipse() { drawings.studs += 1; },
  };
  class FakeElement {
    constructor(tagName = 'div') {
      this.tagName = tagName;
      this.children = [];
      this.dataset = {};
      this.style = {};
      this.clientWidth = 320;
      this.clientHeight = 240;
      this.attributes = new Map();
      this.className = '';
    }
    append(...children) {
      for (const child of children) child.parentNode = this;
      this.children.push(...children);
    }
    remove() {
      this.removed = true;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
    }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    addEventListener() {}
    removeEventListener() {}
    getContext(type) { return type === '2d' ? context : null; }
  }
  globalThis.document = { createElement: tagName => new FakeElement(tagName) };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  const host = new FakeElement();
  const stage = mountModelStage(host, {
    model: { version: 1, kind: 'voxels', cells: [{ x: 0, y: 0, z: 0, color: 'red' }] },
    label: 'Fallback set',
    rendererFactory() { throw new Error('WebGL unavailable'); },
  });

  assert.equal(host.children.length, 1, 'failed WebGL root is replaced by the fallback root');
  assert.equal(stage.element.className, 'hero-renderer static-model-stage');
  assert.equal(stage.element.children[0].attributes.get('aria-label'), 'Fallback set');
  assert.ok(drawings.polygons >= 3);
  assert.ok(drawings.studs >= 1);
  stage.dispose();
});
