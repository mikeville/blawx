import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, UNIT } from './iso.ts';

const COS30 = Math.cos(Math.PI / 6);
const SIN30 = Math.sin(Math.PI / 6);

test('origin projects to (0, 0)', () => {
  const p = project(0, 0, 0);
  assert.equal(p.x, 0);
  assert.equal(p.y, 0);
});

test('moving +x goes right-and-down in screen space', () => {
  const p = project(1, 0, 0);
  assert.ok(Math.abs(p.x - COS30 * UNIT) < 1e-9);
  assert.ok(Math.abs(p.y - SIN30 * UNIT) < 1e-9);
});

test('moving +z goes left-and-down in screen space', () => {
  const p = project(0, 0, 1);
  assert.ok(Math.abs(p.x - -COS30 * UNIT) < 1e-9);
  assert.ok(Math.abs(p.y - SIN30 * UNIT) < 1e-9);
});

test('moving +y goes straight up in screen space (negative y in SVG)', () => {
  const p = project(0, 1, 0);
  assert.equal(p.x, 0);
  assert.ok(Math.abs(p.y - -UNIT) < 1e-9);
});

test('opposite corners on x-z plane are horizontally aligned', () => {
  const a = project(1, 0, 1);
  const b = project(0, 0, 0);
  assert.equal(a.x, b.x);
  assert.ok(a.y > b.y);
});
