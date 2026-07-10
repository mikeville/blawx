import type { Brick } from '../voxel/types.ts';
import { project, UNIT, PLATE_HEIGHT_RATIO, STUD_RADIUS_RATIO, STUD_HEIGHT_RATIO } from './iso.ts';
import { fillFor, OUTLINE } from './palette.ts';

export type BrickStyle = 'plate' | 'cube';

type Props = {
  brick: Brick;
  desaturated: boolean;
  unit?: number;
  style?: BrickStyle;
};

const STROKE = 0.65;

const HEIGHT_RATIO: Record<BrickStyle, number> = {
  plate: PLATE_HEIGHT_RATIO,
  cube: 1.0,
};

function poly(points: Array<{ x: number; y: number }>): string {
  return points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
}

export function BrickShape({ brick, desaturated, unit = UNIT, style = 'plate' }: Props) {
  const { x: bx, y: by, z: bz, w, d, color } = brick;
  const heightRatio = HEIGHT_RATIO[style];
  const yBot = by * heightRatio;
  const yTop = (by + 1) * heightRatio;
  const showStuds = style === 'plate';

  const TBL = project(bx,     yTop, bz,     unit);
  const TBR = project(bx + w, yTop, bz,     unit);
  const TFR = project(bx + w, yTop, bz + d, unit);
  const TFL = project(bx,     yTop, bz + d, unit);
  const BBR = project(bx + w, yBot, bz,     unit);
  const BFR = project(bx + w, yBot, bz + d, unit);
  const BFL = project(bx,     yBot, bz + d, unit);

  const topFill = fillFor(color, 'top', desaturated);
  const leftFill = fillFor(color, 'left', desaturated);
  const rightFill = fillFor(color, 'right', desaturated);

  const studs: Array<{ cx: number; cy: number; topCy: number }> = [];
  const studR = STUD_RADIUS_RATIO * unit;
  const studRY = studR * 0.5;
  const studLift = STUD_HEIGHT_RATIO * unit;
  for (let sx = 0; sx < w; sx++) {
    for (let sz = 0; sz < d; sz++) {
      const c = project(bx + sx + 0.5, yTop, bz + sz + 0.5, unit);
      studs.push({ cx: c.x, cy: c.y, topCy: c.y - studLift });
    }
  }

  return (
    <g
      stroke={OUTLINE}
      strokeWidth={STROKE}
      strokeLinejoin="miter"
      strokeLinecap="square"
      vectorEffect="non-scaling-stroke"
    >
      <polygon points={poly([TBR, TFR, BFR, BBR])} fill={rightFill} vectorEffect="non-scaling-stroke" />
      <polygon points={poly([TFL, TFR, BFR, BFL])} fill={leftFill} vectorEffect="non-scaling-stroke" />
      <polygon points={poly([TBL, TBR, TFR, TFL])} fill={topFill} vectorEffect="non-scaling-stroke" />
      {showStuds && studs.map((s, i) => {
        const sideLeftX = s.cx - studR;
        const sideRightX = s.cx + studR;
        return (
          <g key={i}>
            <path
              d={`M ${sideLeftX.toFixed(3)} ${s.topCy.toFixed(3)}
                  A ${studR.toFixed(3)} ${studRY.toFixed(3)} 0 0 0 ${sideRightX.toFixed(3)} ${s.topCy.toFixed(3)}
                  L ${sideRightX.toFixed(3)} ${s.cy.toFixed(3)}
                  A ${studR.toFixed(3)} ${studRY.toFixed(3)} 0 0 1 ${sideLeftX.toFixed(3)} ${s.cy.toFixed(3)}
                  Z`}
              fill={OUTLINE}
              vectorEffect="non-scaling-stroke"
            />
            <ellipse
              cx={s.cx}
              cy={s.topCy}
              rx={studR}
              ry={studRY}
              fill={topFill}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </g>
  );
}
