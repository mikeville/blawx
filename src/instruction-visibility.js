import {workingViewBrick} from './recipe-working-frame.js';
import {createAssemblyJoinPreview} from './assembly-join-preview.js';
import {chooseUpwardInsertionAzimuth} from './upward-insertion-azimuth.js';
const DEFAULT_AZIMUTH = Math.PI * 0.75;
const DEFAULT_ELEVATION = Math.atan(1 / Math.sqrt(2));
const DEFAULT_MAX_RAY_TESTS = 250_000;
const SAMPLES_PER_BRICK = 9;

// Keep the familiar orientation whenever every addition is visible. Otherwise
// choose a quarter turn that exposes the most individual pieces, then the most
// sampled surface. Ties retain the earliest view; work is bounded per angle.
export function chooseInstructionView({visibleBricks, highlightedIds, scale}) {
  const highlighted = new Set(highlightedIds);
  const highlightGroups = visibleBricks.filter(b => highlighted.has(b.id)).map(b => ({id:b.id,bricks:[b]}));
  const angles = [DEFAULT_AZIMUTH, DEFAULT_AZIMUTH + Math.PI/2, DEFAULT_AZIMUTH - Math.PI/2, DEFAULT_AZIMUTH + Math.PI];
  let best = null;
  const views = [];
  for (const azimuth of angles) {
    const report = evaluateInstructionVisibility({visibleBricks,highlightGroups,azimuth,scale,maxRayTests:250_000});
    const weight = report.groups.reduce((sum,g) => sum+g.visibleSampleWeight,0);
    views.push(report);
    if (!best || report.visibleHighlightBrickCount > best.visibleHighlightBrickCount
      || report.visibleHighlightBrickCount === best.visibleHighlightBrickCount && weight > best.weight) best = {...report,weight};
    if (azimuth === DEFAULT_AZIMUTH && report.passes && !report.truncated) break;
  }
  const hidden = new Set(best.groups.filter(g => !g.visibleBrickCount).map(g => g.id));
  const alternative = views.map(view => ({view,count:view.groups.filter(g => hidden.has(g.id) && g.visibleBrickCount).length}))
    .sort((a,b) => b.count-a.count)[0];
  return {...best,turned:best.azimuth !== DEFAULT_AZIMUTH,
    alternateAzimuth:alternative?.count > 0 ? alternative.view.azimuth : null};
}

const DEFAULT_SCALE = Object.freeze({
  studsPerVoxel: 1,
  coursesPerVoxel: 5 / 6,
  voxelMm: 8,
});

/** Use the same per-piece underside view for planning and the live renderer. */
export function chooseUndersideInstructionView({visibleBricks, highlightedIds, scale}) {
  const dimensions = {...DEFAULT_SCALE, ...scale};
  const boxes = visibleBricks.map(brick => bodyBox(brick, dimensions));
  const bodies = boxes.map(({id, min, max}) => ({id,
    x: (min.x + max.x) / 2, y: (min.y + max.y) / 2, z: (min.z + max.z) / 2,
    w: max.x - min.x, h: max.y - min.y, d: max.z - min.z}));
  const highlighted = new Set(highlightedIds);
  const preferred = chooseUpwardInsertionAzimuth(bodies, highlighted);
  const angles = [...new Set([preferred, ...[.75, 1.25, 1.75, .25].map(a => a * Math.PI)])];
  const byId = new Map(visibleBricks.map(b => [b.id, b]));
  const highlightGroups = [...highlighted].map(id => ({id, bricks: byId.has(id) ? [byId.get(id)] : []}));
  let best;
  for (const elevation of [-Math.PI / 7, -Math.PI / 4, -Math.PI / 3, -5 * Math.PI / 12]) {
    for (const azimuth of angles) {
      const report = evaluateInstructionVisibility({visibleBricks, highlightGroups, azimuth, elevation, scale: dimensions});
      // A sliver of one corner is detectable but does not explain placement.
      // Require a clear center ray or at least four exposed corner samples.
      const view = {...report, passes: report.passes && report.groups.every(g => g.visibleSampleWeight >= 4)};
      if (!best || view.visibleHighlightBrickCount > best.visibleHighlightBrickCount) best = view;
      if (view.passes && !view.truncated) return {...view, alternateAzimuth: null};
    }
  }
  return {...best, alternateAzimuth: null};
}

