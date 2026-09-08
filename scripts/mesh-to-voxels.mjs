import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as THREE from 'three';
import { PALETTE } from '../src/geometry.js';

export const LIMITS = Object.freeze({ bytes: 50_000_000, vertices: 1_000_000, triangles: 1_000_000, texturePixels: 4096 * 4096, candidates: 20_000_000 });
const COMPONENT = { 5125: { bytes: 4, ctor: Uint32Array }, 5126: { bytes: 4, ctor: Float32Array } };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3 };

function check(cond, message) { if (!cond) throw new Error(message); }
function identityNode(node) {
  return !node.matrix && !node.translation && !node.rotation && !node.scale;
}

export function parseGlb(buffer, limits = LIMITS) {
  check(buffer.length <= limits.bytes, `GLB exceeds ${limits.bytes}-byte cap`);
  check(buffer.length >= 20 && buffer.toString('ascii', 0, 4) === 'glTF', 'Invalid GLB magic');
  check(buffer.readUInt32LE(4) === 2 && buffer.readUInt32LE(8) === buffer.length, 'Invalid GLB version or declared length');
  let offset = 12, json, bin;
  while (offset < buffer.length) {
    check(offset + 8 <= buffer.length, 'Truncated GLB chunk header');
    const len = buffer.readUInt32LE(offset), type = buffer.readUInt32LE(offset + 4); offset += 8;
    check(offset + len <= buffer.length, 'GLB chunk exceeds file bounds');
    if (type === 0x4e4f534a) { check(!json, 'Multiple JSON chunks unsupported'); json = JSON.parse(buffer.toString('utf8', offset, offset + len).trim()); }
    else if (type === 0x004e4942) { check(!bin, 'Multiple BIN chunks unsupported'); bin = buffer.subarray(offset, offset + len); }
    else throw new Error('Unsupported GLB chunk');
    offset += len;
  }
  check(json && bin, 'GLB requires JSON and BIN chunks');
  check((json.buffers?.length ?? 0) === 1 && !json.buffers[0].uri, 'Exactly one embedded buffer required');
  check(json.buffers[0].byteLength <= bin.length, 'Declared buffer exceeds BIN chunk');
  const allowed = new Set(['EXT_texture_webp']);
  for (const ext of [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])]) check(allowed.has(ext), `Unsupported extension ${ext}`);
  check((json.meshes?.length ?? 0) === 1 && json.meshes[0].primitives?.length === 1, 'Exactly one mesh primitive required');
  check((json.nodes ?? []).every(identityNode), 'Node transforms unsupported');
  check(!json.buffers[0].uri && (json.images ?? []).every(i => !i.uri), 'External URIs forbidden');
  const primitive = json.meshes[0].primitives[0];
  check((primitive.mode ?? 4) === 4 && Number.isInteger(primitive.indices), 'Indexed TRIANGLES primitive required');
  check(Number.isInteger(primitive.attributes?.POSITION) && Number.isInteger(primitive.attributes?.TEXCOORD_0), 'POSITION and TEXCOORD_0 required');

  function accessor(index, expectedType, expectedComponent) {
    const a = json.accessors?.[index]; check(a && a.type === expectedType && a.componentType === expectedComponent && !a.sparse, `Unsupported accessor ${index}`);
    const view = json.bufferViews?.[a.bufferView]; check(view && (view.buffer ?? 0) === 0, `Invalid bufferView for accessor ${index}`);
    const n = WIDTH[a.type], spec = COMPONENT[a.componentType];
    const stride = view.byteStride ?? n * spec.bytes; check(stride === n * spec.bytes, 'Interleaved accessors unsupported');
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0), bytes = a.count * stride;
    check(start >= 0 && bytes >= 0 && start + bytes <= (view.byteOffset ?? 0) + view.byteLength && start + bytes <= bin.length, `Accessor ${index} exceeds bounds`);
    check(start % spec.bytes === 0, `Accessor ${index} misaligned`);
    return new spec.ctor(bin.buffer, bin.byteOffset + start, a.count * n);
  }
  const indices = accessor(primitive.indices, 'SCALAR', 5125);
  const positions = accessor(primitive.attributes.POSITION, 'VEC3', 5126);
  const uvs = accessor(primitive.attributes.TEXCOORD_0, 'VEC2', 5126);
  check(positions.length / 3 <= limits.vertices && indices.length / 3 <= limits.triangles && indices.length % 3 === 0, 'Geometry cap or triangle arity exceeded');
  check(uvs.length / 2 === positions.length / 3, 'UV and position counts differ');
  for (const x of positions) check(Number.isFinite(x), 'Non-finite position');
  for (const x of uvs) check(Number.isFinite(x), 'Non-finite UV');
  for (const i of indices) check(i < positions.length / 3, 'Triangle index out of bounds');

  const material = json.materials?.[primitive.material];
  check(JSON.stringify(material?.pbrMetallicRoughness?.baseColorFactor ?? [1,1,1,1]) === '[1,1,1,1]', 'Non-identity baseColorFactor unsupported');
  const texIndex = material?.pbrMetallicRoughness?.baseColorTexture?.index;
  check((material?.pbrMetallicRoughness?.baseColorTexture?.texCoord ?? 0) === 0 && !material?.pbrMetallicRoughness?.baseColorTexture?.extensions, 'Alternate or transformed texture coordinates unsupported');
  const texture = json.textures?.[texIndex];
  const imageIndex = texture?.extensions?.EXT_texture_webp?.source ?? texture?.source;
  const image = json.images?.[imageIndex];
  check(image?.mimeType === 'image/webp' && Number.isInteger(image.bufferView), 'Embedded WebP base color required');
  const iv = json.bufferViews[image.bufferView], imageStart = iv.byteOffset ?? 0;
  check(imageStart + iv.byteLength <= bin.length, 'Image exceeds buffer bounds');
  for (const uv of uvs) check(uv >= 0 && uv <= 1, 'UV outside supported clamp range');
  return { json, positions, uvs, indices, image: bin.subarray(imageStart, imageStart + iv.byteLength) };
}

