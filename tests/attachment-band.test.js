import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { attachmentBandEvidence, attachmentBandRejections, remapAttachmentBand } from '../src/attachment-band.js';
import { repairAttachmentInterfaces } from '../src/attachment-repair.js';
import { inspectConstruction } from '../src/construction.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { packingProfile, unresolvedCells } from '../src/refine-construction.js';

const brick = (x, y, z, w = 1, d = 1, color = 'blue') => ({ x, y, z, w, d, color });
const keyOf = ({ x, y, z, w, d, color }) => `${x},${y},${z}:${w}x${d}:${color}`;

function transformBrick(source, { turns = 0, dx = 0, dz = 0, colors = {} } = {}) {
  let item = { ...source };
  for (let turn = 0; turn < turns; turn += 1) item = {
    ...item, x: -item.z - item.d, z: item.x, w: item.d, d: item.w,
  };
  return { ...item, x: item.x + dx, z: item.z + dz, color: colors[item.color] ?? item.color };
}

function preparedBand(bricks) {
  const brickModel = { version: 1, kind: 'bricks', bricks };
  const baseline = createAssemblyPlan({ brickModel });
  const bandIds = baseline.bricks.filter(({ y }) => y === 1 || y === 2).map(({ id }) => id);
  const assemblyPlan = createAssemblyPlan({
    brickModel, workSurfaceBrickIds: bandIds, workSurfaceOrder: 'rectangular-layers',
    preferLocalProgress: true, preferLocalFoundations: true,
  });
  return prepareAssemblyGuide({ brickModel, assemblyPlan, diagnostics: { checks: {}, stats: {} }, metrics: { conversionMs: 0 } });
}

function models(transform = {}) {
  const original = [
    brick(0, 0, 0, 4, 1, 'black'),
    brick(0, 1, 0, 2, 1, 'lightGray'), brick(2, 1, 0, 2, 1, 'lightGray'),
    brick(0, 2, 0, 1, 1, 'lightGray'), brick(1, 2, 0, 3, 1, 'lightGray'),
  ].map(item => transformBrick(item, transform));
  const changed = [
    original[0], original[1], transformBrick(brick(2, 1, 0, 3, 1, 'lightGray'), transform),
    original[3], transformBrick(brick(1, 2, 0, 4, 1, 'lightGray'), transform),
  ];
  const proposal = { before: [original[2], original[4]], after: [changed[2], changed[4]] };
  const addedCells = changed.slice(2, 5).flatMap(item => {
    const old = new Set(original.flatMap(source => {
      const cells = [];
      for (let x = source.x; x < source.x + source.w; x += 1) for (let z = source.z; z < source.z + source.d; z += 1) cells.push(`${x},${source.y},${z}`);
      return cells;
    }));
    const cells = [];
    for (let x = item.x; x < item.x + item.w; x += 1) for (let z = item.z; z < item.z + item.d; z += 1) {
      if (!old.has(`${x},${item.y},${z}`)) cells.push({ x, y: item.y, z, color: item.color });
    }
    return cells;
  });
  return { original, changed, proposal, addedCells };
}

function candidateFrom(before, bricks, proposal) {
  const mapping = remapAttachmentBand(before, proposal);
  const brickModel = { ...before.brickModel, bricks };
  const assemblyPlan = createAssemblyPlan({
    brickModel, workSurfaceBrickIds: mapping.workSurfaceBrickIds, workSurfaceOrder: mapping.workSurfaceOrder,
    preferLocalProgress: true, preferLocalFoundations: true,
  });
  return { mapping, candidate: prepareAssemblyGuide({ ...before, brickModel, assemblyPlan }) };
}

test('remaps a regular two-course edge patch while preserving its table build and physical join', () => {
  for (let turns = 0; turns < 4; turns += 1) {
    const source = models({ turns, dx: 20, dz: 20, colors: { black: turns % 2 ? 'red' : 'black', lightGray: turns % 2 ? 'tan' : 'lightGray' } });
    const before = preparedBand(source.original);
    const snapshot = structuredClone(before);
    const { mapping, candidate } = candidateFrom(before, source.changed, source.proposal);
    const oldBand = before.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
    const newBand = candidate.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
    const evidence = attachmentBandEvidence(before, candidate);

    assert.equal(mapping.changed, true);
    assert.equal(mapping.workSurfaceOrder, 'rectangular-layers');
    assert.deepEqual(new Set(mapping.workSurfaceBrickIds), new Set(newBand.brickIds));
    assert.deepEqual(oldBand.buildContext, newBand.buildContext);
    assert.deepEqual(attachmentBandRejections(before, candidate, source.addedCells), []);
    assert.deepEqual(evidence.after.supports, evidence.before.supports, 'support IDs and exact physical contact cells stay fixed');
    assert.ok(evidence.after.projectedGrouping.rectangleEmptyCellCount <= evidence.before.projectedGrouping.rectangleEmptyCellCount);
    assert.ok(evidence.after.projectedGrouping.rectangularCoverageRatio >= evidence.before.projectedGrouping.rectangularCoverageRatio);
    assert.equal(evidence.after.grouping.mixedCourseDiagramCount, 0);
    assert.equal(evidence.after.grouping.courseReturnCount, 0);
    assert.equal(evidence.after.handling.canonical.finalComponentCount, 1);
    assert.deepEqual(before, snapshot, 'remapping and evidence collection are immutable');
  }
});

