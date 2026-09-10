import * as THREE from 'three';
import { PALETTE } from './geometry.js';
import { brickPreviewData, voxelPreviewData } from './brick-preview.js';
import { createAssemblyJoinPreview } from './assembly-join-preview.js';
import { BRICK_OUTLINE_WIDTH, BrickOutlineBatch } from './brick-outlines.js';
import {
  DEFAULT_BLACK_PIECE_OUTLINE,
  SOURCE_NEAR_BLACK_LUMINANCE_THRESHOLD,
  groupBrickOutlinesBySourceColor,
} from './black-piece-ink.js';
import { createStudRenderSettings } from './stud-appearance.js';

const ISO_ORIGIN = Math.PI / 4;
const QUARTER_TURN = Math.PI / 2;
const STANDARD_ELEVATION = Math.atan(1 / Math.sqrt(2));
const UNDERSIDE_ELEVATION = -Math.PI / 7;
const UPWARD_AZIMUTHS = Object.freeze([
  Math.PI * 0.75,
  Math.PI * 1.25,
  Math.PI * 1.75,
  Math.PI * 0.25,
]);
const MAX_VISIBILITY_RAY_TESTS = 250_000;
const MAX_VISIBILITY_BODIES = Math.floor(MAX_VISIBILITY_RAY_TESTS / (UPWARD_AZIMUTHS.length * 9));
const EDGE_SEGMENTS = [[0, 1], [1, 3], [3, 2], [2, 0], [4, 5], [5, 7], [7, 6], [6, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
const EDGE_POINTS = [[-1,-1,-1],[1,-1,-1],[-1,1,-1],[1,1,-1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]];
const DARK_FACE_LUMINANCE_FLOOR = 0.03;

const ACCEPTED_INSTRUCTION_HIGHLIGHT_STYLE = 'pastel-color';
const ACCEPTED_INSTRUCTION_APPEARANCE = Object.freeze({
  contextSaturation: 0.85,
  contextPaperBlend: 0.62,
  contextPaperColor: 0xf4f4f4,
  contextOpacity: 1,
  contextDepthWrite: true,
  contextTransparent: false,
  contextEdge: 0xaaa8a0,
  contextEdgeOpacity: 1,
  contextEdgeDepthWrite: true,
  contextEdgeTransparent: false,
  activeEdge: 0x171612,
});

export function getInstructionHighlightAppearance() {
  return ACCEPTED_INSTRUCTION_APPEARANCE;
}

export function getInstructionContextColor(source) {
  const appearance = ACCEPTED_INSTRUCTION_APPEARANCE;
  const tone = source instanceof THREE.Color ? source.clone() : new THREE.Color(source);
  const luminance = tone.r * 0.2126 + tone.g * 0.7152 + tone.b * 0.0722;
  const neutral = new THREE.Color(luminance, luminance, luminance);
  tone.lerp(neutral, 1 - appearance.contextSaturation);
  tone.lerp(new THREE.Color(appearance.contextPaperColor), appearance.contextPaperBlend);
  return tone;
}

export function getBrickFaceColor(source) {
  const tone = source instanceof THREE.Color ? source.clone() : new THREE.Color(source);
  const luminance = tone.r * 0.2126 + tone.g * 0.7152 + tone.b * 0.0722;
  if (luminance >= SOURCE_NEAR_BLACK_LUMINANCE_THRESHOLD) return tone;
  if (luminance > 0) return tone.multiplyScalar(DARK_FACE_LUMINANCE_FLOOR / luminance);
  return tone.setRGB(DARK_FACE_LUMINANCE_FLOOR, DARK_FACE_LUMINANCE_FLOOR, DARK_FACE_LUMINANCE_FLOOR);
}

export function getInstructionActiveMaterialAppearance(source, liftDarkFaces = true) {
  const tone = liftDarkFaces
    ? getBrickFaceColor(source)
    : (source instanceof THREE.Color ? source.clone() : new THREE.Color(source));
  return {
    color: tone.clone().multiplyScalar(0.15),
    emissive: tone,
    emissiveIntensity: 0.85,
    opacity: 1,
    transparent: false,
    depthWrite: true,
  };
}

export function getInstructionHighlightStyle() {
  return ACCEPTED_INSTRUCTION_HIGHLIGHT_STYLE;
}

function bodyBox(body) {
  return {
    id: body.id,
    min: { x: body.x - body.w / 2, y: body.y - body.h / 2, z: body.z - body.d / 2 },
    max: { x: body.x + body.w / 2, y: body.y + body.h / 2, z: body.z + body.d / 2 },
  };
}

function bodyVisibilitySamples(box) {
  const center = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
    weight: 4,
  };
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push({ x, y, z, weight: 1 });
    }
  }
  return [center, ...corners];
}

