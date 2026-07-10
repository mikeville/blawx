import type { Brick } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  bricks: Brick[];
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
  const order: Brick['color'][] = ['yellow', 'red', 'blue', 'green', 'white', 'lightGray', 'black'];
  return [...map.values()].sort((a, b) => {
    const co = order.indexOf(a.color) - order.indexOf(b.color);
    if (co !== 0) return co;
    return (b.w * b.d) - (a.w * a.d);
  });
}

function previewBrick(t: Tally): Brick {
  return { x: 0, y: 0, z: 0, w: t.w, d: t.d, color: t.color };
}

// Parts inventory — the manual's first content page. A flat grid of every
// distinct brick with its count. No frame; the bricks sit on the paper.
export function InventoryPage({ bricks }: Props) {
  const items = tally(bricks);
  return (
    <section className="page page--inventory">
      <p className="section-label">Parts</p>
      <div className="inventory-grid">
        {items.map((t, i) => (
          <div className="inventory-cell" key={i}>
            <div className="inventory-cell__brick">
              <Scene cumulative={[]} fresh={[previewBrick(t)]} unit={24} margin={6} />
            </div>
            <div className="inventory-cell__count">{t.count}×</div>
          </div>
        ))}
      </div>
    </section>
  );
}
