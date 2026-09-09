import * as THREE from 'three';
import { PALETTE } from './geometry.js';
import { brickPreviewData } from './brick-preview.js';
import { BrickOutlineBatch } from './brick-outlines.js';
import { groupBrickOutlinesBySourceColor } from './black-piece-ink.js';
import { getBrickFaceColor } from './product-viewer.js';
import { createStudRenderSettings } from './stud-appearance.js';
import {
  LEGO_MOVIE,
  computeLegoMovieStartFrames,
  legoMovieDurationFrames,
  legoMoviePose,
  referenceSvgToCssScale,
} from './model-stage-motion.js';
import { HERO_ROTATION_DEFAULTS, heroCameraRadius, normalizeHeroRotation, quantizeHeroAzimuth } from './hero-rotation.js';
import { createLoadingCarousel } from './loading-carousel.js';

const FRAME_MS = 1000 / LEGO_MOVIE.fps;
const ISO_AZIMUTH = Math.PI * 0.75;
const ISO_ELEVATION = Math.atan(1 / Math.sqrt(2));
const DRAG_THRESHOLD = 6;
const matrix = new THREE.Matrix4();

export const MODEL_STAGE_CAMERA = Object.freeze({
  azimuth: ISO_AZIMUTH,
  elevation: ISO_ELEVATION,
  fitPadding: 1.18,
  minimumDistance: 18,
  distanceScale: 3.2,
});

export function modelStageGeometry(model) {
  const isBricks = model.kind === 'bricks';
  return isBricks ? {
    ...brickPreviewData(model),
    sourceBricks: model.bricks,
    voxelMm: model.meta?.scale?.voxelMm ?? 8,
  } : {
    bodies: model.cells.map(cell => ({
      ...cell,
      x: cell.x + .5,
      y: cell.y + .5,
      z: cell.z + .5,
      w: .96,
      h: .96,
      d: .96,
    })),
    studs: [],
    sourceBricks: model.cells.map(cell => ({ ...cell, w: 1, h: 1, d: 1 })),
    voxelMm: 8,
  };
}

export function modelStageOutlineGroups(model, { bodies, studs }) {
  return groupBrickOutlinesBySourceColor(
    { bodies, studs },
    model.kind === 'bricks' ? undefined : 'dark',
  );
}

function reducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/** A data-free live stage. It never loads or generates a model. */
export function mountModelStage(host, { model = null, label = 'Interactive 3D LEGO-style set', onOpen, animate = true, heroRotation = null, loading = false } = {}) {
  const root = document.createElement('div');
  root.className = 'hero-renderer';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });

  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas';
  canvas.dataset.phase = 'loading';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', onOpen ? 'button' : 'img');
  canvas.setAttribute('aria-label', label);
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    display: 'block', opacity: '0', touchAction: 'pan-y', cursor: 'grab', outlineOffset: '-3px',
  });
  root.append(canvas);
  host.append(root);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    canvas.remove();
    const unavailable = document.createElement('p');
    unavailable.className = 'stage-unavailable';
    unavailable.setAttribute('role', 'status');
    unavailable.textContent = '3D preview unavailable.';
    root.append(unavailable);
    return {
      element: root,
      setModel(_nextModel, { label: nextLabel } = {}) {
        if (nextLabel) unavailable.setAttribute('aria-label', nextLabel);
      },
      setLoading() {},
      dispose() { root.remove(); },
    };
  }
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
  let outlinePoses = [];
  let pointer = null;
  let loadingCarousel = null;
  let loadingStartedAt = 0;
  const rotation = heroRotation ? normalizeHeroRotation(heroRotation) : HERO_ROTATION_DEFAULTS;

  function render() {
    if (!disposed) renderer.render(scene, camera);
  }

  function scheduleRender() {
    if (disposed || raf !== null) return;
    raf = requestAnimationFrame(tick);
  }

  function updateCamera() {
    const tuned = heroRotation && !reducedMotion()
      ? rotation
      : { ...rotation, pulse: 1, pulseFrequency: 1, poseStep: 0 };
    const displayedAzimuth = heroRotation ? quantizeHeroAzimuth(azimuth, tuned.poseStep, ISO_AZIMUTH) : azimuth;
    const horizontal = Math.cos(ISO_ELEVATION) * distance;
    camera.position.set(
      center.x + Math.sin(displayedAzimuth) * horizontal,
      center.y + Math.sin(ISO_ELEVATION) * distance,
      center.z + Math.cos(displayedAzimuth) * horizontal,
    );
    camera.lookAt(center);
    camera.updateMatrixWorld(true);
    fitCamera(modelBounds);
    camera.updateProjectionMatrix();
    for (const outlinePose of outlinePoses) outlinePose.batch.updateCamera(camera, renderer);
    canvas.dataset.azimuth = String(displayedAzimuth);
    canvas.dataset.cameraRadius = String(camera.top);
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
    let verticalRadius = Math.max(halfHeight, halfWidth / aspect, 1) * MODEL_STAGE_CAMERA.fitPadding;
    if (heroRotation) {
      const size = bounds.getSize(new THREE.Vector3());
      const tuned = reducedMotion() ? { ...rotation, pulse: 1, pulseFrequency: 1, poseStep: 0 } : rotation;
      verticalRadius = heroCameraRadius({
        halfX: size.x / 2,
        halfY: size.y / 2,
        halfZ: size.z / 2,
        aspect,
        elevation: ISO_ELEVATION,
        azimuth: quantizeHeroAzimuth(azimuth, tuned.poseStep, ISO_AZIMUTH),
        pulse: tuned.pulse,
        pulseFrequency: tuned.pulseFrequency,
        size: tuned.size,
        padding: MODEL_STAGE_CAMERA.fitPadding,
      });
    }
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

  function clearLoading() {
    if (!loadingCarousel) return;
    loadingCarousel.dispose();
    loadingCarousel = null;
  }

  function clearModel() {
    animation = null;
    for (const child of [...group.children]) group.remove(child);
    for (const resource of resources) resource.dispose?.();
    resources = [];
    meshGroups = [];
    outlinePoses = [];
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
    for (const outlinePose of outlinePoses) {
      for (const [entries, posedEntries] of [
        [outlinePose.bodies, outlinePose.posedBodies],
        [outlinePose.studs, outlinePose.posedStuds],
      ]) {
        entries.forEach((entry, index) => {
          const posedEntry = posedEntries[index];
          const pose = animation
            ? legoMoviePose(frame - entry.startFrame, entry.motionBrick)
            : { visible: true, x: 0, y: 0 };
          posedEntry.visible = pose.visible;
          if (!pose.visible) return;
          const svgToCssScale = animation?.svgToCssScale ?? 1;
          const displacement = cameraRight.clone().multiplyScalar(pose.x * svgToCssScale * worldPerPixel)
            .addScaledVector(cameraUp, -pose.y * svgToCssScale * worldPerPixel);
          posedEntry.x = entry.x + displacement.x;
          posedEntry.y = entry.y + displacement.y;
          posedEntry.z = entry.z + displacement.z;
        });
      }
      outlinePose.batch.updateGeometry({
        bodies: outlinePose.posedBodies,
        studs: outlinePose.posedStuds,
        camera,
      });
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
    if (loadingCarousel) {
      loadingCarousel.update((now - loadingStartedAt) / 1000, { reducedMotion: reducedMotion() });
    }
    render();
    if (animation || (loadingCarousel && !reducedMotion())) scheduleRender();
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
        color: getBrickFaceColor(PALETTE[color] ?? color ?? '#ff3b80'),
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

  function showModel(model, shouldAnimate, frameModel = model) {
    clearModel();
    const data = modelStageGeometry(model);
    const sourceBricks = data.sourceBricks;
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
    const timedStuds = data.studs.map((entry) => {
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
    const voxelMm = data.voxelMm;
    const {
      studs,
      radius: studRadius,
      height: studHeight,
    } = createStudRenderSettings(timedStuds, voxelMm);
    const studGeometry = new THREE.CylinderGeometry(studRadius, studRadius, studHeight, 32);
    resources.push(bodyGeometry, studGeometry);
    addInstances(bodies, bodyGeometry);
    addInstances(studs, studGeometry, { stud: true });
    outlinePoses = modelStageOutlineGroups(model, { bodies, studs }).map((outlineGroup) => {
      const posedBodies = outlineGroup.bodies.map((entry) => ({ ...entry, visible: true }));
      const posedStuds = outlineGroup.studs.map((entry) => ({ ...entry, visible: true }));
      const batch = new BrickOutlineBatch({
        bodies: posedBodies,
        studs: posedStuds,
        studRadius,
        studHeight,
        color: outlineGroup.color,
        sidewallColor: outlineGroup.sidewallColor,
        linewidth: 0.04 * 8 / voxelMm,
        renderOrder: 3,
      });
      group.add(batch);
      resources.push(batch);
      return {
        batch,
        bodies: outlineGroup.bodies,
        studs: outlineGroup.studs,
        posedBodies,
        posedStuds,
      };
    });

    const frameData = modelStageGeometry(frameModel);
    const bounds = new THREE.Box3();
    for (const body of frameData.bodies) {
      bounds.expandByPoint(new THREE.Vector3(body.x - body.w / 2, body.y - body.h / 2, body.z - body.d / 2));
      bounds.expandByPoint(new THREE.Vector3(body.x + body.w / 2, body.y + body.h / 2, body.z + body.d / 2));
    }
    if (bounds.isEmpty()) bounds.setFromObject(group);
    modelBounds = bounds.clone();
    center = bounds.getCenter(new THREE.Vector3());
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    distance = Math.max(MODEL_STAGE_CAMERA.minimumDistance, sphere.radius * MODEL_STAGE_CAMERA.distanceScale);
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
    scheduleRender();
  }

  function setModel(nextModel, { animate: nextAnimate = false, frameModel = nextModel, label: nextLabel } = {}) {
    if (nextLabel) canvas.setAttribute('aria-label', nextLabel);
    requestVersion += 1;
    clearLoading();
    canvas.dataset.phase = 'loading';
    showModel(nextModel, nextAnimate, frameModel);
  }

  function setLoading(nextLoading) {
    requestVersion += 1;
    if (!nextLoading) {
      clearLoading();
      if (!modelBounds.isEmpty() && group.children.length > 0) {
        canvas.dataset.phase = animation ? 'assembling' : 'ready';
      } else {
        canvas.dataset.phase = 'idle';
        canvas.style.opacity = '0';
      }
      scheduleRender();
      return;
    }
    clearModel();
    clearLoading();
    loadingCarousel = createLoadingCarousel(scene);
    loadingStartedAt = performance.now();
    modelBounds = loadingCarousel.bounds.clone();
    center = modelBounds.getCenter(new THREE.Vector3());
    const sphere = modelBounds.getBoundingSphere(new THREE.Sphere());
    distance = Math.max(MODEL_STAGE_CAMERA.minimumDistance, sphere.radius * MODEL_STAGE_CAMERA.distanceScale);
    canvas.dataset.phase = 'loading';
    canvas.style.opacity = '1';
    loadingCarousel.update(0, { reducedMotion: reducedMotion() });
    resize();
    scheduleRender();
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
      azimuth = pointer.azimuth - dx * 0.012 * (heroRotation ? rotation.dragSpeed : 1);
      updateCamera();
    }
  }
  function onPointerEnd(event) {
    if (!pointer || pointer.id !== event.pointerId) return;
    const wasClick = !pointer.dragged;
    pointer = null;
    canvas.style.cursor = 'grab';
    if (wasClick && !loadingCarousel) onOpen?.();
  }
  function onPointerCancel() {
    pointer = null;
    canvas.style.cursor = 'grab';
  }
  function onKeyDown(event) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const speed = heroRotation ? rotation.dragSpeed : 1;
      azimuth += (event.key === 'ArrowLeft' ? Math.PI / 12 : -Math.PI / 12) * speed;
      updateCamera();
      return;
    }
    if (onOpen && !loadingCarousel && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onOpen();
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerEnd);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('keydown', onKeyDown);
  const motionPreference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const onMotionPreferenceChange = () => {
    if (!disposed && loadingCarousel) { resize(); scheduleRender(); }
  };
  motionPreference?.addEventListener?.('change', onMotionPreferenceChange);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(root);
  if (loading) setLoading(true);
  else if (model) setModel(model, { animate });

  return {
    element: root,
    setModel,
    setLoading,
    dispose() {
      if (disposed) return;
      disposed = true;
      requestVersion += 1;
      if (raf !== null) cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      motionPreference?.removeEventListener?.('change', onMotionPreferenceChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerEnd);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('keydown', onKeyDown);
      clearLoading();
      clearModel();
      renderer.renderLists?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      root.remove();
    },
  };
}
