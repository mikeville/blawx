import { assessBandRegularity, assessLayerGrouping } from './layer-regularity.js';
import { assessWorkSurfaceQuality } from './work-surface-quality.js';

const keyOf = ({x, y, z, w, d, color}) => `${x},${y},${z}:${w}x${d}:${color}`;
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bandOf = result => result.assemblyPlan.modules.find(module => module.buildContext?.kind === 'work-surface');
const cellsOf = brick => {
  const cells = [];
  for (let x = brick.x; x < brick.x + brick.w; x++) for (let z = brick.z; z < brick.z + brick.d; z++) cells.push(`${x},${brick.y},${z}:${brick.color}`);
  return cells;
};

// A patch may replace band pieces together, but may not silently absorb another
// assembly or change the independent supports on which the band is lowered.
export function remapAttachmentBand(result, proposal) {
  const band = bandOf(result);
  if (!band) return null;
  const bandIds = new Set(band.brickIds);
  const bandKeys = new Set(result.assemblyPlan.bricks.filter(brick => bandIds.has(brick.id)).map(keyOf));
  const replaced = new Set(proposal.before.map(keyOf));
  const inBand = proposal.before.filter(brick => bandKeys.has(keyOf(brick))).length;
  if (inBand && inBand !== proposal.before.length) throw new Error('A patch crosses the selected band boundary');
  const join = result.assemblyPlan.steps.find(step => step.moduleId === band.id && step.kind === 'join');
  const supportIds = new Set(join?.joinContext?.supportGroups.flatMap(group => group.brickIds) ?? []);
  if (result.assemblyPlan.bricks.some(brick => supportIds.has(brick.id) && replaced.has(keyOf(brick)))) {
    throw new Error('A patch changes the established independent supports');
  }
  return {
    changed: inBand > 0,
    workSurfaceBrickIds: inBand ? [...band.brickIds.filter(id => !replaced.has(id.slice(2))), ...proposal.after.map(brick => `b@${keyOf(brick)}`)] : band.brickIds,
    workSurfaceOrder: band.buildContext.orderPolicy ?? 'course-first',
  };
}

function supportEvidence(result, band) {
  const plan = result.assemblyPlan;
  const join = plan.steps.find(step => step.moduleId === band.id && step.kind === 'join');
  if (!join || join.issues.some(issue => issue.severity === 'error') || join.joinContext?.direction !== 'down') return null;
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
  return join.joinContext.supportGroups.map(group => ({
    brickIds: [...group.brickIds].sort(),
    // Brick IDs can change during exact retiling. The physical stud locations
    // and unchanged lower support identity, rather than edge counts, must match.
    contacts: [...new Set(group.contacts.flatMap(contact => {
      const lower = byId.get(contact.supportBrickId);
      const upper = byId.get(contact.bandBrickId);
      const cells = [];
      for (let x = Math.max(lower.x, upper.x); x < Math.min(lower.x + lower.w, upper.x + upper.w); x++) {
        for (let z = Math.max(lower.z, upper.z); z < Math.min(lower.z + lower.d, upper.z + upper.d); z++) cells.push(`${lower.id}:${x},${upper.y},${z}`);
      }
      return cells;
    }))].sort(),
  })).sort((a, b) => a.brickIds.join('|').localeCompare(b.brickIds.join('|')));
}

// Compare the arrangement of the original occupied cells independently of a
// declared edge tab. A larger silhouette is not itself scattered instruction
// grouping. This projection cannot excuse moving old cells between poor groups.
function projectedGrouping(result, band, originalCells) {
  const byId = new Map(result.assemblyPlan.bricks.map(brick => [brick.id, brick]));
  let area = 0;
  let empty = 0;
  for (const step of result.instructionPlan.steps.filter(step => step.moduleId === band.id && step.kind === 'build')) {
    const byCourse = new Map();
    for (const id of step.newBrickIds) for (const cell of cellsOf(byId.get(id))) {
      if (!originalCells.has(cell)) continue;
      const [x, y, z] = cell.split(':')[0].split(',').map(Number);
      if (!byCourse.has(y)) byCourse.set(y, []);
      byCourse.get(y).push({x, z});
    }
    for (const cells of byCourse.values()) {
      area += cells.length;
      const width = Math.max(...cells.map(cell => cell.x)) - Math.min(...cells.map(cell => cell.x)) + 1;
      const depth = Math.max(...cells.map(cell => cell.z)) - Math.min(...cells.map(cell => cell.z)) + 1;
      empty += width * depth - cells.length;
    }
  }
  return {area, rectangleEmptyCellCount: empty, rectangularCoverageRatio: area / (area + empty)};
}