function rayHitsBox(origin, direction, box) {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (box.min[axis] - origin[axis]) * inverse;
    let second = (box.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far > 1e-5;
}

function visibilityScore(sampledBoxes, allBoxes, azimuth) {
  const horizontal = Math.cos(UNDERSIDE_ELEVATION);
  const direction = {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(UNDERSIDE_ELEVATION),
    z: Math.cos(azimuth) * horizontal,
  };
  let score = 0;
  for (const sampled of sampledBoxes) {
    for (const point of bodyVisibilitySamples(sampled)) {
      const origin = {
        x: point.x + direction.x * 1e-4,
        y: point.y + direction.y * 1e-4,
        z: point.z + direction.z * 1e-4,
      };
      const hidden = allBoxes.some(box => box !== sampled && rayHitsBox(origin, direction, box));
      if (!hidden) score += point.weight;
    }
  }
  return score;
}

function evenlySample(items, count) {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * items.length / count)]);
}

export function chooseUpwardInsertionAzimuth(bodies, highlightIds) {
  const bodyBoxes = bodies.map(bodyBox);
  let highlighted = bodyBoxes.filter(box => highlightIds?.has(box.id));
  let boxes = bodyBoxes;
  if (!highlighted.length || boxes.length < 2) return UPWARD_AZIMUTHS[0];

  if (boxes.length > MAX_VISIBILITY_BODIES) {
    const retainedHighlighted = evenlySample(highlighted, Math.min(64, MAX_VISIBILITY_BODIES));
    const context = bodyBoxes.filter(box => !highlightIds.has(box.id));
    boxes = [...retainedHighlighted, ...evenlySample(context, MAX_VISIBILITY_BODIES - retainedHighlighted.length)];
    highlighted = retainedHighlighted;
  }

  // Bound worst-case local work while sampling the highlighted geometry evenly.
  const perBodyTests = UPWARD_AZIMUTHS.length * 9 * boxes.length;
  const sampleCount = Math.max(1, Math.min(highlighted.length, Math.floor(MAX_VISIBILITY_RAY_TESTS / perBodyTests)));
  const sampled = sampleCount === highlighted.length
    ? highlighted
    : evenlySample(highlighted, sampleCount);
  let bestAzimuth = UPWARD_AZIMUTHS[0];
  let bestScore = -1;
  for (const azimuth of UPWARD_AZIMUTHS) {
    const score = visibilityScore(sampled, boxes, azimuth);
    if (score > bestScore) {
      bestScore = score;
      bestAzimuth = azimuth;
    }
  }
  return bestAzimuth;
}

