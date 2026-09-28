import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateInstructionVisibility } from '../src/instruction-visibility.js';

const brick = (id, x, y, z, w = 1, d = 1) => ({ id, x, y, z, w, d, color: 'orange' });

test('default instruction view rejects a source operation hidden behind final geometry', () => {
  const hidden = brick('hidden', 0, 0, 0);
  // At the 135-degree isometric view this upper plate covers the lower brick's projection.
  const blocker = brick('blocker', -1, 1, -3, 4, 4);
  const result = evaluateInstructionVisibility({
    visibleBricks: [hidden, blocker],
    highlightGroups: [{ id: 'earlier-step', bricks: [hidden] }],
  });

  assert.equal(result.passes, false);
  assert.equal(result.truncated, false);
  assert.equal(result.groups[0].visibleBrickCount, 0);
});

test('covered top remains eligible when the ordinary isometric view exposes a side', () => {
  const lower = brick('lower', 0, 0, 0, 2, 2);
  const upper = brick('upper', 0, 1, 0, 2, 2);
  const result = evaluateInstructionVisibility({
    visibleBricks: [lower, upper],
    highlightGroups: [
      { id: 'lower-course', bricks: [lower] },
      { id: 'upper-course', bricks: [upper] },
    ],
  });

  assert.equal(result.passes, true);
  assert.deepEqual(result.groups.map(({ visibleBrickCount }) => visibleBrickCount), [1, 1]);
});

test('ray budget fails closed when it cannot examine one brick from every source group', () => {
  const first = brick('first', 0, 0, 0);
  const second = brick('second', 3, 0, 0);
  const result = evaluateInstructionVisibility({
    visibleBricks: [first, second],
    highlightGroups: [
      { id: 'step-1', bricks: [first] },
      { id: 'step-2', bricks: [second] },
    ],
    maxRayTests: 9,
  });

  assert.equal(result.passes, false);
  assert.equal(result.truncated, true);
  assert.equal(result.testedHighlightBrickCount, 0);
});

test('instruction camera turns to expose additions hidden behind existing construction', async()=>{
  const {chooseInstructionView}=await import('../src/instruction-visibility.js');
  const hidden={id:'new',x:0,y:0,z:0,w:1,d:1};
  const wall={id:'wall',x:1,y:0,z:0,w:2,d:4};
  const cap={id:'cap',x:1,y:1,z:0,w:2,d:4};
  const view=chooseInstructionView({visibleBricks:[hidden,wall,cap],highlightedIds:['new']});
  assert.equal(view.visibleHighlightBrickCount,1);
  assert.equal(view.truncated,false);
  assert.equal(chooseInstructionView({visibleBricks:[hidden],highlightedIds:['new']}).turned,false);
});

test('camera planning holds a useful view across an easy step between two occluded steps',async()=>{
  const {chooseInstructionSequence}=await import('../src/instruction-visibility.js');
  const hidden=brick('hidden',0,0,0),blocker=brick('blocker',-1,1,-3,4,4);
  const plan={bricks:[hidden,blocker],steps:[
    {id:'a',moduleId:'m',visibleBrickIds:['hidden','blocker'],highlightBrickIds:['hidden']},
    {id:'b',moduleId:'m',visibleBrickIds:['hidden','blocker'],highlightBrickIds:['blocker']},
    {id:'c',moduleId:'m',visibleBrickIds:['hidden','blocker'],highlightBrickIds:['hidden']},
  ]};
  const views=chooseInstructionSequence(plan);
  assert.equal(views.get('a').azimuth,views.get('b').azimuth);
  assert.equal(views.get('b').azimuth,views.get('c').azimuth);
  assert.equal(views.get('b').turned,false);assert.equal(views.get('c').turned,false);
  for(const view of views.values()) assert.equal(view.passes,true);
});

test('shared attachment exposes its new copy while other joins keep their camera',async()=>{
  const {chooseInstructionSequence}=await import('../src/instruction-visibility.js');
  const hidden=brick('panel',0,0,0),blocker=brick('body',-1,1,-3,4,4);
  const join={kind:'join',moduleId:'panel',insertionDirection:'down',visibleBrickIds:['panel','body'],highlightBrickIds:['panel']};
  const plan={bricks:[hidden,blocker],modules:[{id:'panel',sharedHandledRecipe:{familyId:'pair'}}],steps:[
    {...join,id:'ordinary'},
    {...join,id:'second-copy',highlightBrickIds:['body']},
    {...join,id:'exploded',joinContext:{kind:'work-surface'}},
    {...join,id:'nested',nestedRecipe:{id:'recipe'}},
    {...join,id:'under',insertionDirection:'up'},
    {...join,id:'unchanged',moduleId:'other'},
  ]};
  const views=chooseInstructionSequence(plan);
  assert.equal(views.get('ordinary').passes,true);
  assert.equal(views.get('ordinary').turned,true);
  assert.equal(views.get('ordinary').visibleHighlightBrickCount,1);
  assert.equal(views.get('second-copy').azimuth,Math.PI*.75);
  assert.equal(views.get('second-copy').turned,true);
  assert.deepEqual([...views.keys()],['ordinary','second-copy']);
});