export function attachmentBandEvidence(before, candidate) {
  const oldBand = bandOf(before);
  const band = bandOf(candidate);
  if (!oldBand || !band) return null;
  const originalCells = new Set(before.assemblyPlan.bricks.filter(brick => oldBand.brickIds.includes(brick.id)).flatMap(cellsOf));
  const measure = (result, module) => ({
    grouping: assessLayerGrouping(result.instructionPlan, module.id),
    projectedGrouping: projectedGrouping(result, module, originalCells),
    handling: {canonical: assessWorkSurfaceQuality(result.assemblyPlan).aggregate,
      diagrams: assessWorkSurfaceQuality(result.instructionPlan).aggregate},
    supports: supportEvidence(result, module),
  });
  return {before: measure(before, oldBand), after: measure(candidate, band)};
}

export function attachmentBandRejections(before, candidate, addedCells) {
  const oldBand = bandOf(before);
  const band = bandOf(candidate);
  const reasons = [];
  if (!oldBand || !band) return ['The selected work-surface band was lost'];
  if (!same(oldBand.buildContext, band.buildContext)) reasons.push('The platform floor or ordering policy changed');
  const selectedBricks = (result, module) => result.assemblyPlan.bricks.filter(brick => module.brickIds.includes(brick.id));
  const oldBricks = selectedBricks(before, oldBand);
  const newBricks = selectedBricks(candidate, band);
  const expected = [...new Set([...oldBricks.flatMap(cellsOf), ...addedCells.map(cell => `${cell.x},${cell.y},${cell.z}:${cell.color}`)])].sort();
  if (!same(expected, newBricks.flatMap(cellsOf).sort())) reasons.push('Band ownership changed beyond the declared patch');
  const oldSupports = supportEvidence(before, oldBand);
  const supports = supportEvidence(candidate, band);
  if (!oldSupports || !supports || !same(oldSupports, supports)) reasons.push('The downward join or its physical support contacts changed');
  if (candidate.assemblyPlan.steps.some(step => step.moduleId === band.id && step.newBrickIds.length
    && (step.kind !== 'build' || step.issues.some(issue => issue.severity === 'error')))) reasons.push('The revised band cannot be built on the table');
  const evidence = attachmentBandEvidence(before, candidate);
  const oldHandling = evidence.before.handling;
  const nextHandling = evidence.after.handling;
  if (nextHandling.canonical.finalComponentCount !== 1 || nextHandling.diagrams.finalComponentCount !== 1) reasons.push('The completed band is not stud-connected');
  const oldGrouping = assessLayerGrouping(before.instructionPlan, oldBand.id);
  const grouping = assessLayerGrouping(candidate.instructionPlan, band.id);
  if (grouping.buildDiagramCount > oldGrouping.buildDiagramCount + 1) reasons.push('The patch adds more than one platform diagram');
  if (oldBand.buildContext.orderPolicy === 'rectangular-layers') {
    if (!assessBandRegularity(newBricks).eligible) reasons.push('The platform is no longer regular');
    if (grouping.mixedCourseDiagramCount || grouping.courseReturnCount) reasons.push('The platform mixes or revisits courses');
    if (evidence.after.projectedGrouping.rectangleEmptyCellCount > evidence.before.projectedGrouping.rectangleEmptyCellCount
      || evidence.after.projectedGrouping.rectangularCoverageRatio + 1e-9 < evidence.before.projectedGrouping.rectangularCoverageRatio
      || grouping.partialLineExposure > oldGrouping.partialLineExposure) reasons.push('Rectangular platform grouping became less coherent');
  } else {
    for (const scope of ['canonical', 'diagrams']) {
      for (const field of ['peakComponentCount', 'peakDetachedBrickCount', 'peakStepDetachedBrickCount', 'peakLooseBrickCount', 'detachedBrickExposure']) {
        if (nextHandling[scope][field] > oldHandling[scope][field]) reasons.push(`Platform ${scope}.${field} increased`);
      }
      const bond = oldHandling[scope].firstBondAtAddition;
      if (bond !== null && (nextHandling[scope].firstBondAtAddition === null || nextHandling[scope].firstBondAtAddition > bond)) reasons.push('The first platform bond was delayed');
    }
  }
  return [...new Set(reasons)];
}
