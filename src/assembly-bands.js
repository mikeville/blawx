import {recipeBrickId} from './assembly-recipes.js';
import {annotateActions, actionCompletionRejections} from './assembly-actions.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {inspectConstruction} from './construction.js';
import {assemblyRejectionReasons, packingProfile, packingRejectionReasons} from './refine-construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w
  && a.z < b.z + b.d && b.z < a.z + a.d;
const cellKey = c => `${c.x},${c.y},${c.z}`;
const expand = bricks => bricks.flatMap(b => Array.from({length: b.w * b.d}, (_, i) => ({
  x: b.x + i % b.w, y: b.y, z: b.z + Math.floor(i / b.w), color: b.color,
})));
const identify = b => ({...b, id: recipeBrickId(b)});
const transpose = b => ({...b, x: b.z, z: b.x, w: b.d, d: b.w});

// Pack equal-width contour runs. Lower bricks run along the assembly; crossing
// courses tie their seams together. The destination boundary constrains packing,
// so an existing brick seam cannot turn the last band into scattered leftovers.
function packRuns(cells, y, {longitudinal = false, seamOrigin = 0, offset = 0, rowOrigin} = {}) {
  const pending = new Map(cells.map(c => [`${c.x},${c.z}`, c.color]));
  const result = [];
  while (pending.size) {
    const ordered = [...pending].map(([key, color]) => {
      const [x, z] = key.split(',').map(Number);
      return {x, z, color};
    }).sort((a, b) => a.z - b.z || a.x - b.x);
    const {x, z, color} = ordered[0];
    let run = 0;
    while (pending.get(`${x + run},${z}`) === color) run++;
    let depth = 0;
    while (depth < 4
      && Array.from({length: run}, (_, i) => pending.get(`${x + i},${z + depth}`) === color).every(Boolean)
      && pending.get(`${x - 1},${z + depth}`) !== color
      && pending.get(`${x + run},${z + depth}`) !== color) depth++;
    const untilSeam = 4 - ((z - seamOrigin) % 4 + 4) % 4;
    const rowDepth=rowOrigin===undefined?2:2-((z-rowOrigin)%2+2)%2;
    const d = Math.min(depth, longitudinal ? untilSeam : rowDepth);
    for (let at = x; at < x + run;) {
      const w = Math.min(x + run - at, d > 2 ? 2 : at === x && offset ? offset : 4);
      result.push(identify({x: at, y, z, w, d, color}));
      for (let u = at; u < at + w; u++) for (let v = z; v < z + d; v++) pending.delete(`${u},${v}`);
      at += w;
    }
  }
  return result;
}

function rectangularSurface(bricks) {
  const cells = expand(bricks);
  const floor = Math.min(...cells.map(c => c.y));
  const top = Math.max(...cells.map(c => c.y));
  if (top - floor < 1 || top - floor > 3) return null;
  const roof = cells.filter(c => c.y === top);
  const minX = Math.min(...roof.map(c => c.x)), maxX = Math.max(...roof.map(c => c.x)) + 1;
  const minZ = Math.min(...roof.map(c => c.z)), maxZ = Math.max(...roof.map(c => c.z)) + 1;
  const width = maxX - minX, depth = maxZ - minZ;
  if (roof.length !== width * depth || new Set(roof.map(c => c.color)).size !== 1
    || Math.min(width, depth) > 12 || Math.min(width, depth) < 4
    || Math.max(width, depth) < 8 || roof.length > 384) return null;
  // Deep recesses and large protrusions need a different assembly strategy.
  if (cells.some(c => c.x < minX - 2 || c.x >= maxX + 2 || c.z < minZ - 2 || c.z >= maxZ + 2)) return null;
  return {floor, top, axis: depth >= width ? 'z' : 'x'};
}