test('remapping rejects mixed band boundaries and established support replacement', () => {
  const source = models();
  const before = preparedBand(source.original);
  assert.throws(() => remapAttachmentBand(before, {
    before: [source.original[0], source.original[2]], after: [source.changed[2]],
  }), /crosses the selected band boundary/);
  assert.throws(() => remapAttachmentBand(before, {
    before: [source.original[0]], after: [{ ...source.original[0], w: 3 }],
  }), /independent supports/);
});

test('rejects lost or undeclared band cells and changed physical contacts even when contact count matches', () => {
  const source = models();
  const before = preparedBand(source.original);
  const { candidate } = candidateFrom(before, source.changed, source.proposal);

  const lostBand = structuredClone(candidate);
  lostBand.assemblyPlan.modules = lostBand.assemblyPlan.modules.filter(module => module.buildContext?.kind !== 'work-surface');
  assert.ok(attachmentBandRejections(before, lostBand, source.addedCells).includes('The selected work-surface band was lost'));

  assert.ok(attachmentBandRejections(before, candidate, source.addedCells.slice(0, 1))
    .includes('Band ownership changed beyond the declared patch'));

  const changedContact = structuredClone(candidate);
  const band = changedContact.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
  const join = changedContact.assemblyPlan.steps.find(step => step.moduleId === band.id && step.kind === 'join');
  const contact = join.joinContext.supportGroups[0].contacts[0];
  contact.bandBrickId = band.brickIds.find(id => id !== contact.bandBrickId);
  assert.equal(join.joinContext.supportGroups.flatMap(group => group.contacts).length,
    candidate.assemblyPlan.steps.find(step => step.kind === 'join').joinContext.supportGroups.flatMap(group => group.contacts).length);
  assert.ok(attachmentBandRejections(before, changedContact, source.addedCells)
    .includes('The downward join or its physical support contacts changed'));
});

test('rejects a broken table build, changed policy, and course-return grouping', () => {
  const source = models();
  const before = preparedBand(source.original);
  const { candidate } = candidateFrom(before, source.changed, source.proposal);
  const band = candidate.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');

  const broken = structuredClone(candidate);
  const brokenStep = broken.assemblyPlan.steps.find(step => step.moduleId === band.id && step.kind === 'build');
  brokenStep.issues.push({ code: 'synthetic-failure', severity: 'error', message: 'Blocked.', brickIds: brokenStep.newBrickIds });
  assert.ok(attachmentBandRejections(before, broken, source.addedCells).includes('The revised band cannot be built on the table'));

  const changedPolicy = structuredClone(candidate);
  changedPolicy.assemblyPlan.modules.find(module => module.id === band.id).buildContext.orderPolicy = 'course-first';
  assert.ok(attachmentBandRejections(before, changedPolicy, source.addedCells).includes('The platform floor or ordering policy changed'));

  const returned = structuredClone(candidate);
  const steps = returned.instructionPlan.steps;
  const indexes = steps.map((step, index) => ({ step, index })).filter(({ step }) => step.moduleId === band.id && step.kind === 'build');
  if (indexes.length >= 3) {
    const reordered = [indexes[0].step, indexes.at(-1).step, indexes[1].step];
    indexes.slice(0, 3).forEach(({ index }, offset) => { steps[index] = reordered[offset]; });
    const reasons = attachmentBandRejections(before, returned, source.addedCells);
    assert.ok(reasons.includes('The platform mixes or revisits courses') || reasons.includes('Rectangular platform grouping became less coherent'));
  }
});

