import test from 'node:test';
import assert from 'node:assert/strict';
import {createAssemblyPlan} from '../src/assembly.js';
import {recipeBrickId, rotateRecipeBrick} from '../src/assembly-recipes.js';

function fixture(turn = 0, premature = false, blocked = false) {
  const part = (x, y, w = 1) => ({x, y, z: 0, w, d: 1, color: 'blue'});
  const bricks = [
    part(0, 0), part(4, 0),
    part(0, 1), part(3, 1, 2),
    part(0, 2), part(4, 2),
    part(0, 3, 3), part(3, 3, 2),
    part(2, 4, 2), part(1, 2),
    ...(blocked ? [part(1, 1)] : []),
  ].map(b => ({...rotateRecipeBrick(b, turn), color: turn % 2 ? 'green' : b.color}));
  const ids = bricks.map(recipeBrickId);
  const floor = [ids[2], ids[3], ...(blocked ? [ids[10]] : [])];
  const groups = [floor, ids.slice(4, 6), [ids[6]], [ids[7]],
    ...(premature ? [[ids[9]], [ids[8]]] : [[ids[8]], [ids[9]]])];
  return {
    brickModel: {version: 1, kind: 'bricks', bricks},
    moduleReplay: [
      {id: 'feet', label: 'Feet', kind: 'grounded', brickIds: ids.slice(0, 2), brickOrder: ids.slice(0, 2)},
      {id: 'platform', label: 'Platform', kind: 'detail', groupType: 'work-surface',
        buildContext: {kind: 'work-surface', floorY: 1},
        brickIds: groups.flat(), brickOrder: groups.flat(), placementGroups: groups, actionOrder: true},
    ],
    allowUnderAttachments: true, allowWorkSurfaceUnderAttachments: true,
  };
}

for (let turn = 0; turn < 4; turn++) test(`a scheduled table bridge can precede bonding, but lifting follows it, rotation ${turn}`, () => {
  const options = fixture(turn), snapshot = structuredClone(options);
  const plan = createAssemblyPlan(options);
  assert.deepEqual(options, snapshot);
  assert.equal(plan.stats.unresolvedBrickCount, 0);
  assert.equal(plan.stats.validJoinCount, 1);
  const steps = plan.steps.filter(s => s.moduleId === 'platform' && s.newBrickIds.length);
  assert.deepEqual(steps.map(s => s.newBrickIds), options.moduleReplay[1].placementGroups);
  assert.equal(steps.at(-1).insertionDirection, 'up');
  assert.ok(steps.slice(0, -1).every(s => s.insertionDirection !== 'up'));
  assert.equal(new Set(plan.steps.flatMap(s => s.newBrickIds)).size, plan.bricks.length);
});

test('a prescribed underside insertion cannot lift two still-separate table assemblies', () => {
  assert.throws(() => createAssemblyPlan(fixture(0, true)), /prerequisites/);
});

test('a later bond does not permit an underside insertion through an occupied lower column', () => {
  const options = fixture(0, false, true);
  let plan;
  try { plan = createAssemblyPlan(options); }
  catch (error) { assert.match(error.message, /prerequisites/); return; }
  assert.ok(plan.stats.unresolvedBrickCount > 0);
  const target = recipeBrickId(options.brickModel.bricks[9]);
  assert.ok(!plan.steps.some(s => s.kind === 'build' && s.insertionDirection === 'up' && s.newBrickIds.includes(target)));
});