/** Propose completed, full-width bands for a compact layered work-surface assembly. */
export function proposeAssemblyBands(bricks, {bandDepth = 4, reverse = false, bondOffset = 2} = {}) {
  const surface = rectangularSurface(bricks);
  if (!surface || ![2, 4].includes(bandDepth) || ![0, 2].includes(bondOffset)) return null;
  const {floor, top, axis} = surface;
  const local = axis === 'x' ? bricks.map(transpose) : bricks;
  const cells = expand(local), roof = cells.filter(c => c.y === top);
  const low = Math.min(...roof.map(c => c.z)), high = Math.max(...roof.map(c => c.z)) + 1;
  if (cells.some(c => c.y > floor && (c.z < low || c.z >= high))) return null;
  const bands = [];
  for (let start = low; start < high; start += bandDepth) bands.push([start, Math.min(high, start + bandDepth)]);
  // Absorb a one-stud remainder before scheduling, rather than repairing it later.
  if (bands.length > 1 && bands.at(-1)[1] - bands.at(-1)[0] === 1) {
    bands.at(-2)[1]--;
    bands.at(-1)[0]--;
  }
  if (reverse) bands.reverse();
  const lower = packRuns(cells.filter(c => c.y === floor), floor, {longitudinal: true, seamOrigin: low + 1});
  const pending = new Set(lower), packed = [...lower], actions = [];
  const emit = (pieces, kind, destination) => {
    if (!pieces.length) return;
    actions.push({kind, destination, brickIds: pieces.map(b => b.id)});
  };
  for (const [index, [start, end]] of bands.entries()) {
    const destination = {kind: 'band', axis, start, end, ordinal: index + 1, total: bands.length};
    const courses = [];
    for (let y = floor + 1; y <= top; y++) {
      courses.push(packRuns(cells.filter(c => c.y === y && c.z >= start && c.z < end), y,
        {offset: (y - floor) % 2 ? bondOffset : 0}));
    }
    if (courses.some(course => !course.length || course.length > 12)) return null;
    const prerequisites = [...pending].filter(b => courses[0].some(upper => overlaps(b, upper)));
    // One short initial layout may contain end tabs. Subsequent extensions must
    // stay smaller; both are validated for actual bonding and insertion below.
    if (prerequisites.length > (index === 0 ? 8 : 6)) return null;
    if (prerequisites.length) {
      const spanX = Math.max(...prerequisites.map(b => b.x + b.w)) - Math.min(...prerequisites.map(b => b.x));
      const spanZ = Math.max(...prerequisites.map(b => b.z + b.d)) - Math.min(...prerequisites.map(b => b.z));
      if (spanX > 12 || spanZ > 8) return null;
    }
    prerequisites.forEach(b => pending.delete(b));
    emit(prerequisites, 'foundation', destination);
    courses.forEach((course, i) => {
      packed.push(...course);
      emit(course, i === courses.length - 1 ? 'complete-band' : 'bond', destination);
    });
  }
  if (pending.size) return null;
  const transformed = axis === 'x' ? packed.map(b => identify(transpose(b))) : packed;
  const mapping = new Map(packed.map((b, i) => [b.id, transformed[i].id]));
  return {bricks: transformed, actions: actions.map(a => ({...a, brickIds: a.brickIds.map(id => mapping.get(id))})),
    axis, bandDepth, reverse, bondOffset, bandCount: bands.length};
}

// Partition complete rows together. Search all consecutive row boundaries so
// capacity limits cannot leave a single brick or part of a row for cleanup.
function layerLayouts(bricks, reverse) {
  const rows = [];
  for (const b of [...bricks].sort((a,b)=>a.z-b.z||a.x-b.x)) {
    if (rows.at(-1)?.[0].z === b.z) rows.at(-1).push(b);
    else rows.push([b]);
  }
  if (reverse) rows.reverse();
  const memo = new Map();
  function solve(start) {
    if (start === rows.length) return {groups:[],cost:0};
    if (memo.has(start)) return memo.get(start);
    let best = null, pieces = [];
    for (let end=start;end<rows.length;end++) {
      pieces=[...pieces,...rows[end]];
      const width=Math.max(...pieces.map(b=>b.x+b.w))-Math.min(...pieces.map(b=>b.x));
      const depth=Math.max(...pieces.map(b=>b.z+b.d))-Math.min(...pieces.map(b=>b.z));
      const area=pieces.reduce((n,b)=>n+b.w*b.d,0);
      if(pieces.length>18||width>12||depth>16||area>192) break;
      if(area/(width*depth)<.8) continue;
      const tail=solve(end+1);if(!tail)continue;
      const candidate={groups:[[...pieces],...tail.groups],cost:pieces.length**2+tail.cost};
      if(!best||candidate.groups.length<best.groups.length
        ||candidate.groups.length===best.groups.length&&candidate.cost<best.cost)best=candidate;
    }
    memo.set(start,best);return best;
  }
  return solve(0)?.groups ?? null;
}

