import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGlb } from './glb.ts';

/** Build a minimal valid GLB: one red triangle, indexed, under a scaled node. */
function makeGlb(): ArrayBuffer {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]);
  const indices = new Uint16Array([0, 1, 2]);

  // 36 bytes positions + 6 bytes indices, padded to a 4-byte boundary (42 -> 44)
  const binFull = new Uint8Array(44);
  binFull.set(new Uint8Array(positions.buffer), 0);
  binFull.set(new Uint8Array(indices.buffer), 36);

  const gltf = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, scale: [2, 2, 2] }],
    meshes: [
      {
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1, material: 0 },
        ],
      },
    ],
    materials: [
      { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 6 },
    ],
    buffers: [{ byteLength: 44 }],
  };

  let jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  if (jsonPad > 0) {
    const padded = new Uint8Array(jsonBytes.length + jsonPad);
    padded.set(jsonBytes);
    padded.fill(0x20, jsonBytes.length); // pad with spaces
    jsonBytes = padded;
  }

  const total = 12 + 8 + jsonBytes.length + 8 + binFull.length;
  const out = new ArrayBuffer(total);
  const dv = new DataView(out);
  const u8 = new Uint8Array(out);
  dv.setUint32(0, 0x46546c67, true); // magic
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  u8.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  dv.setUint32(binStart, binFull.length, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // BIN
  u8.set(binFull, binStart + 8);
  return out;
}

test('parses a minimal GLB with node transform and material color', () => {
  const tris = parseGlb(makeGlb());
  assert.equal(tris.length, 1);
  const t = tris[0];
  // node scale [2,2,2] applied
  assert.deepEqual(t.a, [0, 0, 0]);
  assert.deepEqual(t.b, [2, 0, 0]);
  assert.deepEqual(t.c, [0, 2, 0]);
  assert.deepEqual(t.rgb, [1, 0, 0]);
});

test('rejects non-GLB input', () => {
  const junk = new ArrayBuffer(16);
  assert.throws(() => parseGlb(junk), /bad magic/);
});
