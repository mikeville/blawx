import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGlb, voxelizeMesh, nearestPalette, LIMITS } from '../scripts/mesh-to-voxels.mjs';

const white={width:1,height:1,rgba:Buffer.from([255,255,255,255])};
function mesh(vertices, triangles, colors=white) { return { positions:new Float32Array(vertices.flat()), uvs:new Float32Array(vertices.flatMap((_,i)=>i<vertices.length?[0,0]:[]).slice(0,vertices.length*2)), indices:new Uint32Array(triangles.flat()), texture:colors }; }
function box(open=false) {
  const v=[[0,0,0],[4,0,0],[4,4,0],[0,4,0],[0,0,4],[4,0,4],[4,4,4],[0,4,4]];
  const f=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
  return mesh(v,open?f.slice(2):f);
}

test('closed cube gains enclosed interior while open box does not',()=>{
  const closed=voxelizeMesh(box(),4), open=voxelizeMesh(box(true),4);
  assert.equal(closed.surfaceCount,56); assert.equal(closed.interiorCount,8); assert.equal(closed.cells.length,64); assert.equal(open.interiorCount,0);
});

test('triangle AABB candidates still require SAT and preserve thin surface hits',()=>{
  const thin=voxelizeMesh(mesh([[0,0,0],[4,0,0],[0,4,0]],[[0,1,2]]),4);
  assert.ok(thin.surfaceCount>0);
  assert.ok(thin.surfaceCount<16,'AABB false positives should be rejected');
});

test('texture color sampling quantizes through the existing palette',()=>{
  assert.equal(nearestPalette([255,255,255]),'white');
  assert.equal(nearestPalette([0,0,0]),'black');
  const red={width:1,height:1,rgba:Buffer.from([255,0,0,255])};
  const result=voxelizeMesh(mesh([[0,0,0],[1,0,0],[0,1,0]],[[0,1,2]],red),4);
  assert.ok(result.cells.every(c=>c.color==='red'));
});

test('all existing palette RGB values round-trip exactly',()=>{
  const expected={black:[17,17,17],white:[244,244,244],lightGray:[160,165,169],darkGray:[84,89,85],red:[201,26,9],yellow:[242,205,55],blue:[0,85,191],green:[35,120,65],tan:[228,205,158],brown:[88,57,39],orange:[254,138,24]};
  for(const [name,rgb] of Object.entries(expected)) assert.equal(nearestPalette(rgb),name);
});

test('UV v=0 samples the top row of top-down decoded texture',()=>{
  const texture={width:2,height:2,rgba:Buffer.from([201,26,9,255,0,85,191,255,35,120,65,255,242,205,55,255])};
  const input=mesh([[0,0,0],[1,0,0],[0,1,0]],[[0,1,2]],texture);
  input.uvs=new Float32Array([0,0,0,0,0,0]);
  assert.ok(voxelizeMesh(input,4).cells.every(cell=>cell.color==='red'));
});

function glb(json, bin=Buffer.alloc(80)) {
  const j=Buffer.from(JSON.stringify(json)); const padded=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,0x20)]); const body=bin.length%4?Buffer.concat([bin,Buffer.alloc(4-bin.length%4)]):bin;
  const out=Buffer.alloc(12+8+padded.length+8+body.length); out.write('glTF');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(padded.length,12);out.writeUInt32LE(0x4e4f534a,16);padded.copy(out,20);let o=20+padded.length;out.writeUInt32LE(body.length,o);out.writeUInt32LE(0x004e4942,o+4);body.copy(out,o+8);return out;
}
function minimalJson(){return {asset:{version:'2.0'},extensionsUsed:['EXT_texture_webp'],extensionsRequired:['EXT_texture_webp'],buffers:[{byteLength:80}],bufferViews:[{buffer:0,byteOffset:0,byteLength:12},{buffer:0,byteOffset:12,byteLength:36},{buffer:0,byteOffset:48,byteLength:24},{buffer:0,byteOffset:72,byteLength:8}],accessors:[{bufferView:0,componentType:5125,count:3,type:'SCALAR'},{bufferView:1,componentType:5126,count:3,type:'VEC3'},{bufferView:2,componentType:5126,count:3,type:'VEC2'}],images:[{bufferView:3,mimeType:'image/webp'}],textures:[{extensions:{EXT_texture_webp:{source:0}}}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}],meshes:[{primitives:[{attributes:{POSITION:1,TEXCOORD_0:2},indices:0,mode:4,material:0}]}],nodes:[{mesh:0}]};}

test('strict parser rejects oversized files, source bound overruns, external URIs, transforms, and bad indices',()=>{
  assert.throws(()=>parseGlb(Buffer.alloc(101),{...LIMITS,bytes:100}),/cap/);
  const external=minimalJson(); external.images[0]={uri:'x.webp'}; assert.throws(()=>parseGlb(glb(external)),/External URIs|Embedded WebP/);
  const transformed=minimalJson(); transformed.nodes[0].translation=[1,0,0]; assert.throws(()=>parseGlb(glb(transformed)),/transforms/);
  const overrun=minimalJson(); overrun.bufferViews[1].byteLength=8; assert.throws(()=>parseGlb(glb(overrun)),/bounds/);
  const bad=minimalJson(), bytes=Buffer.alloc(80); bytes.writeUInt32LE(9,0); assert.throws(()=>parseGlb(glb(bad,bytes)),/index out of bounds/);
});

test('strict parser accepts its bounded known local subset',()=>{
  const bytes=Buffer.alloc(80); bytes.writeUInt32LE(0,0);bytes.writeUInt32LE(1,4);bytes.writeUInt32LE(2,8);
  new Float32Array(bytes.buffer,bytes.byteOffset+12,9).set([0,0,0,1,0,0,0,1,0]);
  const parsed=parseGlb(glb(minimalJson(),bytes)); assert.equal(parsed.indices.length,3); assert.equal(parsed.positions.length,9);
});
