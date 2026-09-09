import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createLoadingCarousel, loadingCarouselPose, loadingCarouselHeldTime, LOADING_CAROUSEL } from '../src/loading-carousel.js';

test('carousel holds poses while the orbital timeline advances without accumulated drift', () => {
  assert.deepEqual(loadingCarouselPose(2, .01), loadingCarouselPose(2, .07));
  assert.notDeepEqual(loadingCarouselPose(2, .07), loadingCarouselPose(2, .09));
  for (const time of [0, 1, 23, 90, 600]) {
    const held = loadingCarouselHeldTime(time);
    assert.ok(held <= time && time - held < .1);
    for (let index = 0; index < LOADING_CAROUSEL.pieceCount; index++) {
      const pose = loadingCarouselPose(index, time);
      assert.ok(Object.values(pose).every(Number.isFinite));
      assert.ok(Math.abs(pose.x) <= 8 && Math.abs(pose.z) <= 6);
      assert.ok(Math.abs(pose.rx) <= .018 && Math.abs(pose.rz) <= .024);
    }
  }
});

test('reduced-motion tableau stays fixed and carousel resources detach on disposal', () => {
  const scene = new THREE.Scene();
  const carousel = createLoadingCarousel(scene);
  assert.equal(carousel.root.children.length, 14);
  carousel.update(1, { reducedMotion: true });
  const first = carousel.root.children.map(piece => piece.matrixWorld.toArray());
  carousel.update(25, { reducedMotion: true });
  assert.deepEqual(carousel.root.children.map(piece => piece.matrixWorld.toArray()), first);
  carousel.update(25, { reducedMotion: false });
  assert.notDeepEqual(carousel.root.children.map(piece => piece.matrixWorld.toArray()), first);
  carousel.dispose();
  carousel.dispose();
  assert.equal(scene.children.length, 0);
});
