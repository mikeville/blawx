import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createStudRenderSettings,
  DEFAULT_STUD_APPEARANCE,
  normalizeStudAppearance,
} from '../src/stud-appearance.js';

test('stud appearance uses the approved default and normalizes bounded finite multipliers', () => {
  assert.deepEqual(DEFAULT_STUD_APPEARANCE, { diameter: 0.8, height: 0.75 });
  assert.equal(Object.isFrozen(DEFAULT_STUD_APPEARANCE), true);
  assert.deepEqual(normalizeStudAppearance(), DEFAULT_STUD_APPEARANCE);
  assert.deepEqual(normalizeStudAppearance({}), DEFAULT_STUD_APPEARANCE);
  assert.deepEqual(normalizeStudAppearance({ diameter: NaN, height: '0.5' }), DEFAULT_STUD_APPEARANCE);
  assert.deepEqual(normalizeStudAppearance({ diameter: NaN, height: 0.5 }), { diameter: 0.8, height: 0.5 });
  assert.deepEqual(normalizeStudAppearance({ diameter: 0.7, height: Infinity }), { diameter: 0.7, height: 0.75 });
  assert.deepEqual(normalizeStudAppearance({ diameter: 0.7 }), { diameter: 0.7, height: 0.75 });
  assert.deepEqual(normalizeStudAppearance({ height: 0.5 }), { diameter: 0.8, height: 0.5 });
  assert.deepEqual(normalizeStudAppearance({ diameter: 0.2, height: 2 }), { diameter: 0.5, height: 1 });
  assert.deepEqual(normalizeStudAppearance({ diameter: 0.75, height: 0.5 }), { diameter: 0.75, height: 0.5 });
});

test('stud render settings preserve explicit original dimensions and anchor approved studs to the same base', () => {
  const source = [{ id: 'top', x: 2, y: 3, z: 4, color: 'red' }];
  const before = structuredClone(source);
  const original = createStudRenderSettings(source, 8, { diameter: 1, height: 1 });
  const approved = createStudRenderSettings(source, 8);

  assert.deepEqual(source, before, 'preview stud input remains immutable');
  assert.notStrictEqual(approved.studs[0], source[0]);
  assert.equal(original.radius, 2.45 / 8);
  assert.equal(original.height, 1.8 / 8);
  assert.equal(original.studs[0].y, source[0].y, 'explicit original output is geometrically identical');
  assert.equal(approved.radius, original.radius * DEFAULT_STUD_APPEARANCE.diameter);
  assert.equal(approved.height, original.height * DEFAULT_STUD_APPEARANCE.height);
  assert.ok(
    Math.abs(
      (approved.studs[0].y - approved.height / 2)
      - (original.studs[0].y - original.height / 2)
    ) < 1e-12,
    'the approved shorter stud retains the original base plane',
  );
});
