import test from 'node:test';
import assert from 'node:assert/strict';

import { createAssemblyPlan } from '../src/assembly.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { planSubassemblies, revisitSubassembliesAfterAttachment } from '../src/plan-subassemblies.js';
import { unresolvedCells } from '../src/refine-construction.js';

const brick = (x, y, z, w = 1, d = 1, color = 'red') => ({ x, y, z, w, d, color });

function rotateBrick(item, quarterTurns) {
  const turn = ((quarterTurns % 4) + 4) % 4;
  if (turn === 0) return { ...item };
  if (turn === 1) return { ...item, x: -item.z - item.d, z: item.x, w: item.d, d: item.w };
  if (turn === 2) return { ...item, x: -item.x - item.w, z: -item.z - item.d };
  return { ...item, x: item.z, z: -item.x - item.w, w: item.d, d: item.w };
}

function transformBricks(bricks, { turns = 0, dx = 0, dz = 0, colors = {} } = {}) {
  return bricks.map((item) => {
    const rotated = rotateBrick(item, turns);
    return { ...rotated, x: rotated.x + dx, z: rotated.z + dz, color: colors[item.color] ?? item.color };
  });
}

function prepared(bricks, conversionMs = 7) {
  const brickModel = { version: 1, kind: 'bricks', bricks };
  return prepareAssemblyGuide({
    brickModel,
    assemblyPlan: createAssemblyPlan({ brickModel }),
    diagnostics: {},
    metrics: { conversionMs, stageTiming: { priorMs: conversionMs } },
  });
}

function bridge() {
  // The top 1x3 closes the downward path to the center brick. On a table, the
  // four upper bricks form a flat-footed bridge that can align onto two
  // independently grounded supports.
  return [
    brick(0, 0, 0, 1, 1, 'red'),
    brick(2, 0, 0, 1, 1, 'red'),
    brick(0, 1, 0, 1, 1, 'blue'),
    brick(1, 1, 0, 1, 1, 'yellow'),
    brick(2, 1, 0, 1, 1, 'blue'),
    brick(0, 2, 0, 3, 1, 'orange'),
  ];
}

test('selects a flat work-surface bridge across rotations, translations, and palettes without changing geometry', () => {
  const variants = [];
  const palettes = [
    {},
    { red: 'white', blue: 'green', yellow: 'brown', orange: 'lightGray' },
    { red: 'black', blue: 'tan', yellow: 'red', orange: 'blue' },
  ];
  for (let turns = 0; turns < 4; turns += 1) {
    variants.push({ turns, dx: 13 - turns * 3, dz: -9 + turns * 5, colors: palettes[turns % palettes.length] });
  }

  for (const transform of variants) {
    const source = prepared(transformBricks(bridge(), transform));
    const sourceSnapshot = structuredClone(source.brickModel);
    const beforeConversionMs = source.metrics.conversionMs;
    const result = planSubassemblies(source);
    const report = result.subassemblyRefinement;

    assert.equal(report.selected, true, JSON.stringify(transform));
    assert.equal(report.evaluatedCount >= 1 && report.evaluatedCount <= 8, true);
    assert.deepEqual(report.attempts.filter(({ selected }) => selected).map(({ proposal }) => proposal.id), [report.selectedProposalId]);
    assert.equal(report.selectedBrickIds.length, 4);
    assert.equal(report.before.rootFailureCount, 1);
    assert.equal(report.after.rootFailureCount, 0);
    assert.equal(report.before.unresolvedOccupiedCellCount > report.after.unresolvedOccupiedCellCount, true);
    assert.equal(report.after.unresolvedOccupiedCellCount, 0);
    assert.equal(result.assemblyPlan.stats.temporaryHoldStepCount, 0);
    assert.equal(result.assemblyPlan.stats.upwardInsertionBrickCount, 0);
    assert.equal(result.assemblyPlan.stats.coverageComplete, true);
    assert.equal(result.instructionPlan.stats.coverageComplete, true);
    assert.equal(result.guide.stats.coverageComplete, true);
    assert.deepEqual(result.brickModel, sourceSnapshot);
    assert.deepEqual(source.brickModel, sourceSnapshot, 'the input result is immutable');
    assert.deepEqual(result.assemblyPlan.inventory, source.assemblyPlan.inventory);
    assert.deepEqual(result.assemblyPlan.bricks, source.assemblyPlan.bricks);

    const workSurface = result.assemblyPlan.modules.find(({ buildContext }) => buildContext?.kind === 'work-surface');
    assert.ok(workSurface);
    assert.deepEqual(new Set(workSurface.brickIds), new Set(report.selectedBrickIds));
    const moduleSteps = result.assemblyPlan.steps.filter(({ moduleId }) => moduleId === workSurface.id);
    assert.equal(moduleSteps.some((step) => step.kind === 'unresolved' && step.newBrickIds.length), false);
    const join = moduleSteps.find((step) => step.kind === 'join');
    assert.ok(join);
    assert.equal(join.newBrickIds.length, 0);
    assert.equal(join.joinContext.direction, 'down');
    assert.equal(join.joinContext.supportGroups.length, 2);
    assert.equal(join.joinContext.requiresAlignment, true);
    assert.equal(join.joinContext.supportGroups.every(({ contacts }) => contacts.length === 1), true);
    assert.equal(result.metrics.conversionMs, beforeConversionMs + report.stageMs);
    assert.equal(result.metrics.stageTiming.subassemblyMs, report.stageMs);
  }
});

