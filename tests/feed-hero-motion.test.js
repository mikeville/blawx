import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGO_MOVIE,
  computeLegoMovieStartFrames,
  legoMovieDurationFrames,
  legoMoviePose,
  referenceSvgToCssScale,
  seedFor,
  createEntranceGate,
} from '../mockups/feed/round2/hero-motion.js';

const brick = { x: 2, y: 3, z: 5, w: 2, d: 4 };

test('entrance is used only once across route changes and viewer remounts', () => {
  const entrance = createEntranceGate();
  assert.equal(entrance(), true);
  assert.equal(entrance(), false);
  assert.equal(entrance(), false);
  assert.equal(createEntranceGate()(), true);
});

test('reduced motion skips the entrance without postponing it to a later route', () => {
  const entrance = createEntranceGate();
  assert.equal(entrance(true), false);
  assert.equal(entrance(false), false);
});

test('round-two hero uses the exact active blawx2 legoMovie profile', () => {
  assert.deepEqual(LEGO_MOVIE, {
    fps: 10, staggerFrames: 6, order: 'front-to-back', maxTotalMs: 500,
    settleDepth: 0, arcHeight: 100, anticipationFrames: 4, dropFrames: 1,
    rippleTightness: 0.6, overshoot: 4, snapBackFrames: 0,
  });
  assert.equal(legoMovieDurationFrames(), 5);
});

test('reference SVG units scale through the exact Shell Scene viewBox fit', () => {
  const oneBrick = [{ x: 0, y: 0, z: 0, w: 2, d: 1 }];
  const cos30 = Math.cos(Math.PI / 6);
  const viewBoxWidth = 3 * cos30 * 24 + 32;
  const viewBoxHeight = 2.5 * 24 + 32;
  assert.equal(referenceSvgToCssScale(oneBrick, viewBoxWidth * 2, viewBoxHeight * 3), 2);
  assert.equal(referenceSvgToCssScale(oneBrick, viewBoxWidth * 4, viewBoxHeight * 0.5), 0.5);
});

test('front-to-back schedule preserves reference ordering and five-frame spread cap', () => {
  const bricks = Array.from({ length: 8 }, (_, index) => ({
    x: index, y: 0, z: index, w: 1, d: 1,
  }));
  const starts = computeLegoMovieStartFrames(bricks);
  assert.deepEqual(bricks.map((entry) => starts.get(entry)), [5, 4, 4, 3, 2, 1, 1, 0]);
});

test('legoMovie poses match the reference hidden, held, retreat, and landing frames', () => {
  const xStart = 100 * 0.6 * (seedFor(brick) * 2 - 1);
  assert.deepEqual(legoMoviePose(-1, brick), { visible: false, x: 0, y: 0 });
  assert.deepEqual(legoMoviePose(0, brick), { visible: true, x: xStart, y: -100 });
  assert.deepEqual(legoMoviePose(3, brick), { visible: true, x: xStart, y: -111.25 });
  assert.deepEqual(legoMoviePose(4, brick), { visible: true, x: xStart, y: -100 });
  assert.deepEqual(legoMoviePose(5, brick), { visible: true, x: 0, y: 0 });
  assert.deepEqual(legoMoviePose(99, brick), { visible: true, x: 0, y: 0 });
});
