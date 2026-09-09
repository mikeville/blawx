import test from 'node:test';
import assert from 'node:assert/strict';
import { createChapterDiagramData, guideRangeMarkup, resolveBookletInitialState } from '../src/assembly-booklet-presentation.js';
import { bookletViewerOptions } from '../src/assembly-booklet-renderer.js';

test('chapter presentation preserves group order, source ids, warnings, and join context', () => {
  const joinContext = { direction: 'down', supportGroups: [{ id: 'support-a' }] };
  const plan = { steps: [
    { id:'step-a',kind:'place',visibleBrickIds:['a'],highlightBrickIds:['a'],insertionDirection:'down',issues:[] },
    { id:'step-b',kind:'join',visibleBrickIds:['a','b'],highlightBrickIds:['b'],insertionDirection:'down',joinContext,issues:[] },
    { id:'step-c',kind:'place',visibleBrickIds:['a','b','c'],highlightBrickIds:['c'],insertionDirection:'up',issues:[{message:'hold'}] },
  ] };
  const section = {
    groups:[{id:'group-1',stepIds:['step-a','step-b']},{id:'group-2',stepIds:['step-c']}],
    parts:[{id:'part-1',groupIds:['group-1']},{id:'part-2',groupIds:['group-2']}],
  };
  const numbering = { byStepId:new Map([['step-a',12],['step-b',13],['step-c',14]]), partRanges:new Map([['part-1',{start:12,end:13}],['part-2',{start:14,end:14}]]) };
  const result = createChapterDiagramData(section,plan,numbering);
  assert.deepEqual(result.specs.map(spec=>spec.stepId),['step-a','step-b','step-c']);
  assert.equal(result.specs[1].joinContext,joinContext);
  assert.equal(result.specs[2].unresolved,true);
  assert.deepEqual(result.parts.map(part=>part.figures.map(spec=>spec.stepId)),[['step-a','step-b'],['step-c']]);
  assert.deepEqual(result.parts.map(part=>part.range),[{start:12,end:13},{start:14,end:14}]);
  const visibleModel = { kind:'bricks', bricks:[] };
  const options = bookletViewerOptions(result.specs[1], visibleModel);
  assert.equal(options.joinContext, joinContext);
  assert.equal(options.frameModel, visibleModel);
  assert.deepEqual([...options.highlightIds], ['b']);
});

test('range markup keeps one number and isolates an escaped range dash', () => {
  assert.equal(guideRangeMarkup({start:7,end:7}),'7');
  assert.equal(guideRangeMarkup({start:'<12',end:'22&'}),'&lt;12<span class="manual-range-dash">–</span>22&amp;');
});

test('fresh readers open the first chapter while restored closed readers stay closed', () => {
  assert.deepEqual(resolveBookletInitialState(null, 4), { partsOpen:false, openChapterIndex:0 });
  assert.deepEqual(resolveBookletInitialState({ partsOpen:false, anchorStepId:'step-a' }, 4), { partsOpen:false, openChapterIndex:-1 });
  assert.deepEqual(resolveBookletInitialState({ partsOpen:true, openChapterIndex:2 }, 4), { partsOpen:true, openChapterIndex:2 });
});
