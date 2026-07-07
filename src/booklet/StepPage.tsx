import type { Brick, Step } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  step: Step;
  number: number;
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

export function StepPage({ step, number }: Props) {
  const items = tally(step.newBricks);
  return (
    <div className="page page--step">
      <div className="step-numeral">{number}</div>
      <div className="callout">
        {items.map((t, i) => (
          <div className="callout-item" key={i}>
            <div className="callout-item__brick">
              <Scene cumulative={[]} fresh={[previewBrick(t)]} unit={18} margin={4} />
            </div>
            <div className="callout-item__count">{t.count}x</div>
          </div>
        ))}
      </div>
      <div className="scene">
        <Scene cumulative={step.cumulativeBricks} fresh={step.newBricks} unit={26} margin={24} />
      </div>
    </div>
  );
}