export function decodeWebp(bytes, limits = LIMITS) {
  const result = spawnSync('python3', [new URL('./decode-webp.py', import.meta.url).pathname, String(limits.texturePixels)], { input: bytes, maxBuffer: limits.texturePixels * 4 + 1024, timeout: 10_000 });
  check(result.status === 0, `WebP decode failed: ${result.stderr.toString().trim()}`);
  check(result.stdout.length >= 8, 'Truncated decoded texture');
  const width = result.stdout.readUInt32LE(0), height = result.stdout.readUInt32LE(4);
  check(width * height <= limits.texturePixels && result.stdout.length === 8 + width * height * 4, 'Invalid decoded texture');
  return { width, height, rgba: result.stdout.subarray(8) };
}

const paletteEntries = Object.entries(PALETTE).map(([name, text]) => { const hex = parseInt(text.slice(1), 16); return [name, [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]]; });
export function nearestPalette(rgb) {
  let best, distance = Infinity;
  for (const [name, p] of paletteEntries) { const d = p.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0); if (d < distance) { best = name; distance = d; } }
  return best;
}

export function voxelizeMesh({ positions, uvs, indices, texture }, resolution = 24, limits = LIMITS) {
  check(Number.isInteger(resolution) && resolution > 0 && resolution <= 64, 'Resolution must be 1..64');
  const bounds = new THREE.Box3();
  for (let i = 0; i < positions.length; i += 3) bounds.expandByPoint(new THREE.Vector3(positions[i], positions[i+1], positions[i+2]));
  const size = bounds.getSize(new THREE.Vector3()), scale = resolution / Math.max(size.x, size.y, size.z);
  check(Number.isFinite(scale) && scale > 0, 'Mesh must have a finite positive extent');
  const dims = [size.x, size.y, size.z].map(v => Math.max(1, Math.ceil(v * scale)));
  const normalized = new Float32Array(positions.length);
  for (let i=0;i<positions.length;i+=3) { normalized[i]=(positions[i]-bounds.min.x)*scale; normalized[i+1]=(positions[i+1]-bounds.min.y)*scale; normalized[i+2]=(positions[i+2]-bounds.min.z)*scale; }
  const cells = new Map(), tri = new THREE.Triangle(), box = new THREE.Box3(), center = new THREE.Vector3(), closest = new THREE.Vector3(), bary = new THREE.Vector3();
  let candidateWork = 0, degenerateTriangleCount = 0;
  for (let t=0;t<indices.length;t+=3) {
    const ia=indices[t], ib=indices[t+1], ic=indices[t+2];
    tri.a.fromArray(normalized,ia*3); tri.b.fromArray(normalized,ib*3); tri.c.fromArray(normalized,ic*3);
    if (tri.getArea() <= Number.EPSILON) { degenerateTriangleCount++; continue; }
    const lo=[0,1,2].map(k=>Math.max(0,Math.ceil(Math.min(tri.a.getComponent(k),tri.b.getComponent(k),tri.c.getComponent(k)))-1));
    const hi=[0,1,2].map(k=>Math.min(dims[k]-1,Math.floor(Math.max(tri.a.getComponent(k),tri.b.getComponent(k),tri.c.getComponent(k)))));
    candidateWork += Math.max(0,hi[0]-lo[0]+1)*Math.max(0,hi[1]-lo[1]+1)*Math.max(0,hi[2]-lo[2]+1); check(candidateWork <= limits.candidates,'Raster candidate-work cap exceeded');
    for(let x=lo[0];x<=hi[0];x++) for(let y=lo[1];y<=hi[1];y++) for(let z=lo[2];z<=hi[2];z++) {
      box.min.set(x,y,z); box.max.set(x+1,y+1,z+1); if(!box.intersectsTriangle(tri)) continue;
      const key=`${x},${y},${z}`; center.set(x+.5,y+.5,z+.5); tri.closestPointToPoint(center,closest); tri.getBarycoord(closest,bary);
      const uvx=bary.x*uvs[ia*2]+bary.y*uvs[ib*2]+bary.z*uvs[ic*2], uvy=bary.x*uvs[ia*2+1]+bary.y*uvs[ib*2+1]+bary.z*uvs[ic*2+1];
      const px=Math.min(texture.width-1,Math.max(0,Math.floor(uvx*texture.width))), py=Math.min(texture.height-1,Math.max(0,Math.floor(uvy*texture.height))); const p=(py*texture.width+px)*4;
      const d=center.distanceToSquared(closest), old=cells.get(key); if(!old||d<old.d) cells.set(key,{x,y,z,color:nearestPalette([texture.rgba[p],texture.rgba[p+1],texture.rgba[p+2]]),d});
    }
  }
  const key=(x,y,z)=>`${x},${y},${z}`;
  const exterior=floodExterior(cells,dims,key);
  const fill=[]; for(let x=0;x<dims[0];x++)for(let y=0;y<dims[1];y++)for(let z=0;z<dims[2];z++){const k=key(x,y,z);if(!cells.has(k)&&!exterior.has(k))fill.push([x,y,z]);}
  const inherited=inheritInterior(cells,exterior,dims,key);
  const output=[...cells.values()].map(({d,...c})=>c); for(const [x,y,z] of fill) output.push({x,y,z,color:inherited.get(key(x,y,z))}); output.sort((a,b)=>a.y-b.y||a.z-b.z||a.x-b.x);
  return { cells:output, surfaceCount:cells.size, interiorCount:fill.length, candidateWork, degenerateTriangleCount, dimensions:{x:dims[0],y:dims[1],z:dims[2]}, sourceBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()}, scale };
}

