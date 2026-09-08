import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PALETTE } from './geometry.js';

const BODY_HEIGHT = 1.2;
const STUD_HEIGHT = 0.2;
const STUD_RADIUS = 0.3;
const GAP = 0.025;

export class BrickViewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xe8e6df);
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 2000);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance = 3;
    this.shapeOnly = false;
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x625f58, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(-8, 14, 9);
    key.castShadow = false;
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d8ff, 1.2);
    fill.position.set(10, 7, -8);
    this.scene.add(fill);
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xd9d7d0, roughness: 0.96, metalness: 0 })
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.025;
    this.scene.add(this.floor);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.animate = this.animate.bind(this);
    this.frame = requestAnimationFrame(this.animate);
  }

  setModel(model) {
    if (model.kind === 'voxels') return this.setVoxelModel(model);
    return this.setBrickModel(model);
  }

  setMode(mode) {
    if (this.mode !== mode) this.clearModel();
    this.mode = mode;
  }

  setBrickModel(model) {
    this.setMode('bricks');
    this.clearModel();
    const groups = new Map();
    for (const brick of model.bricks) {
      const key = `${brick.w}x${brick.d}:${brick.color}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(brick);
    }
    const bodyGeometryCache = new Map();
    const studGeometry = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 20);
    const materials = new Map();
    const matrix = new THREE.Matrix4();
    for (const [key, bricks] of groups) {
      const sample = bricks[0];
      const geoKey = `${sample.w}x${sample.d}`;
      let bodyGeo = bodyGeometryCache.get(geoKey);
      if (!bodyGeo) {
        bodyGeo = new THREE.BoxGeometry(sample.w - GAP * 2, BODY_HEIGHT - GAP * 2, sample.d - GAP * 2);
        bodyGeometryCache.set(geoKey, bodyGeo);
      }
      let material = materials.get(sample.color);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color: PALETTE[sample.color] ?? 0xff3b80, roughness: 0.5, metalness: 0.02 });
        materials.set(sample.color, material);
      }
      const bodies = new THREE.InstancedMesh(bodyGeo, material, bricks.length);
      bodies.userData.paletteMaterial = material;
      bricks.forEach((b, i) => {
        matrix.makeTranslation(b.x + b.w / 2, b.y * BODY_HEIGHT + BODY_HEIGHT / 2, b.z + b.d / 2);
        bodies.setMatrixAt(i, matrix);
      });
      this.modelGroup.add(bodies);
      const studCount = bricks.reduce((sum, b) => sum + b.w * b.d, 0);
      const studs = new THREE.InstancedMesh(studGeometry, material, studCount);
      studs.userData.paletteMaterial = material;
      let i = 0;
      for (const b of bricks) for (let sx = 0; sx < b.w; sx += 1) for (let sz = 0; sz < b.d; sz += 1) {
        matrix.makeTranslation(b.x + sx + 0.5, (b.y + 1) * BODY_HEIGHT + STUD_HEIGHT / 2, b.z + sz + 0.5);
        studs.setMatrixAt(i++, matrix);
      }
      this.modelGroup.add(studs);
    }
    const neutralMaterial = this.createNeutralMaterial(0.5, 0.02);
    this.modelGroup.userData.resources = { bodyGeometryCache, studGeometry, materials, neutralMaterial };
    this.applyMaterialMode();
    this.fit();
  }

  setVoxelModel(model) {
    this.setMode('voxels');
    this.clearModel();
    const groups = new Map();
    for (const cell of model.cells) {
      if (!groups.has(cell.color)) groups.set(cell.color, []);
      groups.get(cell.color).push(cell);
    }
    const cubeGeometry = new THREE.BoxGeometry(1 - GAP * 2, 1 - GAP * 2, 1 - GAP * 2);
    const materials = new Map();
    const matrix = new THREE.Matrix4();
    for (const [color, cells] of groups) {
      const material = new THREE.MeshStandardMaterial({ color: PALETTE[color] ?? 0xff3b80, roughness: 0.58, metalness: 0 });
      materials.set(color, material);
      const cubes = new THREE.InstancedMesh(cubeGeometry, material, cells.length);
      cubes.userData.paletteMaterial = material;
      cells.forEach((cell, index) => {
        matrix.makeTranslation(cell.x + 0.5, cell.y + 0.5, cell.z + 0.5);
        cubes.setMatrixAt(index, matrix);
      });
      this.modelGroup.add(cubes);
    }
    const neutralMaterial = this.createNeutralMaterial(0.58, 0);
    this.modelGroup.userData.resources = { bodyGeometryCache: new Map([['cube', cubeGeometry]]), studGeometry: null, materials, neutralMaterial };
    this.applyMaterialMode();
    this.fit();
  }

  createNeutralMaterial(roughness, metalness) {
    return new THREE.MeshStandardMaterial({ color: 0xc8c7c2, roughness, metalness });
  }

  setShapeOnly(enabled) {
    this.shapeOnly = Boolean(enabled);
    this.applyMaterialMode();
  }

  applyMaterialMode() {
    const neutralMaterial = this.modelGroup.userData.resources?.neutralMaterial;
    for (const child of this.modelGroup.children) {
      child.material = this.shapeOnly && neutralMaterial ? neutralMaterial : child.userData.paletteMaterial;
    }
  }

  clearModel() {
    for (const child of [...this.modelGroup.children]) {
      child.dispose?.();
      this.modelGroup.remove(child);
    }
    const r = this.modelGroup.userData.resources;
    if (r) {
      r.bodyGeometryCache.forEach((g) => g.dispose());
      r.studGeometry?.dispose();
      r.materials.forEach((m) => m.dispose());
      r.neutralMaterial?.dispose();
    }
    this.modelGroup.userData.resources = null;
  }

  fit() {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.fitSphere = sphere.clone();
    const distance = this.fitDistance(sphere.radius);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.72, -1).normalize().multiplyScalar(distance));
    this.camera.near = Math.max(distance / 1000, 0.05);
    this.camera.far = distance * 50;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setView(view) {
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    this.fitSphere = sphere.clone();
    const d = this.fitDistance(sphere.radius);
    const direction = { front: [0, 0.12, -1], side: [1, 0.12, 0], rear: [0, 0.12, 1], isometric: [1, 0.72, -1] }[view];
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(...direction).normalize().multiplyScalar(d));
    this.controls.update();
  }

  resize() {
    const { clientWidth: width, clientHeight: height } = this.canvas.parentElement;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.fitSphere) {
      const direction = this.camera.position.clone().sub(this.controls.target).normalize();
      this.camera.position.copy(this.controls.target).add(direction.multiplyScalar(this.fitDistance(this.fitSphere.radius)));
      this.controls.update();
    }
  }

  fitDistance(radius) {
    const vertical = THREE.MathUtils.degToRad(this.camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * this.camera.aspect);
    return Math.max(radius, 1) / Math.sin(Math.min(vertical, horizontal) / 2) * 1.12;
  }

  animate() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.clearModel();
    this.floor.geometry.dispose();
    this.floor.material.dispose();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
