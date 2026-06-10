// Minimal GLB (binary glTF 2.0) reader. Extracts world-space triangles with
// a flat RGB color per triangle (the material's baseColorFactor — texture
// sampling is out of scope, so textured models come through white).
// Dependency-free on purpose; covers what text-to-3D services emit:
// embedded BIN chunk, float32 positions, TRIANGLES primitives.

export type Vec3 = [number, number, number];

export type Triangle = {
  a: Vec3;
  b: Vec3;
  c: Vec3;
  /** linear 0..1 */
  rgb: [number, number, number];
};

type GltfNode = {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
};

type GltfPrimitive = {
  attributes: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
};

type Gltf = {
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives: GltfPrimitive[] }[];
  materials?: {
    pbrMetallicRoughness?: { baseColorFactor?: number[] };
  }[];
  accessors?: {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    count: number;
    type: string;
  }[];
  bufferViews?: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }[];
};

// --- 4x4 column-major matrices (glTF convention) ---

type Mat4 = number[];

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function fromTrs(node: GltfNode): Mat4 {
  if (node.matrix) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const x2 = qx + qx, y2 = qy + qy, z2 = qz + qz;
  const xx = qx * x2, xy = qx * y2, xz = qx * z2;
  const yy = qy * y2, yz = qy * z2, zz = qz * z2;
  const wx = qw * x2, wy = qw * y2, wz = qw * z2;
  return [
    (1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
    (xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
    (xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
  ];
}

// --- accessor reading ---

const FLOAT = 5126;
const UBYTE = 5121;
const USHORT = 5123;
const UINT = 5125;

function readPositions(gltf: Gltf, bin: DataView, accessorIndex: number): Vec3[] {
  const acc = gltf.accessors?.[accessorIndex];
  if (!acc) throw new Error(`missing accessor ${accessorIndex}`);
  if (acc.componentType !== FLOAT || acc.type !== 'VEC3') {
    throw new Error(`POSITION accessor must be float VEC3, got ${acc.componentType}/${acc.type}`);
  }
  const view = gltf.bufferViews?.[acc.bufferView ?? -1];
  if (!view) throw new Error('POSITION accessor has no bufferView');
  const stride = view.byteStride ?? 12;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: Vec3[] = [];
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    out.push([
      bin.getFloat32(o, true),
      bin.getFloat32(o + 4, true),
      bin.getFloat32(o + 8, true),
    ]);
  }
  return out;
}

function readIndices(gltf: Gltf, bin: DataView, accessorIndex: number): number[] {
  const acc = gltf.accessors?.[accessorIndex];
  if (!acc) throw new Error(`missing accessor ${accessorIndex}`);
  const view = gltf.bufferViews?.[acc.bufferView ?? -1];
  if (!view) throw new Error('index accessor has no bufferView');
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out: number[] = [];
  for (let i = 0; i < acc.count; i++) {
    switch (acc.componentType) {
      case UBYTE:
        out.push(bin.getUint8(base + i));
        break;
      case USHORT:
        out.push(bin.getUint16(base + i * 2, true));
        break;
      case UINT:
        out.push(bin.getUint32(base + i * 4, true));
        break;
      default:
        throw new Error(`unsupported index componentType ${acc.componentType}`);
    }
  }
  return out;
}

function materialRgb(gltf: Gltf, materialIndex: number | undefined): [number, number, number] {
  const factor =
    materialIndex !== undefined
      ? gltf.materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorFactor
      : undefined;
  const [r, g, b] = factor ?? [1, 1, 1];
  return [r, g, b];
}

// --- GLB container ---

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

export function parseGlb(buffer: ArrayBuffer): Triangle[] {
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB file (bad magic)');
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new Error(`unsupported GLB version ${version}`);

  let json: Gltf | null = null;
  let bin: DataView | null = null;
  let offset = 12;
  while (offset < dv.getUint32(8, true)) {
    const length = dv.getUint32(offset, true);
    const type = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (type === CHUNK_JSON) {
      const text = new TextDecoder().decode(new Uint8Array(buffer, start, length));
      json = JSON.parse(text) as Gltf;
    } else if (type === CHUNK_BIN) {
      bin = new DataView(buffer, start, length);
    }
    offset = start + length;
  }
  if (!json) throw new Error('GLB has no JSON chunk');
  if (!bin) throw new Error('GLB has no BIN chunk (external buffers unsupported)');

  // Collect world matrices for every node that carries a mesh.
  const meshInstances: { mesh: number; matrix: Mat4 }[] = [];
  const visit = (nodeIndex: number, parent: Mat4) => {
    const node = json.nodes?.[nodeIndex];
    if (!node) return;
    const world = multiply(parent, fromTrs(node));
    if (node.mesh !== undefined) meshInstances.push({ mesh: node.mesh, matrix: world });
    for (const child of node.children ?? []) visit(child, world);
  };
  const roots = json.scenes?.[json.scene ?? 0]?.nodes;
  if (roots) {
    for (const r of roots) visit(r, IDENTITY);
  } else {
    for (let i = 0; i < (json.nodes?.length ?? 0); i++) visit(i, IDENTITY);
  }
  if (meshInstances.length === 0 && (json.meshes?.length ?? 0) > 0) {
    // No scene graph at all — take meshes as-is.
    for (let i = 0; i < json.meshes!.length; i++) {
      meshInstances.push({ mesh: i, matrix: IDENTITY });
    }
  }

  const triangles: Triangle[] = [];
  for (const { mesh, matrix } of meshInstances) {
    for (const prim of json.meshes?.[mesh]?.primitives ?? []) {
      if (prim.mode !== undefined && prim.mode !== 4) continue; // TRIANGLES only
      const posAccessor = prim.attributes['POSITION'];
      if (posAccessor === undefined) continue;
      const positions = readPositions(json, bin, posAccessor).map(p =>
        transformPoint(matrix, p),
      );
      const indices =
        prim.indices !== undefined
          ? readIndices(json, bin, prim.indices)
          : positions.map((_, i) => i);
      const rgb = materialRgb(json, prim.material);
      for (let i = 0; i + 2 < indices.length; i += 3) {
        triangles.push({
          a: positions[indices[i]],
          b: positions[indices[i + 1]],
          c: positions[indices[i + 2]],
          rgb,
        });
      }
    }
  }
  return triangles;
}
