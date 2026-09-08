import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const byteLength = (value) => Buffer.byteLength(JSON.stringify(value), "utf8");
const percent = (numerator, denominator) => Number(((numerator / denominator) * 100).toFixed(2));
const cellKey = (x, y, z, color) => `${x},${y},${z},${color}`;

function rasterizeBoxes(boxes) {
  const cells = new Set();
  for (const { x, y, z, w, h, d, color } of boxes) {
    for (let ix = x; ix < x + w; ix += 1) {
      for (let iy = y; iy < y + h; iy += 1) {
        for (let iz = z; iz < z + d; iz += 1) cells.add(cellKey(ix, iy, iz, color));
      }
    }
  }
  return cells;
}

function expandPosts([type, x, y, z, w, h, d, thickness, color]) {
  assert.equal(type, "posts");
  return [
    { type: "box", x, y, z, w: thickness, h, d: thickness, color },
    { type: "box", x: x + w - thickness, y, z, w: thickness, h, d: thickness, color },
    { type: "box", x, y, z: z + d - thickness, w: thickness, h, d: thickness, color },
    { type: "box", x: x + w - thickness, y, z: z + d - thickness, w: thickness, h, d: thickness, color },
  ];
}

function squaredDistanceToSegment(point, start, end) {
  const segment = end.map((value, index) => value - start[index]);
  const offset = point.map((value, index) => value - start[index]);
  const squaredLength = segment.reduce((sum, value) => sum + value * value, 0);
  const projection = squaredLength === 0
    ? 0
    : Math.max(0, Math.min(1, offset.reduce((sum, value, index) => sum + value * segment[index], 0) / squaredLength));
  return point.reduce((sum, value, index) => {
    const delta = value - (start[index] + projection * segment[index]);
    return sum + delta * delta;
  }, 0);
}

function rasterizeStroke([type, color, radius, points]) {
  assert.equal(type, "stroke");
  const cells = new Set();
  const radiusSquared = radius * radius;
  for (let x = 0; x <= 63; x += 1) {
    for (let y = 0; y <= 63; y += 1) {
      for (let z = 0; z <= 63; z += 1) {
        const center = [x + 0.5, y + 0.5, z + 0.5];
        for (let index = 0; index < points.length - 1; index += 1) {
          if (squaredDistanceToSegment(center, points[index], points[index + 1]) <= radiusSquared) {
            cells.add(cellKey(x, y, z, color));
            break;
          }
        }
      }
    }
  }
  return cells;
}

