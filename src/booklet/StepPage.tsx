import type { Brick, Step } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  step: Step;
  number: number;
  total: number;
};

type Tally = { color: Brick['color']; w: 1 | 2; d: 1 | 2; count: number };

function tally(bricks: Brick[]): Tally[] {
  const map = new Map<string, Tally>();
  for (const b of bricks) {
    const key = `${b.color}-${b.w}x${b.d}`;
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { color: b.color, w: b.w, d: b.d, count: 1 });
  }
  return [...map.values()].sort((a, b) => (b.w * b.d) - (a.w * a.d));
}

function previewBrick(t: Tally): Brick {
  return { x: 0, y: 0, z: 0, w: t.w, d: t.d, color: t.color };
}

// One build step, flush on the page: a giant flat step numeral, the parts
// added this step (as small iso bricks with counts, no frame), then the
// assembly view — new bricks in full colour on top of the desaturated
// cumulative model.
export function StepPage({ step, number, total }: Props) {
  const items = tally(step.newBricks);
  return (
    <section className="page page--step">
      <header className="step-head">
        <span className="step-numeral">{number}</span>
        <span className="step-progress">of {total}</span>
      </header>
      <div className="callout">
        {items.map((t, i) => (
          <div className="callout-item" key={i}>
            <div className="callout-item__brick">
              <Scene cumulative={[]} fresh={[previewBrick(t)]} unit={16} margin={4} />
            </div>
            <div className="callout-item__count">{t.count}×</div>
          </div>
        ))}
      </div>
      <div className="scene">
        <Scene cumulative={step.cumulativeBricks} fresh={step.newBricks} unit={22} margin={16} />
      </div>
    </section>
  );
}
