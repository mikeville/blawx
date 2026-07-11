import type { Brick } from '../voxel/types.ts';
import { project, UNIT, PLATE_HEIGHT_RATIO } from './iso.ts';
import { BrickShape, type BrickStyle } from './Brick.tsx';

type Props = {
  cumulative: Brick[];
  fresh: Brick[];
  unit?: number;
  margin?: number;
  width?: number;
  height?: number;
  style?: BrickStyle;
  // Optional per-brick transform hook for the stop-motion harness
  // (see render/useStopMotion.ts). Absent for every existing caller —
  // the booklet's static pages must render byte-identical to before, so
  // this only wraps a brick in an extra <g> when actually supplied.
  transformFor?: (brick: Brick, index: number) => { transform?: string; opacity?: number } | undefined;
};

const HEIGHT_RATIO: Record<BrickStyle, number> = {
  plate: PLATE_HEIGHT_RATIO,
  cube: 1.0,
};

type Sortable = { brick: Brick; desaturated: boolean };

function depthKey(b: Brick): number {
  return b.y * 1000 + (b.x + b.z);
}

function computeExtents(bricks: Brick[], unit: number, heightRatio: number) {
  if (bricks.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const b of bricks) {
    const yBot = b.y * heightRatio;
    const yTop = (b.y + 1) * heightRatio;
    const corners = [
      project(b.x,         yBot, b.z,         unit),
      project(b.x + b.w,   yBot, b.z,         unit),
      project(b.x + b.w,   yBot, b.z + b.d,   unit),
      project(b.x,         yBot, b.z + b.d,   unit),
      project(b.x,         yTop, b.z,         unit),
      project(b.x + b.w,   yTop, b.z,         unit),
      project(b.x + b.w,   yTop, b.z + b.d,   unit),
      project(b.x,         yTop, b.z + b.d,   unit),
    ];
    for (const p of corners) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, maxX, minY, maxY };
}

export function Scene({
  cumulative,
  fresh,
  unit = UNIT,
  margin = 28,
  width,
  height,
  style = 'plate',
  transformFor,
}: Props) {
  const items: Sortable[] = [
    ...cumulative.map(brick => ({ brick, desaturated: true })),
    ...fresh.map(brick => ({ brick, desaturated: false })),
  ];
  items.sort((a, b) => depthKey(a.brick) - depthKey(b.brick));

  const allBricks = items.map(i => i.brick);
  const ext = computeExtents(allBricks, unit, HEIGHT_RATIO[style]);
  const vbX = ext.minX - margin;
  const vbY = ext.minY - margin;
  const vbW = ext.maxX - ext.minX + margin * 2;
  const vbH = ext.maxY - ext.minY + margin * 2;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width={width}
      height={height}
      preserveAspectRatio="xMidYMid meet"
      shapeRendering="geometricPrecision"
    >
      {items.map(({ brick, desaturated }, i) => {
        if (!transformFor) {
          return <BrickShape key={i} brick={brick} desaturated={desaturated} unit={unit} style={style} />;
        }
        const t = transformFor(brick, i);
        return (
          <g key={i} transform={t?.transform} opacity={t?.opacity}>
            <BrickShape brick={brick} desaturated={desaturated} unit={unit} style={style} />
          </g>
        );
      })}
    </svg>
  );
}