/** Complete each layer before moving upward, with a bounded layout on the table. */
export function proposeAssemblyLayers(bricks, {reverse=false,bondOffset=2}={}) {
  const surface=rectangularSurface(bricks);
  if(!surface||![0,2].includes(bondOffset))return null;
  const {floor,top,axis}=surface;
  const cells=expand(axis==='x'?bricks.map(transpose):bricks);
  const low=Math.min(...cells.filter(c=>c.y===top).map(c=>c.z));
  const packed=[],actions=[];
  for(let y=floor;y<=top;y++) {
    const course=packRuns(cells.filter(c=>c.y===y),y,{longitudinal:y===floor,
      seamOrigin:low+1,rowOrigin:low,offset:y>floor&&(y-floor)%2?bondOffset:0});
    if(y===floor&&course.length>40)return null;
    const layouts=layerLayouts(course,reverse);
    if(!layouts)return null;
    packed.push(...course);
    layouts.forEach((pieces,index)=>actions.push({
      kind:y===floor?'layout-layer':index===layouts.length-1?'complete-layer':'extend-layer',
      destination:{kind:'layer',axis,course:y,firstCourse:floor,lastCourse:top,
        start:Math.min(...pieces.map(b=>b.z)),end:Math.max(...pieces.map(b=>b.z+b.d)),
        ordinal:index+1,total:layouts.length},brickIds:pieces.map(b=>b.id),
    }));
  }
  const transformed=axis==='x'?packed.map(b=>identify(transpose(b))):packed;
  const ids=new Map(packed.map((b,i)=>[b.id,transformed[i].id]));
  return {bricks:transformed,actions:actions.map(a=>({...a,brickIds:a.brickIds.map(id=>ids.get(id))})),
    axis,reverse,bondOffset,mode:'layers',layerCount:top-floor+1};
}

function replayExisting(plan, module) {
  const steps = plan.steps.filter(s => s.moduleId === module.id && s.newBrickIds.length);
  const actions = steps.map(s => ({kind: s.instructionAction?.kind ?? 'course',
    ...(s.instructionAction?.destination ? {destination: s.instructionAction.destination} : {}), brickIds: [...s.newBrickIds]}));
  return {...module, actions, actionOrder: true,
    placementGroups: actions.map(a => a.brickIds), brickOrder: actions.flatMap(a => a.brickIds)};
}

const sameOccupancy = (a, b) => {
  const expected = new Map(expand(a).map(c => [cellKey(c), c.color]));
  const actual = expand(b);
  return expected.size === actual.length && new Set(actual.map(cellKey)).size === actual.length
    && actual.every(c => expected.get(cellKey(c)) === c.color);
};

const diagramCount = (plan, guide) => deriveGuidePresentation({plan, guide}).sections.reduce((n, s) => n + s.stepIds.length, 0);