function bodyBox(brick, scale) {
  const width = (brick.w * 8 - 0.2) / scale.voxelMm;
  const height = (9.6 - 0.08) / scale.voxelMm;
  const depth = (brick.d * 8 - 0.2) / scale.voxelMm;
  const center = {
    x: (brick.x + brick.w / 2) / scale.studsPerVoxel,
    y: (brick.y + 0.5) / scale.coursesPerVoxel,
    z: (brick.z + brick.d / 2) / scale.studsPerVoxel,
  };
  return {
    id: brick.id,
    min: { x: center.x - width / 2, y: center.y - height / 2, z: center.z - depth / 2 },
    max: { x: center.x + width / 2, y: center.y + height / 2, z: center.z + depth / 2 },
  };
}

function bodyVisibilitySamples(box) {
  const samples = [{
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
    weight: 4,
  }];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) samples.push({ x, y, z, weight: 1 });
    }
  }
  return samples;
}

function rayHitsBox(origin, direction, box) {
  let near = -Infinity;
  let far = Infinity;
  // This inner loop runs millions of times per guide. Explicit axes avoid
  // allocating an array and doing dynamic property lookups for every box.
  if (Math.abs(direction.x) < 1e-9) {
    if (origin.x < box.min.x || origin.x > box.max.x) return false;
  } else {
    const inverse = 1 / direction.x;
    let first = (box.min.x - origin.x) * inverse;
    let second = (box.max.x - origin.x) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  if (Math.abs(direction.y) < 1e-9) {
    if (origin.y < box.min.y || origin.y > box.max.y) return false;
  } else {
    const inverse = 1 / direction.y;
    let first = (box.min.y - origin.y) * inverse;
    let second = (box.max.y - origin.y) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  if (Math.abs(direction.z) < 1e-9) {
    if (origin.z < box.min.z || origin.z > box.max.z) return false;
  } else {
    const inverse = 1 / direction.z;
    let first = (box.min.z - origin.z) * inverse;
    let second = (box.max.z - origin.z) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far > 1e-5;
}

function roundRobin(groups, limit) {
  const selected = [];
  let index = 0;
  while (selected.length < limit) {
    let added = false;
    for (const group of groups) {
      if (group.boxes[index]) {
        selected.push({ group, box: group.boxes[index] });
        added = true;
        if (selected.length === limit) return selected;
      }
    }
    if (!added) return selected;
    index += 1;
  }
  return selected;
}

function validateScale(scale) {
  for (const key of ['studsPerVoxel', 'coursesPerVoxel', 'voxelMm']) {
    if (!Number.isFinite(scale[key]) || scale[key] <= 0) throw new RangeError(`${key} must be positive.`);
  }
}

/**
 * Checks whether every source operation contributes visible highlighted geometry
 * in the ordinary instruction camera. This is a bounded presentation heuristic,
 * not a claim that the represented attachment is physically possible.
 */
export function evaluateInstructionVisibility({
  visibleBricks,
  highlightGroups,
  azimuth = DEFAULT_AZIMUTH,
  elevation = DEFAULT_ELEVATION,
  maxRayTests = DEFAULT_MAX_RAY_TESTS,
  scale = DEFAULT_SCALE,
}) {
  if (!Array.isArray(visibleBricks) || !Array.isArray(highlightGroups)) {
    throw new TypeError('visibleBricks and highlightGroups must be arrays.');
  }
  if (!Number.isFinite(azimuth) || !Number.isFinite(elevation)) throw new TypeError('Camera angles must be finite.');
  if (!Number.isInteger(maxRayTests) || maxRayTests < 0) throw new RangeError('maxRayTests must be a nonnegative integer.');
  validateScale(scale);

  const visibleIds = new Set();
  const boxes = visibleBricks.map((brick) => {
    if (typeof brick?.id !== 'string' || visibleIds.has(brick.id)) {
      throw new RangeError('Visible brick IDs must be unique strings.');
    }
    visibleIds.add(brick.id);
    return bodyBox(brick, scale);
  });
  const boxesById = new Map(boxes.map((box) => [box.id, box]));
  const groupIds = new Set();
  const highlightedIds = new Set();
  const groups = highlightGroups.map((group) => {
    if (typeof group?.id !== 'string' || groupIds.has(group.id) || !Array.isArray(group.bricks)) {
      throw new RangeError('Highlight groups require unique string IDs and brick arrays.');
    }
    groupIds.add(group.id);
    const eligible = [];
    let missingBrickCount = 0;
    for (const brick of group.bricks) {
      if (typeof brick?.id !== 'string' || highlightedIds.has(brick.id)) {
        throw new RangeError('Highlighted brick IDs must be unique strings across groups.');
      }
      highlightedIds.add(brick.id);
      const box = boxesById.get(brick.id);
      if (box) eligible.push(box);
      else missingBrickCount += 1;
    }
    return {
      id: group.id,
      totalBrickCount: group.bricks.length,
      eligibleBrickCount: eligible.length,
      missingBrickCount,
      testedBrickCount: 0,
      visibleBrickCount: 0,
      visibleSampleWeight: 0,
      boxes: eligible,
    };
  });

  const testsPerBrick = SAMPLES_PER_BRICK * Math.max(0, boxes.length - 1);
  const brickBudget = testsPerBrick === 0
    ? highlightedIds.size
    : Math.floor(maxRayTests / testsPerBrick);
  const eligibleCount = groups.reduce((sum, group) => sum + group.eligibleBrickCount, 0);
  const coversEveryGroup = groups.every((group) => group.eligibleBrickCount > 0)
    && brickBudget >= groups.length;
  const selected = coversEveryGroup ? roundRobin(groups, Math.min(brickBudget, eligibleCount)) : [];
  const horizontal = Math.cos(elevation);
  const direction = {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(elevation),
    z: Math.cos(azimuth) * horizontal,
  };
  let rayTests = 0;

  for (const { group, box } of selected) {
    group.testedBrickCount += 1;
    let visibleWeight = 0;
    for (const point of bodyVisibilitySamples(box)) {
      const origin = {
        x: point.x + direction.x * 1e-4,
        y: point.y + direction.y * 1e-4,
        z: point.z + direction.z * 1e-4,
      };
      let hidden = false;
      for (const candidate of boxes) {
        if (candidate === box) continue;
        rayTests += 1;
        if (rayHitsBox(origin, direction, candidate)) {
          hidden = true;
          break;
        }
      }
      if (!hidden) visibleWeight += point.weight;
    }
    if (visibleWeight > 0) group.visibleBrickCount += 1;
    group.visibleSampleWeight += visibleWeight;
  }

  const reports = groups.map(({ boxes: unused, ...group }) => group);
  const truncated = selected.length < eligibleCount;
  const passes = coversEveryGroup
    && reports.every((group) => group.missingBrickCount === 0 && group.visibleBrickCount > 0);
  return {
    passes,
    truncated,
    azimuth,
    elevation,
    rayTests,
    eligibleHighlightBrickCount: eligibleCount,
    testedHighlightBrickCount: selected.length,
    visibleHighlightBrickCount: reports.reduce((sum, group) => sum + group.visibleBrickCount, 0),
    groups: reports,
  };
}

const sequenceViews = new WeakMap();
// Plan a run together: choose a camera that can remain useful through the next
// placements instead of returning to the default after every easy diagram.
export function chooseInstructionSequence(plan) {
  if(sequenceViews.has(plan)) return sequenceViews.get(plan);
  const byId=new Map((plan.bricks??[]).map(b=>[b.id,b]));
  const repairedAssemblies=new Set((plan.modules??[]).filter(m=>m.localInterfaceRepair).map(m=>m.id));
  const sharedAssemblies=new Set((plan.modules??[]).filter(m=>m.sharedHandledRecipe).map(m=>m.id));
  const angles=[DEFAULT_AZIMUTH,DEFAULT_AZIMUTH+Math.PI/2,DEFAULT_AZIMUTH-Math.PI/2,DEFAULT_AZIMUTH+Math.PI];
  const result=new Map();let run=[];
  function finish() {
    if(!run.length) return;
    let states=angles.map((azimuth,i)=>({cost:i===0?0:.25,path:[],azimuth}));
    for(const step of run) {
      const visibleBricks=step.visibleBrickIds.map(id=>byId.get(id)).filter(Boolean);
      const highlightGroups=step.highlightBrickIds.map(id=>({id,bricks:[byId.get(id)]}));
      const views=angles.map(azimuth=>({...evaluateInstructionVisibility({visibleBricks,highlightGroups,azimuth}),alternateAzimuth:null}));
      let available=views.filter(v=>v.passes&&!v.truncated);
      if(!available.length) available=[chooseInstructionView({visibleBricks,highlightedIds:step.highlightBrickIds})];
      states=available.map(view=>{
        const previous=states.map(s=>({state:s,cost:s.cost+(s.azimuth===view.azimuth?0:1)}))
          .sort((a,b)=>a.cost-b.cost)[0];
        return {cost:previous.cost,path:[...previous.state.path,view],azimuth:view.azimuth};
      });
    }
    const best=states.sort((a,b)=>a.cost-b.cost)[0];
    let previous=DEFAULT_AZIMUTH;
    run.forEach((step,i)=>{const view=best.path[i];result.set(step.id,{...view,turned:view.azimuth!==previous});previous=view.azimuth;});
    run=[];
  }
  for(const [index,step] of plan.steps.entries()) {
    if(step.workingOrientation?.kind==='inverted'){
      finish();
      result.set(step.id,chooseInstructionView({visibleBricks:step.visibleBrickIds.map(id=>workingViewBrick(byId.get(id),step.workingOrientation)),highlightedIds:step.highlightBrickIds}));
      continue;
    }
    if(!byId.size||step.insertionDirection==='up') {finish();continue;}
    if(step.kind==='join') {
      finish();
      // Repeated handled assemblies attach at different locations. Expose the
      // current copy. Repaired interfaces use the actual exploded scene so
      // a camera cannot pass merely because the final resting place is visible.
      if(!step.nestedRecipe&&(repairedAssemblies.has(step.moduleId)||sharedAssemblies.has(step.moduleId)&&!step.joinContext)) {
        const visibleBricks=step.visibleBrickIds.map(id=>byId.get(id)).filter(Boolean);
        const expanded=createAssemblyJoinPreview({model:{kind:'bricks',bricks:visibleBricks},highlightIds:new Set(step.highlightBrickIds),joinContext:step.joinContext});
        const view=chooseInstructionView({
          visibleBricks:expanded.model.bricks,
          highlightedIds:step.highlightBrickIds,
        });
        const previous=plan.steps[index-1];
        const previousAngle=previous?.kind==='join'?result.get(previous.id)?.azimuth:undefined;
        result.set(step.id,{...view,turned:view.azimuth!==(previousAngle??DEFAULT_AZIMUTH)});
      }
      continue;
    }
    if(run.length&&run[0].moduleId!==step.moduleId) finish();
    run.push(step);
  }
  finish();sequenceViews.set(plan,result);return result;
}
