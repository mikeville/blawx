import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseUndersideInstructionView, evaluateInstructionVisibility} from '../src/instruction-visibility.js';
import {chooseUpwardInsertionAzimuth} from '../src/upward-insertion-azimuth.js';
import {brickPreviewData} from '../src/brick-preview.js';
import {rotateRecipeBrick} from '../src/assembly-recipes.js';

const brick = (id, x, y, z, w = 1, d = 1) => ({id, x, y, z, w, d, color: 'blue'});
function recessed() {
  const parts = [brick('top',0,2,0,5,5),brick('a',1,1,1),brick('b',3,1,3)];
  for (const y of [0,1]) parts.push(brick('left'+y,0,y,0,1,5),brick('right'+y,4,y,0,1,5),
    brick('front'+y,1,y,0,3),brick('back'+y,1,y,4,3));
  return parts;
}
for (let turn = 0; turn < 4; turn++) test(`a recessed underside exposes every addition together, rotation ${turn}`, () => {
  const visibleBricks = recessed().map(b => ({...rotateRecipeBrick(b,turn),id:b.id,color:turn%2?'green':b.color}));
  const snapshot = structuredClone(visibleBricks), highlightedIds = ['a','b'];
  const highlightGroups = highlightedIds.map(id => ({id,bricks:visibleBricks.filter(b=>b.id===id)}));
  for (const angle of [.25,.75,1.25,1.75]) assert.equal(evaluateInstructionVisibility({
    visibleBricks,highlightGroups,azimuth:angle*Math.PI,elevation:-Math.PI/7}).passes,false);
  const view = chooseUndersideInstructionView({visibleBricks,highlightedIds});
  assert.equal(view.passes,true);assert.equal(view.truncated,false);
  assert.ok(view.elevation < -Math.PI/7);
  assert.ok(view.groups.every(g=>g.visibleBrickCount===1&&g.visibleSampleWeight>=4));
  assert.deepEqual(visibleBricks,snapshot);
});

test('an already readable underside keeps its established camera', () => {
  const visibleBricks = [brick('a',0,1,0),brick('top',0,2,0,3)];
  const expected = chooseUpwardInsertionAzimuth(brickPreviewData({bricks:visibleBricks}).bodies,new Set(['a']));
  const view = chooseUndersideInstructionView({visibleBricks,highlightedIds:['a']});
  assert.equal(view.azimuth,expected);assert.equal(view.elevation,-Math.PI/7);assert(view.passes&&!view.truncated);
});

test('missing or unexamined additions cannot produce a passing underside view', () => {
  assert.equal(chooseUndersideInstructionView({visibleBricks:recessed(),highlightedIds:['absent']}).passes,false);
  const visibleBricks = Array.from({length:1000},(_,i)=>brick(String(i),i*2,1,0));
  const view = chooseUndersideInstructionView({visibleBricks,highlightedIds:visibleBricks.map(b=>b.id)});
  assert.equal(view.passes,false);assert.equal(view.truncated,true);
});
