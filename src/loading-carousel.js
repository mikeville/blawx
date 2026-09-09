import * as THREE from 'three';
import { PALETTE } from './geometry.js';
import { getBrickFaceColor } from './product-viewer.js';
import { createStudRenderSettings } from './stud-appearance.js';
import { DARK_BRICK_OUTLINE_COLOR } from './black-piece-ink.js';

const TAU = Math.PI * 2;
const PIECE_COUNT = 14;
const UNIT = 0.7;
const BODY_HEIGHT = 0.833;
const BODY_DEPTH = 1.375;
const COLORS = ['red', 'yellow', 'blue', 'white', 'green'];

export const LOADING_CAROUSEL = Object.freeze({
  pieceCount: PIECE_COUNT,
  radiusX: 8,
  radiusZ: 6,
  angularSpeed: 0.27,
  posesPerSecond: 12,
});

export const LOADING_CAROUSEL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-10, -2.2, -8),
  new THREE.Vector3(10, 1.2, 8),
);

// The four unequal exposures repeat on a 72 Hz authoring clock. Together they
// average twelve held poses per second without a mechanically even cadence.
export function loadingCarouselHeldTime(time) {
  const ticks = Math.max(0, time) * 72;
  const cycle = Math.floor(ticks / 24);
  const within = ticks - cycle * 24;
  const heldTick = within < 6 ? 0 : within < 12 ? 6 : within < 17 ? 12 : 17;
  return (cycle * 24 + heldTick) / 72;
}

export function loadingCarouselPose(index, time) {
  const heldTime = loadingCarouselHeldTime(time);
  const angle = index * TAU / PIECE_COUNT + heldTime * LOADING_CAROUSEL.angularSpeed;
  const registration = Math.sin(index * 2.17 + heldTime * 1.31) * 0.055;
  return {
    x: Math.cos(angle) * LOADING_CAROUSEL.radiusX,
    y: -0.7 + Math.sin(angle * 2 + heldTime * 0.4) + registration,
    z: Math.sin(angle) * LOADING_CAROUSEL.radiusZ,
    rx: Math.sin(index * 1.73 + heldTime * 0.61) * 0.018,
    ry: 0,
    rz: Math.cos(index * 1.19 - heldTime * 0.53) * 0.024,
  };
}

export function createLoadingCarousel(scene) {
  const root = new THREE.Group();
  const pieces = [];
  const resources = [];
  const dark = new THREE.MeshBasicMaterial({ color: DARK_BRICK_OUTLINE_COLOR });
  const lineMaterial = new THREE.LineBasicMaterial({ color: DARK_BRICK_OUTLINE_COLOR });
  const { radius: studRadius, height: studHeight } = createStudRenderSettings([], 8 / UNIT);
  const studGeometry = new THREE.CylinderGeometry(studRadius, studRadius, studHeight, 32);
  const studWallGeometry = new THREE.CylinderGeometry(studRadius, studRadius, studHeight, 32, 1, true);
  const rimGeometry = new THREE.BufferGeometry().setFromPoints(Array.from({ length: 33 }, (_, index) => {
    const angle = index * TAU / 32;
    return new THREE.Vector3(Math.cos(angle) * studRadius, studHeight / 2, Math.sin(angle) * studRadius);
  }));
  resources.push(dark, lineMaterial, studGeometry, studWallGeometry, rimGeometry);

  for (let index = 0; index < PIECE_COUNT; index += 1) {
    const studsAcross = index % 3 === 0 ? 2 : 4;
    const bodyGeometry = new THREE.BoxGeometry(studsAcross * UNIT - 0.025, BODY_HEIGHT, BODY_DEPTH);
    const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry);
    const material = new THREE.MeshLambertMaterial({
      color: getBrickFaceColor(PALETTE[COLORS[index % COLORS.length]]),
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    const piece = new THREE.Group();
    piece.add(new THREE.Mesh(bodyGeometry, material));
    piece.add(new THREE.LineSegments(edgeGeometry, lineMaterial));
    for (let x = 0; x < studsAcross; x += 1) {
      for (let z = 0; z < 2; z += 1) {
        const stud = new THREE.Group();
        stud.position.set(
          (x - (studsAcross - 1) / 2) * UNIT,
          BODY_HEIGHT / 2 + studHeight / 2,
          (z - 0.5) * UNIT,
        );
        stud.add(new THREE.Mesh(studGeometry, material));
        stud.add(new THREE.Mesh(studWallGeometry, dark));
        stud.add(new THREE.Line(rimGeometry, lineMaterial));
        piece.add(stud);
      }
    }
    root.add(piece);
    pieces.push(piece);
    resources.push(bodyGeometry, edgeGeometry, material);
  }

  scene.add(root);
  let disposed = false;

  function update(time, { reducedMotion = false } = {}) {
    if (disposed) return;
    const posedTime = reducedMotion ? 1.9 : time;
    pieces.forEach((piece, index) => {
      const pose = loadingCarouselPose(index, posedTime);
      piece.position.set(pose.x, pose.y, pose.z);
      piece.rotation.set(pose.rx, pose.ry, pose.rz);
      piece.updateMatrixWorld();
    });
  }

  update(0);
  return {
    root,
    bounds: LOADING_CAROUSEL_BOUNDS.clone(),
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      for (const resource of resources) resource.dispose?.();
    },
  };
}
