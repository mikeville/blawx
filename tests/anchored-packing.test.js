import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeAnchoredPacking,packingSignature} from '../src/anchored-packing.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';

const cells = bs => bs.flatMap(b => Array.from({length:b.w*b.d},(_,i) => `${b.x+i%b.w},${b.y},${b.z+Math.floor(i/b.w)}:${b.color}`)).sort();
const overlap = (a,b) => a.x < b.x+b.w && b.x < a.x+a.w && a.z < b.z+b.d && b.z < a.z+a.d;
const fixture = color => [{x:0,y:0,z:0,w:2,d:2,color:'black'},
  {x:0,y:1,z:0,w:2,d:2,color},{x:2,y:1,z:0,w:2,d:2,color},
  {x:0,y:2,z:0,w:4,d:2,color}];

test('repack an upper-supported toe without changing occupied cells, in any orientation or palette',() => {
  for (let turn=0;turn<4;turn++) {
    const bricks = fixture(turn%2 ? 'blue' : 'green').map(b => rotateRecipeBrick(b,turn));
    const original = structuredClone(bricks), proposals = proposeAnchoredPacking({bricks},bricks);
    assert(proposals.length);
    for (const p of proposals) {
      assert.deepEqual(cells(p.bricks),cells(bricks));
      assert(p.after.every(b => p.bricks.some(lower => lower.y === b.y-1 && overlap(lower,b))));
      assert(p.unsupportedRemoved > 0);
      assert(p.after.every(b => [1,2,3,4].includes(b.w) && [1,2,3,4].includes(b.d) && b.w*b.d <= 8));
      assert.equal(new Set(cells(p.bricks).map(c => c.split(':')[0])).size,cells(p.bricks).length);
    }
    assert.deepEqual(bricks,original);
  }
});

test('do not cross colors or component ownership, invent missing support, or exceed a disabled search budget',() => {
  const bricks = fixture('green'), toe = bricks[2];
  assert.deepEqual(proposeAnchoredPacking({bricks},bricks,{maxCandidates:0}),[]);
  assert.deepEqual(proposeAnchoredPacking({bricks},bricks,{maxNodes:0}),[]);
  assert.deepEqual(proposeAnchoredPacking({bricks},bricks.filter(b => b !== bricks[1])),[]);
  const recolored = bricks.map(b => b === toe ? {...b,color:'red'} : b);
  assert.deepEqual(proposeAnchoredPacking({bricks:recolored},recolored),[]);
  const unsupported = bricks.map(b => b.y === 0 ? {...b,x:20} : b);
  assert.deepEqual(proposeAnchoredPacking({bricks:unsupported},unsupported),[]);
  const supported = bricks.filter(b => packingSignature(b) !== packingSignature(toe));
  assert.deepEqual(proposeAnchoredPacking({bricks:supported},supported),[]);
});