test('leaves an already resolved construction complete and records a bounded no-op stage', () => {
  const source = prepared([
    brick(0, 0, 0, 2, 2, 'blue'),
    brick(0, 1, 0, 2, 2, 'yellow'),
  ]);
  const beforePlan = structuredClone(source.assemblyPlan);
  const result = planSubassemblies(source);

  assert.equal(result.subassemblyRefinement.selected, false);
  assert.equal(result.subassemblyRefinement.proposalCount, 0);
  assert.equal(result.subassemblyRefinement.evaluatedCount, 0);
  assert.deepEqual(result.assemblyPlan, beforePlan);
  assert.deepEqual(result.subassemblyRefinement.before, result.subassemblyRefinement.after);
  assert.equal(result.metrics.stageTiming.subassemblyMs, result.subassemblyRefinement.stageMs);
});

test('reports the actual displayed diagram count after repeat recipes collapse', () => {
  const bricks = [];
  for (const x of [0, 5]) for (let y = 0; y < 13; y += 1) bricks.push(brick(x, y, 0, 1, 1, 'green'));
  const result = planSubassemblies(prepared(bricks));

  assert.equal(result.subassemblyRefinement.selected, false);
  assert.equal(result.subassemblyRefinement.before.instructionDiagramCount, 10);
  assert.equal(result.subassemblyRefinement.before.displayedDiagramCount, 5);
  assert.equal(result.subassemblyRefinement.after.displayedDiagramCount, 5);
});

test('rejects a band that would require simultaneous alignment onto more than four grounded supports', () => {
  const bricks = [];
  for (let x = 0; x < 8; x += 1) bricks.push(brick(x, 1, 0, 1, 1, x % 2 ? 'yellow' : 'blue'));
  for (const x of [0, 2, 4, 6, 7]) bricks.push(brick(x, 0, 0, 1, 1, 'red'));
  bricks.push(brick(0, 2, 0, 8, 1, 'orange'));
  const source = prepared(bricks);
  assert.equal(source.assemblyPlan.stats.rootFailureCount > 0, true);

  const result = planSubassemblies(source);
  assert.equal(result.subassemblyRefinement.selected, false);
  assert.equal(result.subassemblyRefinement.discovery.rejectedToAlignSupportGroups > 0, true);
  assert.equal(result.subassemblyRefinement.proposalCount, 0);
  assert.equal(result.subassemblyRefinement.evaluatedCount, 0);
  assert.equal(unresolvedCells(result.assemblyPlan).size, unresolvedCells(source.assemblyPlan).size);
  assert.deepEqual(result.brickModel, source.brickModel);
});

test('rejects incomplete inputs instead of guessing at a pre-guide or malformed result', () => {
  assert.throws(() => planSubassemblies(), /completed construction result/);
  assert.throws(() => planSubassemblies({ brickModel: { version: 1, kind: 'bricks', bricks: [] } }), /prepared result/);
});