// Evaluate entire proposed runs, including their final band and physical replay.
// Assemblies outside this geometric family retain their existing recipe/order.
export function refineAssemblyBands(result) {
  if (!result.assemblyPlan || result.assemblyError || result.brickModel.bricks.length > 1000) return result;
  const started = performance.now();
  let current = result;
  const reports = [];
  for (const module of result.assemblyPlan.modules.filter(m => m.buildContext?.kind === 'work-surface')) {
    const before = current.assemblyPlan;
    const owned = new Set(module.brickIds);
    const source = before.bricks.filter(b => owned.has(b.id));
    const candidates = [], attempts = [];
    const variants=['layers','bands'].flatMap(mode=>[false,true].flatMap(reverse=>[0,2].flatMap(bondOffset=>
      (mode==='bands'?[4,2]:[undefined]).map(bandDepth=>({mode,reverse,bondOffset,bandDepth})))));
    for (const {mode,bandDepth,reverse,bondOffset} of variants) {
      const proposal = mode==='layers'?proposeAssemblyLayers(source,{reverse,bondOffset})
        : proposeAssemblyBands(source, {bandDepth, reverse, bondOffset});
      if (!proposal) continue;
      try {
        if (!sameOccupancy(source, proposal.bricks)) throw Error('Band packing changed colored occupancy');
        const bricks = [...before.bricks.filter(b => !owned.has(b.id)), ...proposal.bricks];
        const brickModel = {...current.brickModel, bricks: bricks.map(({id, ...b}) => b)};
        const packingReasons = packingRejectionReasons(packingProfile(before.bricks), packingProfile(bricks));
        if (packingReasons.length) throw Error(packingReasons.join('; '));
        const diagnostics = inspectConstruction(brickModel);
        if (!diagnostics.checks.schema || !diagnostics.checks.legalFootprints || !diagnostics.checks.noCollisions) throw Error('Invalid band packing');
        const replay = before.modules.map(m => m.id === module.id ? {
          ...m, brickIds: proposal.bricks.map(b => b.id), actions: proposal.actions, actionOrder: true,
          placementGroups: proposal.actions.map(a => a.brickIds), brickOrder: proposal.actions.flatMap(a => a.brickIds),
          buildContext: {...m.buildContext, orderPolicy: 'planned-actions'},
        } : replayExisting(before, m));
        const plan = annotateActions(createAssemblyPlan({brickModel, moduleReplay: replay,
          integratedBuild: before.integratedBuild ?? false}), replay);
        const reasons = [...assemblyRejectionReasons(before, plan), ...actionCompletionRejections(plan)];
        for (const unaffected of before.modules.filter(m => m.id !== module.id)) {
          const signature = p => JSON.stringify(p.steps.filter(s => s.moduleId === unaffected.id)
            .map(s => [s.kind, s.newBrickIds]));
          if (signature(before) !== signature(plan)) reasons.push('Another assembly recipe changed');
        }
        if (plan.stats.upwardInsertionBrickCount > before.stats.upwardInsertionBrickCount) reasons.push('Upward insertion increased');
        const compacted = compactAssemblyPlan(plan), guide = createGuideSections(compacted.plan);
        if (!compacted.report.brickCoverageComplete || !compacted.report.sourceStepCoverageComplete) reasons.push('Incomplete band coverage');
        const displayed = diagramCount(compacted.plan, guide);
        if (displayed > diagramCount(current.instructionPlan, current.guide)) reasons.push('Band sequence adds diagrams');
        const handling = assessWorkSurfaceQuality(plan).aggregate;
        const looseLimit=mode==='layers'?40:8;
        if (handling.peakLooseBrickCount > looseLimit || mode!=='layers'&&handling.peakStepDetachedBrickCount > looseLimit) reasons.push('Surface layout exceeds limit');
        const attempt = {mode,bandDepth, reverse, bondOffset, bands: proposal.bandCount, displayed, rejectionReasons: reasons};
        attempts.push(attempt);
        if (!reasons.length) candidates.push({proposal, plan, compacted, guide, brickModel, diagnostics, handling, displayed});
      } catch (error) { attempts.push({mode,bandDepth, reverse, bondOffset, rejectionReasons: [error.message]}); }
    }
    // Prefer completing layers for this compact surface family. Physical replay
    // still gates every candidate; complete bands remain the bounded fallback.
    candidates.sort((a, b) => Number(b.proposal.mode==='layers')-Number(a.proposal.mode==='layers')
      || a.displayed-b.displayed || (a.proposal.bandCount??0) - (b.proposal.bandCount??0)
      || a.handling.detachedBrickExposure - b.handling.detachedBrickExposure
      || a.displayed - b.displayed || a.proposal.bricks.length - b.proposal.bricks.length);
    const selected = candidates[0];
    if (!selected) { if (attempts.length) reports.push({moduleId: module.id, selected: false, attempts}); continue; }
    const histogram = {};
    for (const b of selected.brickModel.bricks) {
      const key = `${Math.min(b.w, b.d)}x${Math.max(b.w, b.d)}`;
      histogram[key] = (histogram[key] ?? 0) + 1;
    }
    reports.push({moduleId: module.id, selected: true, axis: selected.proposal.axis,
      mode:selected.proposal.mode??'bands',
      bandDepth: selected.proposal.bandDepth, reverse: selected.proposal.reverse, bands: selected.proposal.bandCount,
      bondOffset: selected.proposal.bondOffset,
      beforeParts: source.length, afterParts: selected.proposal.bricks.length, attempts});
    current = {...current, brickModel: selected.brickModel, diagnostics: selected.diagnostics,
      assemblyPlan: selected.plan, instructionPlan: selected.compacted.plan, guide: selected.guide,
      assemblyEvaluation: {...current.assemblyEvaluation, compaction: selected.compacted.report},
      metrics: {...current.metrics, brickCount: selected.brickModel.bricks.length, partHistogram: histogram}};
  }
  const elapsed = performance.now() - started;
  return reports.length ? {...current, bandRefinement: reports,
    metrics: {...current.metrics, conversionMs: (current.metrics?.conversionMs ?? 0) + elapsed,
      stageTiming: {...current.metrics?.stageTiming, bandRefinementMs: elapsed}}} : current;
}
