import type { Brick, Step, VoxelGrid } from './types.ts';
import { packLayer } from './pack.ts';

export const STEP_BRICK_CAP = 6;

function splitByXMidline(bricks: Brick[]): Brick[][] {
  if (bricks.length <= STEP_BRICK_CAP) return [bricks];
  const xs = bricks.map(b => b.x);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const mid = (minX + maxX) / 2;
  const low = bricks.filter(b => b.x <= mid);
  const high = bricks.filter(b => b.x > mid);
  if (low.length === 0 || high.length === 0) return [bricks];
  const out: Brick[][] = [];
  for (const half of [low, high]) {
    if (half.length > STEP_BRICK_CAP) out.push(...splitByXMidline(half));
    else out.push(half);
  }
  return out;
}

export function buildSteps(grid: VoxelGrid): Step[] {
  const voxelsByLayer = new Map<number, typeof grid.voxels>();
  for (const v of grid.voxels) {
    const arr = voxelsByLayer.get(v.y);
    if (arr) arr.push(v);
    else voxelsByLayer.set(v.y, [v]);
  }

  const ys = [...voxelsByLayer.keys()].sort((a, b) => a - b);
  const steps: Step[] = [];
  const cumulative: Brick[] = [];

  for (const y of ys) {
    const layerBricks = packLayer(voxelsByLayer.get(y)!);
    if (layerBricks.length === 0) continue;
    const stepGroups = splitByXMidline(layerBricks);
    for (const group of stepGroups) {
      steps.push({
        newBricks: group,
        cumulativeBricks: [...cumulative],
      });
      cumulative.push(...group);
    }
  }
  return steps;
}

export function allBricks(steps: Step[]): Brick[] {
  if (steps.length === 0) return [];
  const last = steps[steps.length - 1]!;
  return [...last.cumulativeBricks, ...last.newBricks];
}
