import * as THREE from 'three';
import { PALETTE } from '../../../src/geometry.js';
import { brickPreviewData } from '../../../src/brick-preview.js';
import { getSavedResult } from './data.js';
import {
  LEGO_MOVIE,
  computeLegoMovieStartFrames,
  legoMovieDurationFrames,
  legoMoviePose,
  referenceSvgToCssScale,
} from './hero-motion.js';

const FRAME_MS = 1000 / LEGO_MOVIE.fps;
const ISO_AZIMUTH = Math.PI * 0.75;
const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2));
const DRAG_THRESHOLD = 6;
const matrix = new THREE.Matrix4();

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function makeFallback(set) {
  const image = document.createElement('img');
  image.className = 'hero-fallback';
  image.alt = '';
  image.draggable = false;
  image.src = set?.image ?? '';
  Object.assign(image.style, {
    position: 'absolute',
    inset: '0',
    width: '100%',
    height: '100%',
    objectFit: 'contain',
    transition: 'opacity 200ms steps(2, end)',
  });
  return image;
}

/**
 * Mount the saved-set stage used only by the Round 2 feed mockup.
 * The animation is a presentation flourish, not an assembly sequence.
 */
export function mountHero(host, { set, onOpen, animate = true }) {
  const root = document.createElement('div');
  root.className = 'hero-renderer';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });

  const fallback = makeFallback(set);
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.dataset.phase = 'loading';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', onOpen ? 'button' : 'img');
  canvas.setAttribute('aria-label', set?.title
    ? `${onOpen ? 'Open ' : ''}${set.title}, interactive 3D LEGO-style set`
    : `${onOpen ? 'Open ' : ''}interactive 3D LEGO-style set`);
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    display: 'block', opacity: '0', touchAction: 'pan-y', cursor: 'grab', outlineOffset: '-3px',
  });
  root.append(fallback, canvas);
  host.append(root);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
  const group = new THREE.Group();
  scene.add(group);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(-10, 16, 12);
  scene.add(keyLight);

  let disposed = false;
  let requestVersion = 0;
  let raf = null;
  let azimuth = ISO_AZIMUTH;
  let center = new THREE.Vector3();
  let distance = 30;
  let modelBounds = new THREE.Box3();
  let animation = null;
  let resources = [];
  let meshGroups = [];
  let pointer = null;

  function render() {
    if (!disposed) renderer.render(scene, camera);
  }

  function scheduleRender() {
    if (disposed || raf !== null) return;
    raf = requestAnimationFrame(tick);
  }

  function updateCamera() {
    const horizontal = Math.cos(ISO_ELEVATION) * distance;
    camera.position.set(
      center.x + Math.sin(azimuth) * horizontal,
      center.y + Math.sin(ISO_ELEVATION) * distance,
      center.z + Math.cos(azimuth) * horizontal,
    );
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    fitCamera(modelBounds);
    camera.updateProjectionMatrix();
    scheduleRender();
  }

  function fitCamera(bounds) {
    if (bounds.isEmpty()) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    let halfWidth = 0;
    let halfHeight = 0;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const relative = new THREE.Vector3(x, y, z).sub(center);
          halfWidth = Math.max(halfWidth, Math.abs(relative.dot(right)));
          halfHeight = Math.max(halfHeight, Math.abs(relative.dot(up)));
        }
      }
    }
    const verticalRadius = Math.max(halfHeight, halfWidth / aspect, 1) * 1.18;
    camera.left = -verticalRadius * aspect;
    camera.right = verticalRadius * aspect;
    camera.top = verticalRadius;
    camera.bottom = -verticalRadius;
  }

  function resize() {
    if (disposed) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    updateCamera();
    if (animation) {
      animation.svgToCssScale = referenceSvgToCssScale(animation.sourceBricks, width, height);
      applyFrame(Math.max(0, animation.frame));
    }
  }

  function clearModel() {
    animation = null;
    for (const child of [...group.children]) group.remove(child);
    for (const resource of resources) resource.dispose?.();
    resources = [];
    meshGroups = [];
  }

  function applyFrame(frame) {
    const worldPerPixel = root.clientHeight > 0
      ? (camera.top - camera.bottom) / root.clientHeight
      : 0;
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    for (const { mesh, entries, stud } of meshGroups) {
      entries.forEach((entry, index) => {
        const pose = animation
          ? legoMoviePose(frame - entry.startFrame, entry.motionBrick)
          : { visible: true, x: 0, y: 0 };
        if (!pose.visible) {
          matrix.makeScale(0, 0, 0);
          mesh.setMatrixAt(index, matrix);
          return;
        }
        const svgToCssScale = animation?.svgToCssScale ?? 1;
        const displacement = cameraRight.clone().multiplyScalar(pose.x * svgToCssScale * worldPerPixel)
          .addScaledVector(cameraUp, -pose.y * svgToCssScale * worldPerPixel);
        if (stud) {
          matrix.makeTranslation(
            entry.x + displacement.x,
            entry.y + displacement.y,
            entry.z + displacement.z,
          );
        } else {
          matrix.makeScale(entry.w, entry.h, entry.d);
          matrix.setPosition(
            entry.x + displacement.x,
            entry.y + displacement.y,
            entry.z + displacement.z,
          );
        }
        mesh.setMatrixAt(index, matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function tick(now) {
    raf = null;
    if (disposed) return;
    if (animation) {
      const frame = Math.floor((now - animation.startedAt) / FRAME_MS);
      if (frame !== animation.frame) {
        animation.frame = frame;
        applyFrame(frame);
      }
      if (frame >= animation.totalFrames) {
        animation = null;
        canvas.dataset.phase = 'ready';
        updateCamera();
      }
    }
    render();
    if (animation) scheduleRender();
  }

  function addInstances(entries, geometry, { stud = false } = {}) {
    const byColor = new Map();
    for (const entry of entries) {
      const color = entry.color ?? 'red';
      if (!byColor.has(color)) byColor.set(color, []);
      byColor.get(color).push(entry);
    }
    for (const [color, colorEntries] of byColor) {
      const material = new THREE.MeshLambertMaterial({
        color: new THREE.Color(PALETTE[color] ?? color ?? '#ff3b80'),
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });
      const mesh = new THREE.InstancedMesh(geometry, material, colorEntries.length);
      // Animated/hidden instance matrices must not leave a stale culling sphere.
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(mesh);
      resources.push(mesh, material);
      meshGroups.push({ mesh, entries: colorEntries, stud });
    }
  }

  function showModel(model, shouldAnimate) {
    clearModel();
    const data = brickPreviewData(model);
    const sourceBricks = model.bricks;
    const starts = computeLegoMovieStartFrames(sourceBricks);
    const timingById = new Map(sourceBricks
      .filter((brick) => brick.id !== undefined)
      .map((brick) => [brick.id, { startFrame: starts.get(brick) ?? 0, motionBrick: brick }]));
    const bodies = data.bodies.map((entry, index) => ({
      ...entry,
      startFrame: starts.get(sourceBricks[index]) ?? 0,
      motionBrick: sourceBricks[index],
    }));
    const { studsPerVoxel = 1, coursesPerVoxel = 5 / 6, voxelMm: scaleVoxelMm = 8 } = model.meta?.scale ?? {};
    const studs = data.studs.map((entry) => {
      const timing = timingById.get(entry.id);
      const motionBrick = timing?.motionBrick ?? sourceBricks.find((brick) => (
        Math.abs(entry.y - ((brick.y + 1) / coursesPerVoxel + 0.9 / scaleVoxelMm)) < 1e-8
        && entry.x > brick.x / studsPerVoxel
        && entry.x < (brick.x + brick.w) / studsPerVoxel
        && entry.z > brick.z / studsPerVoxel
        && entry.z < (brick.z + brick.d) / studsPerVoxel
      )) ?? sourceBricks[0];
      return { ...entry, startFrame: starts.get(motionBrick) ?? 0, motionBrick };
    });
    const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
    const voxelMm = model.meta?.scale?.voxelMm ?? 8;
    const studGeometry = new THREE.CylinderGeometry(2.45 / voxelMm, 2.45 / voxelMm, 1.8 / voxelMm, 8);
    resources.push(bodyGeometry, studGeometry);
    addInstances(bodies, bodyGeometry);
    addInstances(studs, studGeometry, { stud: true });

    const bounds = new THREE.Box3();
    for (const body of data.bodies) {
      bounds.expandByPoint(new THREE.Vector3(body.x - body.w / 2, body.y - body.h / 2, body.z - body.d / 2));
      bounds.expandByPoint(new THREE.Vector3(body.x + body.w / 2, body.y + body.h / 2, body.z + body.d / 2));
    }
    if (bounds.isEmpty()) bounds.setFromObject(group);
    modelBounds = bounds.clone();
    center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    distance = Math.max(18, sphere.radius * 3.2);
    const motion = shouldAnimate && !reducedMotion() && bodies.length > 0;
    const maxStart = bodies.reduce((max, entry) => Math.max(max, entry.startFrame), 0);
    animation = motion ? {
      startedAt: performance.now(), frame: -1,
      totalFrames: maxStart + legoMovieDurationFrames(),
      sourceBricks,
      svgToCssScale: referenceSvgToCssScale(sourceBricks, root.clientWidth, root.clientHeight),
    } : null;
    canvas.dataset.phase = motion ? 'assembling' : 'ready';
    resize();
    updateCamera();
    applyFrame(motion ? 0 : Infinity);
    canvas.style.opacity = '1';
    fallback.style.opacity = '0';
    fallback.style.pointerEvents = 'none';
    scheduleRender();
  }

  async function setSet(nextSet, { animate: nextAnimate = true } = {}) {
    const version = ++requestVersion;
    fallback.src = nextSet?.image ?? '';
    fallback.style.opacity = '1';
    fallback.style.pointerEvents = '';
    canvas.style.opacity = '0';
    canvas.dataset.phase = 'loading';
    canvas.setAttribute('aria-label', nextSet?.title
      ? `${onOpen ? 'Open ' : ''}${nextSet.title}, interactive 3D LEGO-style set`
      : `${onOpen ? 'Open ' : ''}interactive 3D LEGO-style set`);
    try {
      const { brickModel } = await getSavedResult(nextSet.id);
      if (disposed || version !== requestVersion) return;
      showModel(brickModel, nextAnimate);
    } catch (error) {
      if (!disposed && version === requestVersion) {
        canvas.dataset.phase = 'error';
        console.warn('Could not load saved hero set.', error);
      }
    }
  }

  function onPointerDown(event) {
    if (event.button !== 0 || event.isPrimary === false) return;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, azimuth, dragged: false };
    canvas.setPointerCapture?.(event.pointerId);
    canvas.style.cursor = 'grabbing';
  }
  function onPointerMove(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) pointer.dragged = true;
    if (pointer.dragged) {
      azimuth = pointer.azimuth - dx * 0.012;
      updateCamera();
    }
  }
  function onPointerEnd(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const wasClick = !pointer.dragged;
    pointer = null;
    canvas.style.cursor = 'grab';
    if (wasClick) onOpen?.();
  }
  function onPointerCancel() {
    pointer = null;
    canvas.style.cursor = 'grab';
  }
  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      azimuth += event.key === 'ArrowLeft' ? Math.PI / 12 : -Math.PI / 12;
      updateCamera();
      return;
    }
    if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onOpen();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('keydown', onKeyDown);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(root);
  setSet(set, { animate });

  return {
    setSet,
    dispose() {
      if (disposed) return;
      disposed = true;
      requestVersion += 1;
      if (raf !== null) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('keydown', onKeyDown);
      clearModel();
      renderer.renderLists?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
