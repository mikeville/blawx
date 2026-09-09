import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

const BODY_EDGE_SEGMENTS = Object.freeze([
  [0, 1], [1, 3], [3, 2], [2, 0],
  [4, 5], [5, 7], [7, 6], [6, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
]);
const BODY_EDGE_POINTS = Object.freeze([
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
]);

export const BRICK_OUTLINE_WIDTH = 0.04;
export const STUD_OUTLINE_SEGMENTS = 32;

function writeSegment(target, cursor, startX, startY, startZ, endX, endY, endZ) {
  target[cursor] = startX;
  target[cursor + 1] = startY;
  target[cursor + 2] = startZ;
  target[cursor + 3] = endX;
  target[cursor + 4] = endY;
  target[cursor + 5] = endZ;
  return cursor + 6;
}

export function writeBodyOutlinePositions(positions, bodies) {
  if (positions.length !== bodies.length * BODY_EDGE_SEGMENTS.length * 6) {
    throw new Error('Body outline target has the wrong length.');
  }
  let cursor = 0;
  for (const body of bodies) {
    const width = body.visible === false ? 0 : body.w;
    const height = body.visible === false ? 0 : body.h;
    const depth = body.visible === false ? 0 : body.d;
    for (const [startIndex, endIndex] of BODY_EDGE_SEGMENTS) {
      const start = BODY_EDGE_POINTS[startIndex];
      const end = BODY_EDGE_POINTS[endIndex];
      cursor = writeSegment(
        positions,
        cursor,
        body.x + start[0] * width / 2,
        body.y + start[1] * height / 2,
        body.z + start[2] * depth / 2,
        body.x + end[0] * width / 2,
        body.y + end[1] * height / 2,
        body.z + end[2] * depth / 2,
      );
    }
  }
  return positions;
}

export function buildBodyOutlinePositions(bodies) {
  return writeBodyOutlinePositions(
    new Float32Array(bodies.length * BODY_EDGE_SEGMENTS.length * 6),
    bodies,
  );
}

export function studOutlinePositionCount(studCount, segments = STUD_OUTLINE_SEGMENTS) {
  const frontArcSegments = segments / 2;
  return studCount * (segments + frontArcSegments + 2) * 6;
}

export function writeStudOutlinePositions(target, studs, {
  radius,
  height,
  viewDirection,
  segments = STUD_OUTLINE_SEGMENTS,
  surfaceOffset = 0.003,
} = {}) {
  if (segments < 4 || segments % 2 !== 0) throw new Error('Stud outline segments must be an even number of at least four.');
  if (target.length !== studOutlinePositionCount(studs.length, segments)) {
    throw new Error('Stud outline target has the wrong length.');
  }

  const horizontalLength = Math.hypot(viewDirection?.x ?? 0, viewDirection?.z ?? 0);
  const viewX = horizontalLength > 1e-8 ? viewDirection.x / horizontalLength : 0;
  const viewZ = horizontalLength > 1e-8 ? viewDirection.z / horizontalLength : 1;
  const frontAngle = Math.atan2(viewZ, viewX);
  const outlineRadius = radius + surfaceOffset;
  const halfHeight = height / 2;
  const topYInset = surfaceOffset;
  const bottomYInset = surfaceOffset * 0.5;
  const frontArcSegments = segments / 2;
  let cursor = 0;

  for (const stud of studs) {
    const visible = stud.visible !== false;
    const studRadius = visible ? outlineRadius : 0;
    const topY = visible ? stud.y + halfHeight + topYInset : stud.y;
    const bottomY = visible ? stud.y - halfHeight + bottomYInset : stud.y;

    // A complete top ring reads as a clean printed ellipse after projection.
    for (let segment = 0; segment < segments; segment++) {
      const startAngle = segment * Math.PI * 2 / segments;
      const endAngle = (segment + 1) * Math.PI * 2 / segments;
      cursor = writeSegment(
        target,
        cursor,
        stud.x + Math.cos(startAngle) * studRadius,
        topY,
        stud.z + Math.sin(startAngle) * studRadius,
        stud.x + Math.cos(endAngle) * studRadius,
        topY,
        stud.z + Math.sin(endAngle) * studRadius,
      );
    }

    // Only the camera-facing half of the lower rim belongs in the drawing.
    for (let segment = 0; segment < frontArcSegments; segment++) {
      const startAngle = frontAngle - Math.PI / 2 + segment * Math.PI / frontArcSegments;
      const endAngle = frontAngle - Math.PI / 2 + (segment + 1) * Math.PI / frontArcSegments;
      cursor = writeSegment(
        target,
        cursor,
        stud.x + Math.cos(startAngle) * studRadius,
        bottomY,
        stud.z + Math.sin(startAngle) * studRadius,
        stud.x + Math.cos(endAngle) * studRadius,
        bottomY,
        stud.z + Math.sin(endAngle) * studRadius,
      );
    }

    // The two tangent generators are the cylinder silhouette from this camera.
    for (const side of [-1, 1]) {
      const sideAngle = frontAngle + side * Math.PI / 2;
      const x = stud.x + Math.cos(sideAngle) * studRadius;
      const z = stud.z + Math.sin(sideAngle) * studRadius;
      cursor = writeSegment(target, cursor, x, bottomY, z, x, topY, z);
    }
  }

  return target;
}

function makeWideLine(positions, material, renderOrder) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const lines = new LineSegments2(geometry, material);
  lines.renderOrder = renderOrder;
  return lines;
}