const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
function inGrid(x,y,z,dims){return x>=0&&y>=0&&z>=0&&x<dims[0]&&y<dims[1]&&z<dims[2];}
function floodExterior(surface,dims,key){
  const seen=new Set(),queue=[];
  for(let x=0;x<dims[0];x++) for(let y=0;y<dims[1];y++) for(let z=0;z<dims[2];z++) { const boundary=x===0||y===0||z===0||x===dims[0]-1||y===dims[1]-1||z===dims[2]-1,k=key(x,y,z); if(boundary&&!surface.has(k)){seen.add(k);queue.push([x,y,z]);} }
  for(let i=0;i<queue.length;i++){const [x,y,z]=queue[i];for(const [dx,dy,dz] of directions){const a=x+dx,b=y+dy,c=z+dz,k=key(a,b,c);if(inGrid(a,b,c,dims)&&!surface.has(k)&&!seen.has(k)){seen.add(k);queue.push([a,b,c]);}}}
  return seen;
}
function inheritInterior(surface,exterior,dims,key){
  const colors=new Map(),queue=[...surface.values()].map(c=>[c.x,c.y,c.z,c.color]);
  for(let i=0;i<queue.length;i++){const [x,y,z,color]=queue[i];for(const [dx,dy,dz] of directions){const a=x+dx,b=y+dy,c=z+dz,k=key(a,b,c);if(inGrid(a,b,c,dims)&&!surface.has(k)&&!exterior.has(k)&&!colors.has(k)){colors.set(k,color);queue.push([a,b,c,color]);}}}
  return colors;
}

export function convertFile(input, resolution=24) { const started=performance.now(), stat=fs.statSync(input); check(stat.size<=LIMITS.bytes,`GLB exceeds ${LIMITS.bytes}-byte cap`); const raw=fs.readFileSync(input), parsed=parseGlb(raw), texture=decodeWebp(parsed.image), rasterStarted=performance.now(), result=voxelizeMesh({...parsed,texture},resolution); return { result, texture:{width:texture.width,height:texture.height}, sourceGeometry:{vertices:parsed.positions.length/3,triangles:parsed.indices.length/3}, sourceHash:crypto.createHash('sha256').update(raw).digest('hex'), rasterizationMs:performance.now()-rasterStarted, conversionMs:performance.now()-started }; }
