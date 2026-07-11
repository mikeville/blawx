import type { Brick } from '../voxel/types.ts';
import type { MotionProfile } from '../design/motionProfiles.ts';
import { Scene } from './Scene.tsx';
import { useStopMotion } from './useStopMotion.ts';
import { UNIT } from './iso.ts';

type Props = {
  bricks: Brick[];
  profile: MotionProfile;
  /** Bump to replay the assembly from frame 0. */
  trigger: number;
  unit?: number;
  margin?: number;
};

// Thin wrapper: owns the shared clock (useStopMotion) and hands Scene a
// transformFor. Scene itself stays motion-ignorant — the booklet's
// static Scene call sites are untouched by this file entirely.
export function AnimatedStage({ bricks, profile, trigger, unit = UNIT, margin = 28 }: Props) {
  const { transformFor } = useStopMotion(bricks, profile, trigger, unit);
  return (
    <Scene cumulative={[]} fresh={bricks} transformFor={transformFor} unit={unit} margin={margin} />
  );
}
