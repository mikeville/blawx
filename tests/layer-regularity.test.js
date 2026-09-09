import test from 'node:test';
import assert from 'node:assert/strict';

import { assessBandRegularity, assessLayerGrouping } from '../src/layer-regularity.js';

const brick = (id, x, y, z, w = 1, d = 1, color = 'red') => ({ id, x, y, z, w, d, color });

function tiledRectangle(course, width, depth, prefix, color = 'blue') {
  const result = [];
  for (let z = 0; z < depth; z += 2) for (let x = 0; x < width; x += 2) {
    result.push(brick(`${prefix}-${x}-${z}`, x, course, z, Math.min(2, width - x), Math.min(2, depth - z), color));
  }
  return result;
}

function planFor(bricks, steps) {
  return {
    version: 1,
    bricks,
    modules: [{ id: 'work', brickIds: bricks.map(({ id }) => id), buildContext: { kind: 'work-surface' } }],
    steps: steps.map((ids, index) => ({ id: `step-${index + 1}`, moduleId: 'work', newBrickIds: ids })),
  };
}

test('accepts consecutive solid rectangular layers with a common footprint', () => {
  const bricks = [
    ...tiledRectangle(3, 10, 6, 'lower', 'brown'),
    ...tiledRectangle(4, 10, 6, 'upper', 'tan'),
  ];
  const before = structuredClone(bricks);
  const result = assessBandRegularity(bricks);

  assert.equal(result.eligible, true);
  assert.equal(result.minFillRatio, 1);
  assert.equal(result.commonFootprintRatio, 1);
  assert.deepEqual(result.layers.map(({ course, area, bounds, fillRatio }) => ({ course, area, bounds, fillRatio })), [
    { course: 3, area: 60, bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 6, width: 10, depth: 6 }, fillRatio: 1 },
    { course: 4, area: 60, bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 6, width: 10, depth: 6 }, fillRatio: 1 },
  ]);
  assert.equal(result.limits.minLayerFillRatio, 0.9);
  assert.equal(result.limits.minCommonFootprintRatio, 0.9);
  assert.deepEqual(bricks, before);
});

test('rejects notched, organic, hollow, shifted, and nonconsecutive bands for their measured reason', () => {
  const full4 = tiledRectangle(0, 4, 4, 'full');
  const notchedLayer = full4.filter(({ id }) => !id.endsWith('2-2'))
    .concat(brick('notch-fill-one', 2, 0, 2), brick('notch-fill-two', 3, 0, 2));
  // Remove two cells from a 4x4 rectangle: 14 / 16 is below the threshold.
  const notched = [
    ...notchedLayer,
    ...notchedLayer.map((item) => ({ ...item, id: `top-${item.id}`, y: 1 })),
  ];
  const organicLayer = [brick('o1', 0, 0, 0, 3, 1), brick('o2', 0, 0, 1, 1, 2)];
  const organic = [...organicLayer, ...organicLayer.map((item) => ({ ...item, id: `top-${item.id}`, y: 1 }))];
  const ringLayer = [
    brick('north', 0, 0, 0, 5, 1), brick('south', 0, 0, 4, 5, 1),
    brick('west', 0, 0, 1, 1, 3), brick('east', 4, 0, 1, 1, 3),
  ];
  const hollow = [...ringLayer, ...ringLayer.map((item) => ({ ...item, id: `top-${item.id}`, y: 1 }))];
  const shifted = [
    brick('base', 0, 0, 0, 10, 10),
    brick('shifted', 1, 1, 0, 10, 10),
  ];
  const nonconsecutive = [brick('low', 0, 0, 0, 2, 2), brick('high', 0, 2, 0, 2, 2)];

  for (const candidate of [notched, organic, hollow]) {
    const result = assessBandRegularity(candidate);
    assert.equal(result.eligible, false);
    assert.ok(result.minFillRatio < 0.9);
    assert.equal(result.rejectionReasons.some((reason) => reason.includes('layer fills less')), true);
  }
  const shiftedResult = assessBandRegularity(shifted);
  assert.equal(shiftedResult.eligible, false);
  assert.equal(shiftedResult.minFillRatio, 1);
  assert.ok(shiftedResult.commonFootprintRatio < 0.9);
  assert.equal(shiftedResult.rejectionReasons.some((reason) => reason.includes('Common layer footprint')), true);
  const gapResult = assessBandRegularity(nonconsecutive);
  assert.equal(gapResult.eligible, false);
  assert.equal(gapResult.rejectionReasons.includes('Band courses must be consecutive'), true);
});

