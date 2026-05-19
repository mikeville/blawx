import type { Brick } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  bricks: Brick[];
  setNumber: string;
};

export function FinalPage({ bricks, setNumber }: Props) {
  return (
    <div className="page page--final">
      <div className="page__inner">
        <div className="hero">
          <Scene cumulative={[]} fresh={bricks} unit={36} margin={20} />
        </div>
      </div>
      <div className="set-number">{setNumber}</div>
    </div>
  );
}