test('returns null when no work-surface exists and leaves outside patches unmapped', () => {
  const brickModel = { version: 1, kind: 'bricks', bricks: [brick(0, 0, 0)] };
  const plain = prepareAssemblyGuide({ brickModel, assemblyPlan: createAssemblyPlan({ brickModel }), metrics: { conversionMs: 0 } });
  assert.equal(remapAttachmentBand(plain, { before: [], after: [] }), null);

  const source = models();
  const before = preparedBand(source.original);
  const outside = { before: [source.original[0]], after: [source.original[0]] };
  assert.throws(() => remapAttachmentBand(before, outside), /independent supports/);
  assert.equal(keyOf(source.original[0]).startsWith('0,0,0'), true);
});

test('full repair selects a protected-band patch within the shared budget and check ceiling', () => {
  const scale = { mode: 'compact', studsPerVoxel: 1, coursesPerVoxel: 5 / 6, voxelMm: 8 };
  const base = [
    brick(0, 0, 0, 4, 1, 'black'), brick(4, 0, 0, 4, 1, 'black'), brick(8, 0, 0, 2, 1, 'black'),
    brick(0, 1, 0, 4, 1, 'lightGray'), brick(4, 1, 0, 4, 1, 'lightGray'), brick(8, 1, 0, 2, 1, 'lightGray'),
    brick(0, 2, 0, 3, 1, 'lightGray'), brick(3, 2, 0, 4, 1, 'lightGray'), brick(7, 2, 0, 3, 1, 'lightGray'),
    brick(10, 3, 0, 4, 1, 'red'),
  ];
  for (const turns of [0, 1]) {
    const bricks = base.map(item => transformBrick(item, { turns, dx: 20, dz: 20 }));
    const prepared = preparedBand(bricks);
    prepared.brickModel.meta = { scale };
    prepared.diagnostics = inspectConstruction(prepared.brickModel);
    prepared.metrics = { ...prepared.metrics, mappedCellCount: 200, structuralAddedMappedCellCount: 0 };
    const rawModel = { version: 1, kind: 'voxels', cells: bricks.flatMap(item => {
      const cells = [];
      for (let x = item.x; x < item.x + item.w; x += 1) for (let z = item.z; z < item.z + item.d; z += 1) {
        cells.push({ x, y: item.y, z, color: item.color });
      }
      return cells;
    }) };
    const rawSnapshot = structuredClone(rawModel);
    const beforeCells = packingProfile(prepared.brickModel.bricks).cells;
    const beforeBrickCount = prepared.brickModel.bricks.length;
    const repaired = repairAttachmentInterfaces(prepared, { rawModel, allowExtensions: true });
    const report = repaired.attachmentRefinement;
    const selected = report.accepted.filter(attempt => attempt.selected);

    assert.deepEqual(rawModel, rawSnapshot);
    assert.equal(report.selected, true);
    assert.deepEqual(selected.map(attempt => attempt.phase), ['patch']);
    assert.equal(selected[0].bandChanged, true);
    assert.ok(selected[0].bandMapping);
    assert.ok(selected[0].bandEvidence);
    assert.ok(report.after.unresolvedCellCount < report.before.unresolvedCellCount);
    assert.equal(report.after.unresolvedCellCount, 0);
    assert.ok(report.attempts.length <= report.limits.maxFullChecks);
    assert.ok(report.attempts.filter(attempt => attempt.phase === 'patch').length <= report.limits.maxPatchChecks);
    assert.ok(repaired.brickModel.bricks.length <= beforeBrickCount);
    const actualAdded = [...packingProfile(repaired.brickModel.bricks).cells]
      .filter(([key]) => !beforeCells.has(key)).map(([key, cell]) => ({ key, color: cell.color }));
    assert.deepEqual(actualAdded, report.addedCells.map(cell => ({ key: `${cell.x},${cell.y},${cell.z}`, color: cell.color })));
    assert.equal(report.addedCells.some(cell => unresolvedCells(repaired.assemblyPlan).has(`${cell.x},${cell.y},${cell.z}`)), false);
    const introduced = repaired.instructionPlan.steps.flatMap(step => step.newBrickIds);
    assert.equal(introduced.length, repaired.assemblyPlan.bricks.length);
    assert.equal(new Set(introduced).size, introduced.length);
    assert.equal(repaired.instructionPlan.stats.coverageComplete, true);
    assert.equal(repaired.guide.stats.coverageComplete, true);
    const band = repaired.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
    const join = repaired.assemblyPlan.steps.find(step => step.moduleId === band.id && step.kind === 'join');
    assert.ok(join);
    assert.equal(join.issues.some(issue => issue.severity === 'error'), false);
    assert.equal(join.joinContext.direction, 'down');
    assert.deepEqual(selected[0].bandEvidence.after.supports, selected[0].bandEvidence.before.supports);
  }
});
