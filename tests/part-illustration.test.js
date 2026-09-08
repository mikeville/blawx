import test from 'node:test';
import assert from 'node:assert/strict';
import { partIllustration, tallyParts } from '../src/part-illustration.js';
import { brickPreviewData } from '../src/brick-preview.js';

test('illustrated inventory counts rotated bricks together but retains color distinctions',()=>{
  assert.deepEqual(tallyParts([{w:2,d:4,color:'red'},{w:4,d:2,color:'red'},{w:2,d:4,color:'blue'}]),[
    {key:'2x4:blue',w:2,d:4,color:'blue',count:1},{key:'2x4:red',w:2,d:4,color:'red',count:2},
  ]);
  const drawing = partIllustration({w:2,d:4,color:'red'});
  assert.ok(drawing.includes('fill="#c91a09"'));
  assert.equal((drawing.match(/<ellipse/g)||[]).length,8);
  assert.ok(!drawing.includes('NaN'));
});
test('step rendering retains placement IDs on both bodies and exposed studs',()=>{
  const {bodies,studs}=brickPreviewData({bricks:[{id:'one',x:0,y:0,z:0,w:2,d:2,color:'red'}]});
  assert.equal(bodies[0].id,'one');
  assert.ok(studs.every(s=>s.id==='one'));
});
