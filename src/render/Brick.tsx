import type { Brick } from '../voxel/types.ts';
import { project, UNIT, PLATE_HEIGHT_RATIO, STUD_RADIUS_RATIO, STUD_HEIGHT_RATIO } from './iso.ts';
import { fillFor, OUTLINE } from './palette.ts';

export type BrickStyle = 'plate' | 'cube' | 'brick';

type Props = {
  brick: Brick;
  desaturated: boolean;
  unit?: number;
  style?: BrickStyle;
};

// Brick outline weight, expressed as a fraction of one voxel unit rather
// than a fixed screen width. Combined with a *scaling* stroke (no
// vectorEffect), the on-screen outline is proportional to the brick's
// on-screen size at every scale: a full 16³ model that fits into the
// scroll gets a fine outline, a single 1×1 preview brick gets a heavier
// one, and both read as the same manual line. This replaces the old
// non-scaling 0.65px stroke, which held constant screen width and so read
// proportionally heavy once the whole model was scaled down to fit.
const STROKE_RATIO = 0.04;

const HEIGHT_RATIO: Record<BrickStyle, number> = {
  plate: PLATE_HEIGHT_RATIO,
  cube: 1.0,
  // A real LEGO brick is ~1.2x as tall as a stud is wide and 3x a plate's
  // height; we render it at a full unit cube (1.0) so stacked voxels read as
  // stacked bricks while keeping the generated silhouette proportions (the
  // 16x16 front mask is square). Resolves the old 0.8 plate ratio, which
  // read ambiguously as brick-or-plate.
  brick: 1.0,
};

function poly(points: Array<{ x: number; y: number }>): string {
  return points.map(p => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(' ');
}

export function BrickShape({ brick, desaturated, unit = UNIT, style = 'brick' }: Props) {
  const { x: bx, y: by, z: bz, w, d, color } = brick;
  const stroke = unit * STROKE_RATIO;
  const heightRatio = HEIGHT_RATIO[style];
  const yBot = by * heightRatio;
  const yTop = (by + 1) * heightRatio;
  const showStuds = style === 'plate' || style === 'brick';

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
      strokeWidth={stroke}
      strokeLinejoin="miter"
      strokeLinecap="square"
    >
      <polygon points={poly([TBR, TFR, BFR, BBR])} fill={rightFill} />
      <polygon points={poly([TFL, TFR, BFR, BFL])} fill={leftFill} />
      <polygon points={poly([TBL, TBR, TFR, TFL])} fill={topFill} />
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
            />
            <ellipse
              cx={s.cx}
              cy={s.topCy}
              rx={studR}
              ry={studRY}
              fill={topFill}
            />
          </g>
        );
      })}
    </g>
  );
}
