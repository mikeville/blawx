import assert from 'node:assert/strict';
import test from 'node:test';
import { createGuideNumbering, formatGuideStepRange } from '../src/guide-numbering.js';

test('diagram numbers continue across sections while repeated recipes are numbered once', () => {
  const sections = [
    {
      id: 'wheels',
      repeatCount: 2,
      stepIds: ['wheel-a', 'wheel-b'],
      groups: [{ id: 'wheel-group', stepIds: ['wheel-a', 'wheel-b'] }],
      parts: [{ id: 'wheel-part', stepIds: ['wheel-a', 'wheel-b'] }],
    },
    {
      id: 'body',
      repeatCount: 1,
      stepIds: ['body-a', 'body-b', 'body-c'],
      groups: [
        { id: 'body-group-1', stepIds: ['body-a', 'body-b'] },
        { id: 'body-group-2', stepIds: ['body-c'] },
      ],
      parts: [
        { id: 'body-part-1', stepIds: ['body-a', 'body-b'] },
        { id: 'body-part-2', stepIds: ['body-c'] },
      ],
    },
  ];

  const numbering = createGuideNumbering(sections);
  assert.deepEqual([...numbering.byStepId], [
    ['wheel-a', 1], ['wheel-b', 2],
    ['body-a', 3], ['body-b', 4], ['body-c', 5],
  ]);
  assert.equal(numbering.diagramCount, 5, 'the 2× wheel recipe does not duplicate diagram numbers');
  assert.deepEqual(numbering.sectionRanges.get('wheels'), { start: 1, end: 2 });
  assert.deepEqual(numbering.sectionRanges.get('body'), { start: 3, end: 5 });
  assert.equal(formatGuideStepRange(numbering.partRanges.get('body-part-1')), '3–4');
  assert.equal(formatGuideStepRange(numbering.partRanges.get('body-part-2')), '5');
});

test('numbering rejects group projections that reorder or duplicate dependency steps', () => {
  assert.throws(() => createGuideNumbering([{
    id: 'section-1',
    stepIds: ['step-1', 'step-2'],
    groups: [{ id: 'group-1', stepIds: ['step-2', 'step-1'] }],
  }]), /retain its step order/);
  assert.throws(() => createGuideNumbering([
    { id: 'section-1', stepIds: ['step-1'], groups: [{ id: 'group-1', stepIds: ['step-1'] }] },
    { id: 'section-2', stepIds: ['step-1'], groups: [{ id: 'group-2', stepIds: ['step-1'] }] },
  ]), /unique strings/);
});