function overlap(before, after) {
  let intersection = 0;
  for (const cell of before) if (after.has(cell)) intersection += 1;
  const union = before.size + after.size - intersection;
  return {
    cellsBefore: before.size,
    cellsAfter: after.size,
    intersection,
    union,
    iou: Number((intersection / union).toFixed(6)),
    added: after.size - intersection,
    removed: before.size - intersection,
  };
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
const args=process.argv.slice(2),value=flag=>{const index=args.indexOf(flag);return index===-1?null:args[index+1];};
const cityPath=value('--city-source'),creaturePath=value('--creature-source'),outputPath=value('--output');
if(!cityPath||!creaturePath||!outputPath) throw new Error('Usage: node scripts/audit-higher-level-geometry.mjs --city-source FILE --creature-source FILE --output FILE');
const [{ source: city, sourcePath: citySourcePath }, { source: creature, sourcePath: creatureSourcePath }] = await Promise.all([
  readFile(cityPath,'utf8').then(text=>({source:JSON.parse(text),sourcePath:'explicit-city-input'})),
  readFile(creaturePath,'utf8').then(text=>({source:JSON.parse(text),sourcePath:'explicit-creature-input'})),
]);

const postsIndices = [16, 17, 18, 19];
const sourcePosts = postsIndices.map((index) => city.operations[index]);
const postsCandidate = ["posts", 3, 4, 24, 12, 13, 13, 2, "t"];
const expandedPosts = expandPosts(["posts", 3, 4, 24, 12, 13, 13, 2, "tan"]);
assert.deepEqual(expandedPosts, sourcePosts);
const sourcePostCells = rasterizeBoxes(sourcePosts);
const expandedPostCells = rasterizeBoxes(expandedPosts);
assert.deepEqual(expandedPostCells, sourcePostCells);
const postsBaseline = sourcePosts.map(({ x, y, z, w, h, d }) => ["b", x, y, z, w, h, d, "t"]);

const strokeIndices = [4, 5, 6, 7, 8];
const sourceTentacle = strokeIndices.map((index) => creature.operations[index]);
const strokePoints = sourceTentacle.map(({ x, y, z, w, h, d }) => [x + w / 2, y + h / 2, z + d / 2]);
const strokeCandidate = ["stroke", "r", 1.5, strokePoints];
const sourceTentacleCells = rasterizeBoxes(sourceTentacle);
const strokeCells = rasterizeStroke(["stroke", "red", 1.5, strokePoints]);
const strokeBaseline = sourceTentacle.map(({ x, y, z, w, h, d }) => ["b", x, y, z, w, h, d, "r"]);

const report = {
  scope: "Bounded offline description-size and rasterization audit of two accepted-model subassemblies. No model calls, viewer changes, prompt changes, published-model changes, geometry repairs, screenshots, builds, or model tests.",
  measurement: {
    descriptionSize: "UTF-8 bytes of JSON.stringify output (minified JSON), using numeric array notation and one-character type/color symbols for baseline boxes; candidate operation names remain the proposed 'posts' and 'stroke' names.",
    voxelCoordinates: "Integer box origins cover unit cells through origin + extent - 1. Stroke tests cell centers on the inclusive 0..63 scan cube.",
  },
  cases: [
    {
      label: "Shape06 corner posts",
      provenance: {
        sourcePath: citySourcePath,
        sourceOperationIndicesZeroBased: postsIndices,
        sourceOperationCount: city.operations.length,
        selectedOperationCount: sourcePosts.length,
        selectedOperationFractionPercent: percent(sourcePosts.length, city.operations.length),
      },
      baseline: postsBaseline,
      candidate: postsCandidate,
      expansion: "Four boxes in original order: low-z left/right, then high-z left/right.",
      bytes: {
        baseline: byteLength(postsBaseline),
        candidate: byteLength(postsCandidate),
        saved: byteLength(postsBaseline) - byteLength(postsCandidate),
        reductionPercent: percent(byteLength(postsBaseline) - byteLength(postsCandidate), byteLength(postsBaseline)),
      },
      geometry: {
        coloredCells: sourcePostCells.size,
        expandedBoxesEqualSourceOperations: true,
        exactColoredCellSetsEqual: true,
      },
    },
    {
      label: "Shape07 first tentacle",
      provenance: {
        sourcePath: creatureSourcePath,
        sourceOperationIndicesZeroBased: strokeIndices,
        sourceOperationCount: creature.operations.length,
        selectedOperationCount: sourceTentacle.length,
        selectedOperationFractionPercent: percent(sourceTentacle.length, creature.operations.length),
      },
      baseline: strokeBaseline,
      candidate: strokeCandidate,
      rasterization: "A cell is included when its center is within radius 1.5 of any finite polyline segment, using the clamped closest point; this includes spherical ends.",
      bytes: {
        baseline: byteLength(strokeBaseline),
        candidate: byteLength(strokeCandidate),
        saved: byteLength(strokeBaseline) - byteLength(strokeCandidate),
        reductionPercent: percent(byteLength(strokeBaseline) - byteLength(strokeCandidate), byteLength(strokeBaseline)),
      },
      geometry: overlap(sourceTentacleCells, strokeCells),
    },
  ],
  caveats: [
    "The posts case is an exact macro expansion for this one regular four-box arrangement; it does not establish prevalence across the scene or corpus.",
    "The stroke candidate deliberately changes geometry. IoU measures voxel overlap only and is not evidence of visual equivalence or accepted quality.",
    "Each candidate covers only a tiny fraction of its full source scene by operation count, so these byte reductions cannot be extrapolated to full-scene prompt size, token count, generation latency, or quality.",
    "Byte counts are not token counts and do not predict model latency.",
  ],
};

await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.cases.map(({ label, bytes, geometry }) => ({ label, bytes, geometry })), null, 2));
}
