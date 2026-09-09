const MIN_SUPPORT_GROUPS = 1;
const MAX_SUPPORT_GROUPS = 4;
const MIN_LIFT_COURSES = 3;
const STANDARD_ISOMETRIC_ELEVATION = Math.atan(1 / Math.sqrt(2));
const STANDARD_ISOMETRIC_AXIS = 1 / Math.sqrt(2);

function overlapStuds(lower, upper) {
  const minX = Math.max(lower.x, upper.x);
  const maxX = Math.min(lower.x + lower.w, upper.x + upper.w);
  const minZ = Math.max(lower.z, upper.z);
  const maxZ = Math.min(lower.z + lower.d, upper.z + upper.d);
  if (maxX <= minX || maxZ <= minZ || lower.y + 1 !== upper.y) return [];
  const studs = [];
  for (let x = minX; x < maxX; x += 1) for (let z = minZ; z < maxZ; z += 1) {
    studs.push({ x, z, supportBrickId: lower.id, bandBrickId: upper.id });
  }
  return studs;
}

function internallyConnected(ids, bricksById) {
  const adjacency = new Map([...ids].map((id) => [id, new Set()]));
  const bricks = [...ids].map((id) => bricksById.get(id));
  for (let a = 0; a < bricks.length; a += 1) for (let b = a + 1; b < bricks.length; b += 1) {
    if (!overlapStuds(bricks[a], bricks[b]).length && !overlapStuds(bricks[b], bricks[a]).length) continue;
    adjacency.get(bricks[a].id).add(bricks[b].id);
    adjacency.get(bricks[b].id).add(bricks[a].id);
  }
  const first = ids.values().next().value;
  const reached = new Set([first]);
  const pending = [first];
  while (pending.length) {
    for (const neighbor of adjacency.get(pending.pop())) if (!reached.has(neighbor)) {
      reached.add(neighbor);
      pending.push(neighbor);
    }
  }
  return reached.size === ids.size;
}

function inactive(model) {
  return { active: false, model, liftCourses: 0, arrows: [], targetStuds: [] };
}

function liftCoursesFor(bricks, { studsPerVoxel, coursesPerVoxel }) {
  const xSpan = Math.max(...bricks.map(({ x, w }) => x + w)) - Math.min(...bricks.map(({ x }) => x));
  const zSpan = Math.max(...bricks.map(({ z, d }) => z + d)) - Math.min(...bricks.map(({ z }) => z));
  // At a standard four-corner isometric view, both horizontal axes contribute
  // equally to the slab's vertical screen projection. Lift far enough to clear
  // that silhouette, then leave one integral course of printed white space.
  const projectedDepth = (xSpan + zSpan) * STANDARD_ISOMETRIC_AXIS / studsPerVoxel;
  const occlusionCourses = projectedDepth * Math.tan(STANDARD_ISOMETRIC_ELEVATION) * coursesPerVoxel;
  return Math.max(MIN_LIFT_COURSES, Math.ceil(occlusionCourses + 1));
}

