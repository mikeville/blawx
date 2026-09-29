// Preserve the established underside orientation when it exposes every addition.
const UNDERSIDE_ELEVATION = -Math.PI / 7;
const UPWARD_AZIMUTHS = Object.freeze([
  Math.PI * 0.75,
  Math.PI * 1.25,
  Math.PI * 1.75,
  Math.PI * 0.25,
]);
const MAX_VISIBILITY_RAY_TESTS = 250_000;
const MAX_VISIBILITY_BODIES = Math.floor(MAX_VISIBILITY_RAY_TESTS / (UPWARD_AZIMUTHS.length * 9));

function bodyBox(body) {
  return {
    id: body.id,
    min: { x: body.x - body.w / 2, y: body.y - body.h / 2, z: body.z - body.d / 2 },
    max: { x: body.x + body.w / 2, y: body.y + body.h / 2, z: body.z + body.d / 2 },
  };
}

function bodyVisibilitySamples(box) {
  const center = {
    x: (box.min.x + box.max.x) / 2,
    y: (box.min.y + box.max.y) / 2,
    z: (box.min.z + box.max.z) / 2,
    weight: 4,
  };
  const corners = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push({ x, y, z, weight: 1 });
    }
  }
  return [center, ...corners];
}

function rayHitsBox(origin, direction, box) {
  let near = -Infinity;
  let far = Infinity;
  for (const axis of ['x', 'y', 'z']) {
    if (Math.abs(direction[axis]) < 1e-9) {
      if (origin[axis] < box.min[axis] || origin[axis] > box.max[axis]) return false;
      continue;
    }
    const inverse = 1 / direction[axis];
    let first = (box.min[axis] - origin[axis]) * inverse;
    let second = (box.max[axis] - origin[axis]) * inverse;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return false;
  }
  return far > 1e-5;
}

function visibilityScore(sampledBoxes, allBoxes, azimuth) {
  const horizontal = Math.cos(UNDERSIDE_ELEVATION);
  const direction = {
    x: Math.sin(azimuth) * horizontal,
    y: Math.sin(UNDERSIDE_ELEVATION),
    z: Math.cos(azimuth) * horizontal,
  };
  let score = 0;
  for (const sampled of sampledBoxes) {
    for (const point of bodyVisibilitySamples(sampled)) {
      const origin = {
        x: point.x + direction.x * 1e-4,
        y: point.y + direction.y * 1e-4,
        z: point.z + direction.z * 1e-4,
      };
      const hidden = allBoxes.some(box => box !== sampled && rayHitsBox(origin, direction, box));
      if (!hidden) score += point.weight;
    }
  }
  return score;
}

function evenlySample(items, count) {
  if (items.length <= count) return items;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => items[Math.floor(index * items.length / count)]);
}

export function chooseUpwardInsertionAzimuth(bodies, highlightIds) {
  const bodyBoxes = bodies.map(bodyBox);
  let highlighted = bodyBoxes.filter(box => highlightIds?.has(box.id));
  let boxes = bodyBoxes;
  if (!highlighted.length || boxes.length < 2) return UPWARD_AZIMUTHS[0];

  if (boxes.length > MAX_VISIBILITY_BODIES) {
    const retainedHighlighted = evenlySample(highlighted, Math.min(64, MAX_VISIBILITY_BODIES));
    const context = bodyBoxes.filter(box => !highlightIds.has(box.id));
    boxes = [...retainedHighlighted, ...evenlySample(context, MAX_VISIBILITY_BODIES - retainedHighlighted.length)];
    highlighted = retainedHighlighted;
  }

  // Bound worst-case local work while sampling the highlighted geometry evenly.
  const perBodyTests = UPWARD_AZIMUTHS.length * 9 * boxes.length;
  const sampleCount = Math.max(1, Math.min(highlighted.length, Math.floor(MAX_VISIBILITY_RAY_TESTS / perBodyTests)));
  const sampled = sampleCount === highlighted.length
    ? highlighted
    : evenlySample(highlighted, sampleCount);
  let bestAzimuth = UPWARD_AZIMUTHS[0];
  let bestScore = -1;
  for (const azimuth of UPWARD_AZIMUTHS) {
    const score = visibilityScore(sampled, boxes, azimuth);
    if (score > bestScore) {
      bestScore = score;
      bestAzimuth = azimuth;
    }
  }
  return bestAzimuth;
}

