import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_ROTATION_DEFAULTS,
  heroCameraRadius,
  normalizeHeroRotation,
  quantizeHeroAzimuth,
} from '../src/hero-rotation.js';

const elevation = Math.atan(1 / Math.sqrt(2));
const input = { halfX: 8, halfY: 5, halfZ: 3, aspect: 1.6, elevation, padding: 1.18 };
function originalRadius(azimuth) {
  const horizontal = Math.abs(Math.cos(azimuth)) * input.halfX + Math.abs(Math.sin(azimuth)) * input.halfZ;
  const vertical = Math.abs(Math.sin(elevation)) * (Math.abs(Math.sin(azimuth)) * input.halfX + Math.abs(Math.cos(azimuth)) * input.halfZ)
    + Math.abs(Math.cos(elevation)) * input.halfY;
  return Math.max(vertical, horizontal / input.aspect, 1) * input.padding;
}

test('production hero defaults lock the selected values without mutable state', () => {
  assert.deepEqual(HERO_ROTATION_DEFAULTS, { pulse:2, pulseFrequency:.5, size:1, dragSpeed:1.75, poseStep:0 });
  assert.equal(Object.isFrozen(HERO_ROTATION_DEFAULTS), true);
  assert.deepEqual(normalizeHeroRotation(), HERO_ROTATION_DEFAULTS);
  const normalized = normalizeHeroRotation();
  normalized.pulse = 0;
  assert.equal(HERO_ROTATION_DEFAULTS.pulse, 2);
  const chosen = heroCameraRadius({ ...input, azimuth:.8, ...HERO_ROTATION_DEFAULTS });
  const anchor = Math.PI * .75;
  const fixed = heroCameraRadius({ ...input, azimuth:.8, pulse:0 });
  const fit = originalRadius(anchor + (.8 - anchor) * .5);
  assert.ok(Math.abs(chosen - fixed * Math.pow(fit / fixed, 2)) < 1e-10);
});

test('original projected fit and continuous pose remain available for unconfigured stages', () => {
  for (const azimuth of [.2, .8, 1.7, 2.6]) {
    assert.ok(Math.abs(heroCameraRadius({ ...input, azimuth, pulse:1, pulseFrequency:1, size:1 }) - originalRadius(azimuth)) < 1e-10);
    assert.equal(quantizeHeroAzimuth(azimuth, 0), azimuth);
  }
});

test('pulse zero is all-yaw constant and pulse two exaggerates the existing ratio', () => {
  const zero = [.2, .8, 1.7].map(azimuth => heroCameraRadius({ ...input, azimuth, pulse:0 }));
  assert.equal(new Set(zero.map(value => value.toFixed(10))).size, 1);
  const azimuth = .8;
  const fixed = heroCameraRadius({ ...input, azimuth, pulse:0 });
  const normal = heroCameraRadius({ ...input, azimuth, pulse:1 });
  const doubled = heroCameraRadius({ ...input, azimuth, pulse:2 });
  assert.ok(Math.abs(doubled / fixed - Math.pow(normal / fixed, 2)) < 1e-10);
});

test('pulse frequency changes only the projected-fit waveform rate', () => {
  const anchor = Math.PI * .75;
  for (const displacement of [-1.1, -.45, 0, .3, .9]) {
    const normal = heroCameraRadius({ ...input, azimuth: anchor + displacement * 2 });
    const faster = heroCameraRadius({ ...input, azimuth: anchor + displacement, pulseFrequency: 2 });
    assert.ok(Math.abs(faster - normal) < 1e-10);
  }

  const normalSamples = [];
  const fasterSamples = [];
  for (let index = 0; index <= 7200; index += 1) {
    const displacement = -Math.PI + index * Math.PI / 3600;
    normalSamples.push(heroCameraRadius({ ...input, azimuth: anchor + displacement }));
    fasterSamples.push(heroCameraRadius({ ...input, azimuth: anchor + displacement, pulseFrequency: 2 }));
  }
  assert.ok(Math.abs(Math.min(...normalSamples) - Math.min(...fasterSamples)) < 1e-5);
  assert.ok(Math.abs(Math.max(...normalSamples) - Math.max(...fasterSamples)) < 1e-5);
});

test('zero pulse, size, and interaction sensitivity stay independent of pulse frequency', () => {
  const steady = [.25, 1, 2, 4].map(pulseFrequency => heroCameraRadius({
    ...input,
    azimuth: .37,
    pulse: 0,
    pulseFrequency,
  }));
  assert.equal(new Set(steady.map(value => value.toFixed(10))).size, 1);

  const base = heroCameraRadius({ ...input, azimuth: .9, pulseFrequency: 3, size: 1 });
  const larger = heroCameraRadius({ ...input, azimuth: .9, pulseFrequency: 3, size: 1.25 });
  assert.ok(Math.abs(base / larger - 1.25) < 1e-10);
  assert.equal(normalizeHeroRotation({ pulseFrequency: 3 }).dragSpeed, HERO_ROTATION_DEFAULTS.dragSpeed);
});

test('settings clamp and preserve immutable defaults', () => {
  assert.deepEqual(normalizeHeroRotation({ pulse:9, pulseFrequency:9, size:0, dragSpeed:3, poseStep:-2 }), { pulse:2, pulseFrequency:4, size:.65, dragSpeed:2, poseStep:0 });
  assert.equal(normalizeHeroRotation({ pulseFrequency:0 }).pulseFrequency, .25);
  assert.equal(normalizeHeroRotation({ pulseFrequency:'invalid' }).pulseFrequency, .5);
  assert.notEqual(normalizeHeroRotation(), normalizeHeroRotation());
  assert.equal(quantizeHeroAzimuth(Math.PI*.75+.12, 15), Math.PI*.75);
});