test('layer grouping rewards rectangles and exposes ragged, mixed-course, and returning diagrams', () => {
  const bricks = [
    brick('base', 0, 0, 0, 4, 2, 'brown'),
    brick('left', 0, 1, 0, 1, 1, 'tan'),
    brick('right', 2, 1, 0, 1, 1, 'tan'),
    brick('upper', 0, 2, 0, 2, 1, 'red'),
    brick('return', 3, 1, 1, 1, 1, 'white'),
  ];
  const clean = assessLayerGrouping(planFor(bricks, [
    ['base'], ['left'], ['right'], ['return'], ['upper'],
  ]), 'work');
  const raggedMixed = assessLayerGrouping(planFor(bricks, [
    ['base'], ['left', 'right'], ['upper', 'return'],
  ]), 'work');

  assert.equal(clean.buildDiagramCount, 5);
  assert.equal(clean.mixedCourseDiagramCount, 0);
  assert.equal(clean.rectangleEmptyCellCount, 0);
  assert.equal(clean.rectangularCoverageRatio, 1);
  assert.equal(clean.courseReturnCount, 0);

  assert.equal(raggedMixed.buildDiagramCount, 3);
  assert.equal(raggedMixed.mixedCourseDiagramCount, 1);
  assert.equal(raggedMixed.courseReturnCount, 0);
  assert.equal(raggedMixed.rectangleEmptyCellCount, 1);
  assert.equal(raggedMixed.rectangularCoverageRatio, 13 / 14);
  assert.deepEqual(raggedMixed.steps[1], {
    stepId: 'step-2', courses: [1], area: 2, boundingArea: 3, fillRatio: 2 / 3,
  });

  const returning = assessLayerGrouping(planFor(bricks, [
    ['base'], ['upper'], ['left', 'right', 'return'],
  ]), 'work');
  assert.equal(returning.courseReturnCount, 1);
});

test('partial line exposure distinguishes scattered rectangles from contiguous completed strips', () => {
  const bricks = [];
  for (let z = 0; z < 4; z += 1) for (let x = 0; x < 4; x += 1) {
    bricks.push(brick(`cell-${x}-${z}`, x, 2, z, 1, 1, (x + z) % 2 ? 'tan' : 'brown'));
  }
  const ids = (minX, maxX, minZ, maxZ) => bricks
    .filter(({ x, z }) => x >= minX && x < maxX && z >= minZ && z < maxZ)
    .map(({ id }) => id);
  const strips = assessLayerGrouping(planFor(bricks, [
    ids(0, 4, 0, 1), ids(0, 4, 1, 2), ids(0, 4, 2, 3), ids(0, 4, 3, 4),
  ]), 'work');
  const scattered = assessLayerGrouping(planFor(bricks, [
    ids(0, 2, 0, 2), ids(2, 4, 2, 4), ids(2, 4, 0, 2), ids(0, 2, 2, 4),
  ]), 'work');

  assert.equal(strips.rectangleEmptyCellCount, 0);
  assert.equal(scattered.rectangleEmptyCellCount, 0, 'every scattered group is also locally rectangular');
  assert.equal(strips.partialLineExposure, 0);
  assert.deepEqual(strips.partialLineExposureByCourse, [{
    course: 2,
    xLineExposure: 0,
    zLineExposure: 12,
    selectedOrientation: 'x',
    partialLineExposure: 0,
  }]);
  assert.equal(scattered.partialLineExposure, 8);
  assert.deepEqual(scattered.partialLineExposureByCourse, [{
    course: 2,
    xLineExposure: 8,
    zLineExposure: 8,
    selectedOrientation: 'x',
    partialLineExposure: 8,
  }]);
});

test('unfinished lower-course lines remain exposed across intervening upper-course diagrams', () => {
  const bricks = [
    brick('lower-first', 0, 1, 0),
    brick('lower-second', 1, 1, 0),
    brick('lower-third', 0, 1, 1),
    brick('lower-fourth', 1, 1, 1),
    brick('upper', 0, 2, 0, 2, 2),
  ];
  const grouped = assessLayerGrouping(planFor(bricks, [
    ['lower-first'], ['upper'], ['lower-second', 'lower-third', 'lower-fourth'],
  ]), 'work');

  assert.equal(grouped.partialLineExposure, 2);
  assert.deepEqual(grouped.partialLineExposureByCourse.map(({ course, partialLineExposure }) =>
    ({ course, partialLineExposure })), [
    { course: 1, partialLineExposure: 2 },
    { course: 2, partialLineExposure: 0 },
  ]);
});