test('a shared ground context retains true ownership for a separately built bridge', () => {
  for (const turns of [0, 1, 2, 3]) {
    const source = prepared(transformBricks([...bridge(), brick(-1, 0, 0, 1, 1, 'lightGray')], {turns, dx: 8, dz: -3}));
    assert.ok(source.assemblyPlan.modules.some(m => m.groupType === 'shared-ground-layout'));
    const frozen = structuredClone(source), result = planSubassemblies(source);
    assert.equal(result.subassemblyRefinement.selected, true);
    assert.deepEqual(source, frozen);
    assert.deepEqual(result.brickModel, source.brickModel);
    assert.equal(result.assemblyPlan.stats.unresolvedBrickCount, 0);
    const assembly = result.assemblyPlan.modules.find(m => m.buildContext);
    const ground = result.assemblyPlan.modules.find(m => m.groupType === 'shared-ground-layout');
    assert.equal(ground.componentIds.length, 2);
    assert.equal(assembly.componentIds.length, 1);
    const component = result.assemblyPlan.graph.components.find(c => c.id === assembly.componentIds[0]);
    assert.ok(assembly.brickIds.every(id => component.brickIds.includes(id)));
    const join = result.assemblyPlan.steps.find(s => s.moduleId === assembly.id && s.kind === 'join');
    assert.equal(join.joinContext.supportGroups.length, 2);
    assert.equal(join.issues.length, 0);
    assert.deepEqual(result.instructionPlan.steps.flatMap(s => s.sourceStepIds), result.assemblyPlan.steps.map(s => s.id));
    assert.deepEqual(result.assemblyPlan.steps.flatMap(s => s.newBrickIds).sort(), source.assemblyPlan.bricks.map(b => b.id).sort());
  }
});

test('a shared work area does not make disconnected selections into an assembly', () => {
  const source = prepared([...bridge(), brick(-1, 0, 0, 1, 1, 'lightGray')]);
  const loose = source.assemblyPlan.bricks.filter(b => b.y === 1).map(b => b.id);
  assert.throws(() => createAssemblyPlan({brickModel: source.brickModel, workSurfaceBrickIds: loose}), /internally stud-connected/);
});

test('refreshes discovery after an accepted interface repair while sharing the evaluation allowance', () => {
  const source = prepared([...bridge(), brick(-1, 0, 0, 1, 1, 'lightGray')]);
  const pending = {...source, attachmentRefinement: {selected: true},
    subassemblyRefinement: {selected: false, evaluatedCount: 7}};
  const frozen = structuredClone(pending), result = revisitSubassembliesAfterAttachment(pending);
  assert.equal(result.subassemblyRefinement.selected, true);
  assert.equal(result.subassemblyRefinement.revisitedAfterAttachment, true);
  assert.equal(result.subassemblyRefinement.limits.maxFullCandidates, 1);
  assert.equal(result.subassemblyRefinement.totalEvaluatedCount, 8);
  assert.deepEqual(result.subassemblyRefinement.previous, pending.subassemblyRefinement);
  assert.deepEqual(pending, frozen);
  assert.equal(revisitSubassembliesAfterAttachment(result), result);
});

test('does not repeat discovery without changed interfaces, available budget, or unresolved roots', () => {
  const source = prepared(bridge());
  const pending = {...source, attachmentRefinement: {selected: true},
    subassemblyRefinement: {selected: false, evaluatedCount: 0}};
  for (const change of [r => {r.attachmentRefinement.selected = false;},
    r => {r.subassemblyRefinement.evaluatedCount = 8;},
    r => {r.assemblyPlan.stats.rootFailureCount = 0;},
    r => {r.assemblyPlan.modules[0].buildContext = {kind: 'work-surface'};}]) {
    const protectedResult = structuredClone(pending);change(protectedResult);
    assert.equal(revisitSubassembliesAfterAttachment(protectedResult), protectedResult);
  }
  for (const maxEvaluations of [-1, 9, 1.5]) assert.throws(() => planSubassemblies(source, {maxEvaluations}), /allowance/);
});