// Build a static exploded projection in the same display units as brickPreviewData.
// The source model and its brick records remain untouched.
export function createAssemblyJoinPreview({ model, highlightIds, joinContext } = {}) {
  if (model?.kind !== 'bricks' || !Array.isArray(model.bricks)
    || !(highlightIds instanceof Set) || highlightIds.size < 2
    || joinContext?.direction !== 'down'
    || !Array.isArray(joinContext.supportGroups)
    || joinContext.supportGroups.length < MIN_SUPPORT_GROUPS
    || joinContext.supportGroups.length > MAX_SUPPORT_GROUPS
    || joinContext.requiresAlignment !== (joinContext.supportGroups.length > 1)) return inactive(model);

  const bricksById = new Map();
  for (const brick of model.bricks) {
    if (typeof brick?.id !== 'string' || bricksById.has(brick.id)) return inactive(model);
    bricksById.set(brick.id, brick);
  }
  if ([...highlightIds].some((id) => !bricksById.has(id)) || !internallyConnected(highlightIds, bricksById)) {
    return inactive(model);
  }

  const targetStuds = [];
  const sourceArrows = [];
  const usedContacts = new Set();
  for (let groupIndex = 0; groupIndex < joinContext.supportGroups.length; groupIndex += 1) {
    const group = joinContext.supportGroups[groupIndex];
    if (!Array.isArray(group?.brickIds) || !group.brickIds.length || !Array.isArray(group.contacts) || !group.contacts.length) {
      return inactive(model);
    }
    const supportIds = new Set(group.brickIds);
    if ([...supportIds].some((id) => !bricksById.has(id) || highlightIds.has(id))
      || ![...supportIds].some((id) => bricksById.get(id).y === 0)) return inactive(model);

    const groupStuds = [];
    for (const contact of group.contacts) {
      const key = `${contact?.supportBrickId}|${contact?.bandBrickId}`;
      const support = bricksById.get(contact?.supportBrickId);
      const band = bricksById.get(contact?.bandBrickId);
      if (usedContacts.has(key) || !support || !band || !supportIds.has(support.id) || highlightIds.has(support.id)
        || !highlightIds.has(band.id) || !Number.isSafeInteger(contact.studs) || contact.studs <= 0) return inactive(model);
      const studs = overlapStuds(support, band);
      if (studs.length !== contact.studs) return inactive(model);
      usedContacts.add(key);
      groupStuds.push(...studs);
    }
    if (!groupStuds.length) return inactive(model);
    targetStuds.push(...groupStuds.map((stud) => ({ ...stud, supportGroupIndex: groupIndex })));
    const weight = groupStuds.length;
    const center = {
      x: groupStuds.reduce((sum, stud) => sum + stud.x + 0.5, 0) / weight,
      z: groupStuds.reduce((sum, stud) => sum + stud.z + 0.5, 0) / weight,
    };
    // A group's centroid can lie in a hollow support. Point at a real contacted
    // stud nearest that center so the printed arrow never targets empty air.
    const targetStud = [...groupStuds].sort((a, b) => {
      const distanceA = (a.x + 0.5 - center.x) ** 2 + (a.z + 0.5 - center.z) ** 2;
      const distanceB = (b.x + 0.5 - center.x) ** 2 + (b.z + 0.5 - center.z) ** 2;
      return distanceA - distanceB || a.x - b.x || a.z - b.z
        || a.supportBrickId.localeCompare(b.supportBrickId) || a.bandBrickId.localeCompare(b.bandBrickId);
    })[0];
    sourceArrows.push({
      supportGroupIndex: groupIndex,
      studs: weight,
      targetStud: { ...targetStud },
      x: targetStud.x + 0.5,
      z: targetStud.z + 0.5,
      targetCourse: bricksById.get(targetStud.supportBrickId).y + 1,
    });
  }

  const { studsPerVoxel = 1, coursesPerVoxel = 5 / 6, voxelMm = 8 } = model.meta?.scale ?? {};
  if (![studsPerVoxel, coursesPerVoxel, voxelMm].every((value) => Number.isFinite(value) && value > 0)) return inactive(model);
  const highlightedBricks = [...highlightIds].map((id) => bricksById.get(id));
  const liftCourses = liftCoursesFor(highlightedBricks, { studsPerVoxel, coursesPerVoxel });
  const studTopOffset = 0.9 / voxelMm;
  const lowerGap = 0.22;
  const upperGap = 0.28;
  const liftHeight = liftCourses / coursesPerVoxel;
  const arrows = sourceArrows.map(({ x, z, targetCourse, ...fields }) => {
    const targetY = targetCourse / coursesPerVoxel + studTopOffset + lowerGap;
    return {
      ...fields,
      start: { x: x / studsPerVoxel, y: targetY + liftHeight - upperGap - lowerGap, z: z / studsPerVoxel },
      end: { x: x / studsPerVoxel, y: targetY, z: z / studsPerVoxel },
    };
  });
  const previewModel = {
    ...model,
    bricks: model.bricks.map((brick) => highlightIds.has(brick.id)
      ? { ...brick, y: brick.y + liftCourses }
      : { ...brick }),
  };
  return { active: true, model: previewModel, liftCourses, arrows, targetStuds };
}
