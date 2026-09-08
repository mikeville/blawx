import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyJoinPreview } from '../src/assembly-join-preview.js';
import { brickPreviewData } from '../src/brick-preview.js';

const brick = (id, x, y, z, w = 1, d = 1, color = 'red') => ({ id, x, y, z, w, d, color });

function fixture() {
  const model = {
    version: 1,
    kind: 'bricks',
    meta: { scale: { studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 } },
    bricks: [
      brick('left-support', 0, 0, 0, 1, 1, 'red'),
      brick('right-support', 2, 0, 0, 1, 1, 'red'),
      brick('left-foot', 0, 1, 0, 1, 1, 'blue'),
      brick('center-foot', 1, 1, 0, 1, 1, 'yellow'),
      brick('right-foot', 2, 1, 0, 1, 1, 'blue'),
      brick('bridge', 0, 2, 0, 3, 1, 'orange'),
    ],
  };
  const highlightIds = new Set(['left-foot', 'center-foot', 'right-foot', 'bridge']);
  const joinContext = {
    direction: 'down',
    requiresAlignment: true,
    supportGroups: [
      {
        brickIds: ['left-support'],
        contacts: [{ supportBrickId: 'left-support', bandBrickId: 'left-foot', studs: 1 }],
      },
      {
        brickIds: ['right-support'],
        contacts: [{ supportBrickId: 'right-support', bandBrickId: 'right-foot', studs: 1 }],
      },
    ],
  };
  return { model, highlightIds, joinContext };
}

test('lifts one connected assembly by a common integral course offset without mutating parts or colors', () => {
  const input = fixture();
  const before = structuredClone(input.model);
  const preview = createAssemblyJoinPreview(input);

  assert.equal(preview.active, true);
  assert.equal(Number.isSafeInteger(preview.liftCourses), true);
  assert.equal(preview.liftCourses, 3);
  assert.notStrictEqual(preview.model, input.model);
  assert.deepEqual(input.model, before);
  assert.deepEqual(preview.model.meta, before.meta);
  assert.equal(preview.model.bricks.length, before.bricks.length);
  for (const source of before.bricks) {
    const rendered = preview.model.bricks.find(({ id }) => id === source.id);
    assert.equal(rendered.color, source.color);
    assert.deepEqual(
      (({ id, x, z, w, d, color }) => ({ id, x, z, w, d, color }))(rendered),
      (({ id, x, z, w, d, color }) => ({ id, x, z, w, d, color }))(source),
    );
    assert.equal(rendered.y, source.y + (input.highlightIds.has(source.id) ? preview.liftCourses : 0));
  }
});

test('maps one dark-arrow path to each exact support group and exposes every contacted support stud', () => {
  const input = fixture();
  const preview = createAssemblyJoinPreview(input);

  assert.equal(preview.arrows.length, 2);
  assert.deepEqual(preview.arrows.map(({ supportGroupIndex, studs }) => ({ supportGroupIndex, studs })), [
    { supportGroupIndex: 0, studs: 1 },
    { supportGroupIndex: 1, studs: 1 },
  ]);
  assert.deepEqual(preview.arrows.map(({ end }) => end.x), [0.5, 2.5]);
  assert.equal(preview.arrows.every(({ start, end }) => start.y > end.y && start.x === end.x && start.z === end.z), true);
  assert.deepEqual(preview.targetStuds.map(({ supportBrickId, bandBrickId, x, z }) => (
    { supportBrickId, bandBrickId, x, z }
  )), [
    { supportBrickId: 'left-support', bandBrickId: 'left-foot', x: 0, z: 0 },
    { supportBrickId: 'right-support', bandBrickId: 'right-foot', x: 2, z: 0 },
  ]);

  const visibleStuds = brickPreviewData(preview.model).studs;
  for (const target of preview.targetStuds) {
    assert.equal(visibleStuds.some((stud) => stud.id === target.supportBrickId
      && stud.x === target.x + 0.5 && stud.z === target.z + 0.5), true);
  }
});

test('anchors an asymmetric support-group arrow to a real contacted stud instead of its empty centroid', () => {
  const model = {
    version: 1,
    kind: 'bricks',
    bricks: [
      brick('ground', 0, 0, 0, 3, 1),
      brick('left-support', 0, 1, 0),
      brick('right-support', 2, 1, 0),
      brick('left-foot', 0, 2, 0),
      brick('center-foot', 1, 2, 0),
      brick('right-foot', 2, 2, 0),
      brick('bridge', 0, 3, 0, 3, 1),
    ],
  };
  const preview = createAssemblyJoinPreview({
    model,
    highlightIds: new Set(['left-foot', 'center-foot', 'right-foot', 'bridge']),
    joinContext: {
      direction: 'down',
      requiresAlignment: false,
      supportGroups: [{
        brickIds: ['ground', 'left-support', 'right-support'],
        contacts: [
          { supportBrickId: 'left-support', bandBrickId: 'left-foot', studs: 1 },
          { supportBrickId: 'right-support', bandBrickId: 'right-foot', studs: 1 },
        ],
      }],
    },
  });

  assert.equal(preview.active, true);
  assert.equal(preview.arrows[0].studs, 2);
  assert.equal(preview.arrows[0].end.x, 0.5, 'equal-distance targets use stable x/z/ID ordering');
  assert.equal(preview.arrows[0].targetStud.supportBrickId, 'left-support');
  assert.equal(preview.targetStuds.some(({ x }) => x + 0.5 === preview.arrows[0].end.x), true);
  assert.notEqual(preview.arrows[0].end.x, 1.5, 'the geometric centroid is an unsupported hole');
});

test('falls back unchanged for absent, inconsistent, or disconnected join metadata', () => {
  const input = fixture();
  const cases = [
    { ...input, joinContext: null },
    { ...input, joinContext: { ...input.joinContext, direction: 'up' } },
    { ...input, joinContext: { ...input.joinContext, requiresAlignment: false } },
    {
      ...input,
      joinContext: {
        ...input.joinContext,
        supportGroups: [{
          brickIds: ['left-support'],
          contacts: [{ supportBrickId: 'left-support', bandBrickId: 'left-foot', studs: 2 }],
        }],
        requiresAlignment: false,
      },
    },
    { ...input, highlightIds: new Set(['left-foot', 'right-foot']) },
  ];
  for (const entry of cases) {
    const preview = createAssemblyJoinPreview(entry);
    assert.equal(preview.active, false);
    assert.strictEqual(preview.model, input.model);
    assert.equal(preview.liftCourses, 0);
    assert.deepEqual(preview.arrows, []);
  }
});