export class BrickOutlineBatch extends THREE.Group {
  constructor({
    bodies,
    studs,
    studRadius,
    studHeight,
    color = 0x171612,
    sidewallColor = color,
    linewidth = BRICK_OUTLINE_WIDTH,
    renderOrder = 3,
  }) {
    super();
    this.studs = studs;
    this.bodies = bodies;
    this.studRadius = studRadius;
    this.studHeight = studHeight;
    this.worldLinewidth = linewidth;
    this.viewX = 0;
    this.viewZ = 1;
    this.cameraDirection = new THREE.Vector3();
    this.viewport = new THREE.Vector4();
    this.material = new LineMaterial({
      color,
      linewidth: 1,
      worldUnits: false,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      alphaToCoverage: false,
    });

    this.bodyLines = makeWideLine(buildBodyOutlinePositions(bodies), this.material, renderOrder);
    this.bodyLines.frustumCulled = false;
    this.add(this.bodyLines);

    // The reference manual language treats the stud wall as ink and leaves the
    // top cap in the source color. This open cylinder overlays only that wall;
    // the existing colored stud mesh remains the cap and the depth surface.
    this.studSideGeometry = new THREE.CylinderGeometry(
      studRadius + 0.002,
      studRadius + 0.002,
      studHeight,
      STUD_OUTLINE_SEGMENTS,
      1,
      true,
    );
    this.studSideMaterial = new THREE.MeshBasicMaterial({
      color: sidewallColor,
      transparent: false,
      opacity: 1,
      depthTest: true,
      depthWrite: true,
      toneMapped: false,
    });
    this.studSideWalls = new THREE.InstancedMesh(this.studSideGeometry, this.studSideMaterial, studs.length);
    this.studSideWalls.renderOrder = renderOrder;
    this.studSideWalls.frustumCulled = false;
    this.add(this.studSideWalls);

    this.studPositions = new Float32Array(studOutlinePositionCount(studs.length));
    writeStudOutlinePositions(this.studPositions, studs, {
      radius: studRadius,
      height: studHeight,
      viewDirection: { x: 0, z: 1 },
    });
    this.studLines = makeWideLine(this.studPositions, this.material, renderOrder + 1);
    this.studLines.frustumCulled = false;
    this.add(this.studLines);
    this.updateGeometry({ bodies, studs });
  }

  updateCamera(camera, renderer = null) {
    camera.updateWorldMatrix(true, false);
    camera.getWorldDirection(this.cameraDirection).negate();
    const horizontalLength = Math.hypot(this.cameraDirection.x, this.cameraDirection.z);
    const viewX = horizontalLength > 1e-8 ? this.cameraDirection.x / horizontalLength : 0;
    const viewZ = horizontalLength > 1e-8 ? this.cameraDirection.z / horizontalLength : 1;
    if (Math.abs(viewX - this.viewX) >= 1e-7 || Math.abs(viewZ - this.viewZ) >= 1e-7) {
      this.viewX = viewX;
      this.viewZ = viewZ;
      this.writeStudPositions();
    }

    if (renderer && camera.isOrthographicCamera) {
      renderer.getViewport(this.viewport);
      const projectedWidth = this.worldLinewidth * this.viewport.w / (camera.top - camera.bottom);
      this.material.linewidth = Math.max(0.6, projectedWidth);
    }
  }

  writeStudPositions() {
    writeStudOutlinePositions(this.studPositions, this.studs, {
      radius: this.studRadius,
      height: this.studHeight,
      viewDirection: { x: this.viewX, z: this.viewZ },
    });
    this.studLines.geometry.attributes.instanceStart.data.needsUpdate = true;
  }

  updateGeometry({ bodies = this.bodies, studs = this.studs, camera = null } = {}) {
    if (bodies.length !== this.bodies.length || studs.length !== this.studs.length) {
      throw new Error('BrickOutlineBatch updates require the original body and stud counts.');
    }
    this.bodies = bodies;
    this.studs = studs;
    const bodyPositions = this.bodyLines.geometry.attributes.instanceStart.data.array;
    writeBodyOutlinePositions(bodyPositions, bodies);
    this.bodyLines.geometry.attributes.instanceStart.data.needsUpdate = true;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    for (let index = 0; index < studs.length; index++) {
      const stud = studs[index];
      position.set(stud.x, stud.y, stud.z);
      const visibleScale = stud.visible === false ? 0 : 1;
      scale.setScalar(visibleScale);
      matrix.compose(position, rotation, scale);
      this.studSideWalls.setMatrixAt(index, matrix);
    }
    this.studSideWalls.instanceMatrix.needsUpdate = true;

    this.writeStudPositions();
    if (camera) this.updateCamera(camera);
  }

  dispose() {
    this.bodyLines.geometry.dispose();
    this.studLines.geometry.dispose();
    this.studSideWalls.dispose();
    this.studSideGeometry.dispose();
    this.studSideMaterial.dispose();
    this.material.dispose();
  }
}
