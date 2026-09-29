import test from 'node:test';
import assert from 'node:assert/strict';
import {brickPreviewData} from '../src/brick-preview.js';
import {brickUndersideParts} from '../src/brick-undersides.js';
import {partIllustration,stepInventoryMarkup,inventoryMarkup} from '../src/part-illustration.js';
import {getBrickFaceColor,getBrickOutlineColor} from '../src/black-piece-ink.js';
import {PALETTE} from '../src/geometry.js';

test('underside shells preserve outer bounds and use tubes for wide bricks and pins for narrow bricks',()=>{
 for(const [w,d,tubes,pins] of [[2,4,3,0],[4,2,3,0],[2,2,1,0],[1,4,0,3],[4,1,0,3],[1,1,0,0]]){
  const model={bricks:[{id:'a',x:2,y:3,z:4,w,d,color:'tan'}]};
  const {bodies}=brickPreviewData(model),before=structuredClone(bodies),b=bodies[0];
  const parts=brickUndersideParts(bodies);
  assert.deepEqual(bodies,before);
  assert.equal(parts.walls.length,5);assert.equal(parts.tubes.length,tubes);assert.equal(parts.pins.length,pins);
  for(const wall of parts.walls)for(const [axis,size] of [['x','w'],['y','h'],['z','d']]){
   assert(wall[axis]-wall[size]/2>=b[axis]-b[size]/2-1e-9);
   assert(wall[axis]+wall[size]/2<=b[axis]+b[size]/2+1e-9);
  }
  assert(parts.walls.every(wall=>wall.y-wall.h/2>b.y-b.h/2+.01||wall.w<b.w||wall.d<b.d),'no solid bottom cap');
 }
});

test('part illustrations share black face and outline colors and compact dimensions',()=>{
 const svg=partIllustration({w:2,d:4,color:'black'});
 assert(svg.includes(`fill="#${getBrickFaceColor(PALETTE.black).getHexString()}"`));
 assert(svg.includes(`stroke="#${getBrickOutlineColor('black').toString(16)}"`));
 assert.equal((svg.match(/<ellipse/g)||[]).length,8);
 const parts=stepInventoryMarkup([{w:2,d:4,color:'black',count:2}]);
 assert(parts.includes('×2'));assert(!parts.includes('2×4'));
 const inventory=inventoryMarkup([{w:2,d:4,color:'black',count:2}]);
 assert(inventory.includes('×2'));assert(inventory.includes('2×4'));assert(!inventory.includes('2 × 4'));
 assert(parts.includes('black 2 by 4 brick'),'step illustration retains its accessible part description');
});

test('underside centers fall between studs at consistent physical pitch across brick orientations and scales',()=>{
 for(const voxelMm of [4,8,16])for(const [w,d] of [[2,4],[4,2],[2,2],[1,4],[4,1],[1,2],[1,1]]){
  const model={meta:{scale:{voxelMm,studsPerVoxel:voxelMm/8,coursesPerVoxel:voxelMm/9.6}},bricks:[{id:'a',x:3,y:2,z:5,w,d,color:'tan'}]};
  const body=brickPreviewData(model).bodies[0],parts=brickUndersideParts([body],voxelMm);
  const centers=[...parts.tubes,...parts.pins].map(p=>[(p.x-body.x)*voxelMm,(p.z-body.z)*voxelMm]);
  const expected=w===1?Array.from({length:d-1},(_,i)=>[0,(i+1-d/2)*8]):d===1?Array.from({length:w-1},(_,i)=>[(i+1-w/2)*8,0]):Array.from({length:w-1},(_,i)=>Array.from({length:d-1},(_,j)=>[(i+1-w/2)*8,(j+1-d/2)*8])).flat();
  assert.deepEqual(centers,expected);
  for(const part of [...parts.tubes,...parts.pins])assert(Math.abs((body.h-part.h)*voxelMm-1.6)<1e-9);
 }
});