test('regularity and grouping ratios ignore IDs, palettes, translations, and quarter turns', () => {
  const sourceBricks = [
    ...tiledRectangle(2, 6, 4, 'lower', 'blue'),
    ...tiledRectangle(3, 6, 4, 'upper', 'yellow'),
  ];
  const sourceSteps = [sourceBricks.filter(({ y }) => y === 2).map(({ id }) => id), sourceBricks.filter(({ y }) => y === 3).map(({ id }) => id)];
  const rename = new Map(sourceBricks.map(({ id }, index) => [id, `moved-${index}`]));
  const moved = sourceBricks.map((item, index) => ({
    ...item,
    id: rename.get(item.id),
    x: 17 - item.z - item.d,
    z: -11 + item.x,
    w: item.d,
    d: item.w,
    color: index % 2 ? 'green' : 'white',
  }));
  const movedSteps = sourceSteps.map((ids) => ids.map((id) => rename.get(id)));
  const regular = assessBandRegularity(sourceBricks);
  const movedRegular = assessBandRegularity(moved);

  assert.equal(movedRegular.eligible, regular.eligible);
  assert.equal(movedRegular.minFillRatio, regular.minFillRatio);
  assert.equal(movedRegular.commonFootprintRatio, regular.commonFootprintRatio);
  assert.deepEqual(movedRegular.layers.map(({ area, fillRatio }) => ({ area, fillRatio })),
    regular.layers.map(({ area, fillRatio }) => ({ area, fillRatio })));
  const grouped = assessLayerGrouping(planFor(sourceBricks, sourceSteps), 'work');
  const movedGrouped = assessLayerGrouping(planFor(moved, movedSteps), 'work');
  assert.deepEqual(
    (({ buildDiagramCount, mixedCourseDiagramCount, courseReturnCount, rectangleEmptyCellCount, rectangularCoverageRatio,
      partialLineExposure }) =>
      ({ buildDiagramCount, mixedCourseDiagramCount, courseReturnCount, rectangleEmptyCellCount, rectangularCoverageRatio,
        partialLineExposure }))(movedGrouped),
    (({ buildDiagramCount, mixedCourseDiagramCount, courseReturnCount, rectangleEmptyCellCount, rectangularCoverageRatio,
      partialLineExposure }) =>
      ({ buildDiagramCount, mixedCourseDiagramCount, courseReturnCount, rectangleEmptyCellCount, rectangularCoverageRatio,
        partialLineExposure }))(grouped),
  );
  assert.deepEqual(movedGrouped.partialLineExposureByCourse.map(({ xLineExposure, zLineExposure, partialLineExposure }) =>
    ({ xLineExposure: zLineExposure, zLineExposure: xLineExposure, partialLineExposure })),
  grouped.partialLineExposureByCourse.map(({ xLineExposure, zLineExposure, partialLineExposure }) =>
    ({ xLineExposure, zLineExposure, partialLineExposure })));
});

test('malformed, overlapping, duplicate, unknown, and out-of-bounds inputs fail clearly', () => {
  assert.throws(() => assessBandRegularity(null), /must be an array/);
  assert.throws(() => assessBandRegularity([
    brick('a', 0, 0, 0, 2, 2), brick('b', 1, 0, 1, 2, 2),
  ]), /overlapping brick footprints/);
  assert.throws(() => assessBandRegularity([
    brick('same', 0, 0, 0), brick('same', 0, 1, 0),
  ]), /IDs must be unique/);
  assert.throws(() => assessBandRegularity([brick('wide', 0, 0, 0, 33, 1)]), /horizontal span limit/);

  const unknown = planFor([brick('known', 0, 0, 0)], [['missing']]);
  assert.throws(() => assessLayerGrouping(unknown, 'work'), /unknown brick missing/);
  const duplicate = planFor([brick('known', 0, 0, 0)], [['known'], ['known']]);
  assert.throws(() => assessLayerGrouping(duplicate, 'work'), /introduced more than once/);
  assert.throws(() => assessLayerGrouping(planFor([brick('known', 0, 0, 0)], [['known']]), 'missing'), /Unknown module/);
});
