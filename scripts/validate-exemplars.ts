// Sanity-check the hand-authored exemplars (see exemplars.ts): confirm each
// one's three masks lift cleanly under the strict hull (zero reprojection
// loss) and that the declared bounds line matches the lifted voxels' actual
// extents. Also renders each hull to a PNG fixture for eyeballing.
//
// Usage: npx tsx scripts/validate-exemplars.ts

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { liftHull } from '../src/bench/hull.ts';
import { renderIsoSVG } from '../src/bench/isoRender.ts';
import type { Mask } from '../src/bench/encodings.ts';
import { EXEMPLARS, type Exemplar } from './exemplars.ts';

const SIZE = 8;
const FIXTURES_DIR = join(import.meta.dirname, '..', 'runs', 'fixtures');

function rowsToMask(rows: string[], label: string, view: string): Mask {
  if (rows.length !== SIZE) {
    throw new Error(`${label}/${view}: expected ${SIZE} rows, got ${rows.length}`);
  }
  return rows.map((row, i) => {
    if (row.length !== SIZE || !/^[#.]+$/.test(row)) {
      throw new Error(`${label}/${view}: row ${i} is not exactly ${SIZE} chars of '#'/'.': ${JSON.stringify(row)}`);
    }
    return [...row].map((ch) => ch === '#');
  });
}

function parseBounds(bounds: string): { x: [number, number]; y: [number, number]; z: [number, number] } {
  const m = bounds.match(/^bounds x:(\d+)-(\d+) y:(\d+)-(\d+) z:(\d+)-(\d+)$/);
  if (!m) throw new Error(`unparseable bounds string: ${JSON.stringify(bounds)}`);
  const [, x0, x1, y0, y1, z0, z1] = m;
  return {
    x: [Number(x0), Number(x1)],
    y: [Number(y0), Number(y1)],
    z: [Number(z0), Number(z1)],
  };
}

function computeExtent(voxels: readonly (readonly [number, number, number])[]): {
  x: [number, number];
  y: [number, number];
  z: [number, number];
} {
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;
  for (const [x, y, z] of voxels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { x: [minX, maxX], y: [minY, maxY], z: [minZ, maxZ] };
}

function fail(msg: string): never {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

mkdirSync(FIXTURES_DIR, { recursive: true });

function validate(exemplar: Exemplar): void {
  const { label, bounds, front, side, top } = exemplar;

  const frontMask = rowsToMask(front, label, 'front');
  const sideMask = rowsToMask(side, label, 'side');
  const topMask = rowsToMask(top, label, 'top');

  const { voxels, reprojectionLoss } = liftHull(frontMask, sideMask, topMask, SIZE);

  if (voxels.length === 0) fail(`${label}: liftHull produced zero voxels`);

  if (reprojectionLoss.front !== 0 || reprojectionLoss.side !== 0 || reprojectionLoss.top !== 0) {
    fail(
      `${label}: nonzero reprojection loss — front:${reprojectionLoss.front} side:${reprojectionLoss.side} top:${reprojectionLoss.top}`,
    );
  }

  const declared = parseBounds(bounds);
  const computed = computeExtent(voxels);
  for (const axis of ['x', 'y', 'z'] as const) {
    const [dMin, dMax] = declared[axis];
    const [cMin, cMax] = computed[axis];
    if (dMin !== cMin || dMax !== cMax) {
      fail(
        `${label}: bounds mismatch on ${axis} — declared ${dMin}-${dMax}, computed ${cMin}-${cMax} (full declared: ${bounds})`,
      );
    }
  }

  const svg = renderIsoSVG(voxels);
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } }).render().asPng();
  const outPath = join(FIXTURES_DIR, `exemplar-${label}.png`);
  writeFileSync(outPath, png);

  console.log(
    `${label}: ${voxels.length} voxels, losses front:${reprojectionLoss.front} side:${reprojectionLoss.side} top:${reprojectionLoss.top}, bounds OK`,
  );
}

for (const exemplar of EXEMPLARS) {
  validate(exemplar);
}