function makeEdgeGeometry(bodies) {
  const positions = new Float32Array(bodies.length * 72);
  let cursor = 0;
  for (const body of bodies) {
    for (const pair of EDGE_SEGMENTS) for (const index of pair) {
      positions[cursor] = body.x + EDGE_POINTS[index][0] * body.w / 2;
      positions[cursor + 1] = body.y + EDGE_POINTS[index][1] * body.h / 2;
      positions[cursor + 2] = body.z + EDGE_POINTS[index][2] * body.d / 2;
      cursor += 3;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function makeUpwardInsertionArrow(bodies) {
  if (!bodies.length) return null;
  const bounds = new THREE.Box3();
  for (const body of bodies) {
    bounds.expandByPoint(new THREE.Vector3(body.x - body.w / 2, body.y - body.h / 2, body.z - body.d / 2));
    bounds.expandByPoint(new THREE.Vector3(body.x + body.w / 2, body.y + body.h / 2, body.z + body.d / 2));
  }
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const length = THREE.MathUtils.clamp(Math.max(size.y * 0.4, Math.max(size.x, size.z) * 0.14), 1.6, 3.2);
  const gap = 0.28;
  const origin = new THREE.Vector3(center.x, bounds.min.y - length - gap, center.z);

  // Direction stays in model coordinates while the camera turns around it.
  // Both line and cone use opaque, unlit materials for a flat printed cue.
  return new THREE.ArrowHelper(
    new THREE.Vector3(0, 1, 0),
    origin,
    length,
    0x34322d,
    Math.min(0.72, length * 0.3),
    Math.min(0.42, length * 0.2),
  );
}

function makeDownwardJoinArrow({ start, end }) {
  const origin = new THREE.Vector3(start.x, start.y, start.z);
  const direction = new THREE.Vector3(end.x - start.x, end.y - start.y, end.z - start.z);
  const length = direction.length();
  if (!(length > 0)) return null;
  direction.normalize();
  const arrow = new THREE.ArrowHelper(
    direction,
    origin,
    length,
    0x34322d,
    Math.min(0.68, length * 0.24),
    Math.min(0.4, length * 0.15),
  );
  // ArrowHelper uses unlit basic materials. Keep the printed cue fully opaque
  // and subject to ordinary depth so it remains part of the exploded diagram.
  for (const material of [arrow.line.material, arrow.cone.material]) {
    material.transparent = false;
    material.opacity = 1;
    material.depthWrite = true;
    material.toneMapped = false;
  }
  return arrow;
}

export class ProductViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.radius = 10;
    this.resources = [];
    this.renderObjects = [];
    this.disposed = false;
    this.frame = null;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x777777, 2.8));
    const key = new THREE.DirectionalLight(0xffffff, 3.2);
    key.position.set(-10, 16, 12);
    this.scene.add(key);

    this.azimuth = Math.PI * 0.75;
    this.elevation = STANDARD_ELEVATION;
    this.dragStart = null;
    this.onDown = (event) => {
      this.dragStart = { x: event.clientX, azimuth: this.azimuth };
      this.canvas.setPointerCapture(event.pointerId);
    };
    this.onMove = (event) => {
      if (!this.dragStart) return;
      this.azimuth = this.dragStart.azimuth + (event.clientX - this.dragStart.x) * 0.012;
      this.updateCamera();
    };
    this.onEnd = () => { this.dragStart = null; };
    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onEnd);
    canvas.addEventListener('pointercancel', this.onEnd);
    canvas.addEventListener('lostpointercapture', this.onEnd);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.animate = this.animate.bind(this);
    this.scheduleRender();
  }

  scheduleRender() {
    if (this.disposed || this.frame !== null) return;
    this.frame = requestAnimationFrame(this.animate);
  }

  clear() {
    for (const child of [...this.group.children]) this.group.remove(child);
    this.renderObjects.forEach((object) => object.dispose?.());
    this.resources.forEach((resource) => resource.dispose());
    this.renderObjects = [];
    this.resources = [];
  }

  setModel(model, {
    frameModel = model,
    highlightIds = null,
    insertionDirection = null,
    joinContext = null,
    studAppearance = null,
    blackPieceOutline = DEFAULT_BLACK_PIECE_OUTLINE,
    animate = true,
  } = {}) {
    if (this.disposed) return;
    this.clear();
    const isBricks = model.kind === 'bricks';
    const joinPreview = isBricks
      ? createAssemblyJoinPreview({ model, highlightIds, joinContext })
      : { active: false, model, arrows: [] };
    const renderModel = joinPreview.active ? joinPreview.model : model;
    let data = isBricks ? brickPreviewData(renderModel) : voxelPreviewData(renderModel);
    const appearance = ACCEPTED_INSTRUCTION_APPEARANCE;
    const instructionDiagram = highlightIds !== null;
    const fromBelow = insertionDirection === 'up';
    // Reset on every model so an underside step cannot affect the next ordinary one.
    this.elevation = fromBelow ? UNDERSIDE_ELEVATION : STANDARD_ELEVATION;
    if (fromBelow) this.azimuth = chooseUpwardInsertionAzimuth(data.bodies, highlightIds);
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const voxelMm = renderModel.meta?.scale?.voxelMm ?? 8;
    const studSettings = createStudRenderSettings(data.studs, voxelMm, studAppearance);
    const studRadius = studSettings.radius;
    const studHeight = studSettings.height;
    data = { ...data, studs: studSettings.studs };
    const studGeometry = new THREE.CylinderGeometry(studRadius, studRadius, studHeight, 32);
    this.resources.push(geometry, studGeometry);
    const matrix = new THREE.Matrix4();
    const materials = new Map();
    for (const [items, shape, scaled] of [[data.bodies, geometry, true], [data.studs, studGeometry, false]]) {
      const groups = new Map();
      for (const item of items) {
        const context = Boolean(highlightIds && !highlightIds.has(item.id));
        const key = `${item.color}:${context ? 'context' : 'active'}`;
        if (!groups.has(key)) groups.set(key, { context, color: item.color, entries: [] });
        groups.get(key).entries.push(item);
      }
      for (const [key, { context, color, entries }] of groups) {
        if (!materials.has(key)) {
          let material;
          if (context) {
            const contextTone = getInstructionContextColor(PALETTE[color] ?? 0xff3b80);
            material = new THREE.MeshLambertMaterial({
              // A strong emissive component compresses 3D shading toward the
              // flatter tonal range of a printed instruction illustration.
              color: contextTone.clone().multiplyScalar(0.1),
              emissive: contextTone,
              emissiveIntensity: 0.9,
              transparent: appearance.contextTransparent,
              opacity: appearance.contextOpacity,
              depthWrite: appearance.contextDepthWrite,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });
          } else {
            const sourceTone = PALETTE[color] ?? 0xff3b80;
            const instructionTone = instructionDiagram
              ? getInstructionActiveMaterialAppearance(sourceTone, isBricks)
              : null;
            material = new THREE.MeshLambertMaterial(instructionTone ? {
              ...instructionTone,
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            } : {
              color: isBricks ? getBrickFaceColor(sourceTone) : new THREE.Color(sourceTone),
              polygonOffset: true,
              polygonOffsetFactor: 1,
              polygonOffsetUnits: 1,
            });
          }
          materials.set(key, material);
          this.resources.push(material);
        }
        const mesh = new THREE.InstancedMesh(shape, materials.get(key), entries.length);
        entries.forEach((item, index) => {
          matrix.makeScale(scaled ? item.w : 1, scaled ? item.h : 1, scaled ? item.d : 1);
          matrix.setPosition(item.x, item.y, item.z);
          mesh.setMatrixAt(index, matrix);
        });
        this.renderObjects.push(mesh);
        this.group.add(mesh);
      }
    }

    let insertionArrow = null;
    const joinArrows = [];
    if (highlightIds) {
      const activeBodies = data.bodies.filter(body => highlightIds.has(body.id));
      const contextBodies = data.bodies.filter(body => !highlightIds.has(body.id));
      const contextGeometry = makeEdgeGeometry(contextBodies);
      const contextMaterial = new THREE.LineBasicMaterial({
        color: appearance.contextEdge,
        transparent: appearance.contextEdgeTransparent,
        opacity: appearance.contextEdgeOpacity,
        depthWrite: appearance.contextEdgeDepthWrite,
      });
      const contextLines = new THREE.LineSegments(contextGeometry, contextMaterial);
      contextLines.renderOrder = 2;
      this.group.add(contextLines);
      this.renderObjects.push(contextLines);
      this.resources.push(contextGeometry, contextMaterial);

      const activeStuds = data.studs.filter(stud => highlightIds.has(stud.id));
      for (const outlineGroup of groupBrickOutlinesBySourceColor(
        { bodies: activeBodies, studs: activeStuds },
        blackPieceOutline,
      )) {
        const activeOutlines = new BrickOutlineBatch({
          bodies: outlineGroup.bodies,
          studs: outlineGroup.studs,
          studRadius,
          studHeight,
          color: outlineGroup.color,
          sidewallColor: outlineGroup.sidewallColor,
          linewidth: BRICK_OUTLINE_WIDTH * 8 / voxelMm,
          renderOrder: 3,
        });
        this.group.add(activeOutlines);
        this.renderObjects.push(activeOutlines);
      }

      if (fromBelow) {
        insertionArrow = makeUpwardInsertionArrow(activeBodies);
        if (insertionArrow) {
          insertionArrow.renderOrder = 4;
          this.group.add(insertionArrow);
          // ArrowHelper owns its materials and exposes dispose() for them.
          this.renderObjects.push(insertionArrow);
        }
      }
      if (joinPreview.active) {
        for (const arrowData of joinPreview.arrows) {
          const arrow = makeDownwardJoinArrow(arrowData);
          if (!arrow) continue;
          arrow.renderOrder = 4;
          this.group.add(arrow);
          this.renderObjects.push(arrow);
          joinArrows.push(arrow);
        }
      }
    } else {
      for (const outlineGroup of groupBrickOutlinesBySourceColor(data, isBricks ? blackPieceOutline : 'dark')) {
        const outlines = new BrickOutlineBatch({
          bodies: outlineGroup.bodies,
          studs: outlineGroup.studs,
          studRadius,
          studHeight,
          color: outlineGroup.color,
          sidewallColor: outlineGroup.sidewallColor,
          linewidth: BRICK_OUTLINE_WIDTH * 8 / voxelMm,
          renderOrder: 3,
        });
        this.renderObjects.push(outlines);
        this.group.add(outlines);
      }
    }

    // Use the same raw bounding volume for every comparison, even after repairs.
    const box = new THREE.Box3();
    if (frameModel.cells) {
      for (const cell of frameModel.cells) {
        box.expandByPoint(new THREE.Vector3(cell.x, cell.y, cell.z));
        box.expandByPoint(new THREE.Vector3(cell.x + 1, cell.y + 1, cell.z + 1));
      }
    } else if (frameModel.bricks?.length) {
      for (const b of brickPreviewData(frameModel).bodies) {
        box.expandByPoint(new THREE.Vector3(b.x-b.w/2,b.y-b.h/2,b.z-b.d/2));
        box.expandByPoint(new THREE.Vector3(b.x+b.w/2,b.y+b.h/2,b.z+b.d/2));
      }
    } else box.setFromObject(this.group);
    if (insertionArrow) {
      insertionArrow.updateWorldMatrix(true, true);
      box.expandByObject(insertionArrow, true);
    }
    if (joinPreview.active) {
      // frameModel describes the final construction. Extend that stable frame
      // only for this exploded view so lifted geometry and alignment arrows fit.
      for (const body of data.bodies) {
        box.expandByPoint(new THREE.Vector3(body.x - body.w / 2, body.y - body.h / 2, body.z - body.d / 2));
        box.expandByPoint(new THREE.Vector3(body.x + body.w / 2, body.y + body.h / 2, body.z + body.d / 2));
      }
      for (const arrow of joinArrows) {
        arrow.updateWorldMatrix(true, true);
        box.expandByObject(arrow, true);
      }
    }
    this.center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.distance = Math.max(18, sphere.radius * 3.2);
    this.radius = Math.max(3, sphere.radius * 1.13);
    this.resize();
    this.updateCamera();
    this.revealStarted = animate ? performance.now() : 0;
    this.canvas.style.opacity = animate ? '0' : '1';
    this.scheduleRender();
  }

  turn(direction) {
    const corner = Math.round((this.azimuth - ISO_ORIGIN) / QUARTER_TURN) + direction;
    this.azimuth = ISO_ORIGIN + corner * QUARTER_TURN;
    this.updateCamera();
  }

  updateCamera() {
    if (!this.center || this.disposed) return;
    const horizontal = Math.cos(this.elevation) * this.distance;
    const y = Math.sin(this.elevation) * this.distance;
    this.camera.position.set(
      this.center.x + Math.sin(this.azimuth) * horizontal,
      this.center.y + y,
      this.center.z + Math.cos(this.azimuth) * horizontal,
    );
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
    this.renderObjects.forEach(object => object.updateCamera?.(this.camera, this.renderer));
    this.scheduleRender();
  }

  resize() {
    if (this.disposed) return;
    const { clientWidth: width, clientHeight: height } = this.canvas.parentElement;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const verticalRadius = this.radius / Math.min(1, aspect);
    this.camera.left = -verticalRadius * aspect;
    this.camera.right = verticalRadius * aspect;
    this.camera.top = verticalRadius;
    this.camera.bottom = -verticalRadius;
    this.camera.updateProjectionMatrix();
    this.renderObjects.forEach(object => object.updateCamera?.(this.camera, this.renderer));
    this.scheduleRender();
  }

  animate(now) {
    this.frame = null;
    if (this.disposed) return;
    if (this.revealStarted) {
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const progress = reduced ? 1 : Math.min(1, (now - this.revealStarted) / 415);
      this.canvas.style.opacity = String(Math.ceil(progress * 5) / 5);
      if (progress === 1) this.revealStarted = 0;
    }
    this.renderer.render(this.scene, this.camera);
    if (this.revealStarted) this.scheduleRender();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointermove', this.onMove);
    this.canvas.removeEventListener('pointerup', this.onEnd);
    this.canvas.removeEventListener('pointercancel', this.onEnd);
    this.canvas.removeEventListener('lostpointercapture', this.onEnd);
    this.clear();
    this.renderer.renderLists?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
