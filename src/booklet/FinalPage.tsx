import type { Brick } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  bricks: Brick[];
  setNumber: string;
  onReset: () => void;
};

// The last page: the finished build again as the payoff, its set number,
// and the single way out of the scroll — "Build another set" lands here,
// at the natural finish point, instead of an outward nav bar.
export function FinalPage({ bricks, setNumber, onReset }: Props) {
  return (
    <section className="page page--final">
      <div className="hero">
        <Scene cumulative={[]} fresh={bricks} unit={24} margin={12} />
      </div>
      <p className="final__done">Set complete.</p>
      <p className="final__set">{setNumber}</p>
      <button type="button" className="final__again" onClick={onReset}>
        Build another set
      </button>
    </section>
  );
}
