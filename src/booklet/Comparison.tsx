import type { Brick, VoxelGrid } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';
import { sampleDuck } from '../voxel/sampleDuck.ts';
import { sampleTree } from '../voxel/sampleTree.ts';
import { sampleHouse } from '../voxel/sampleHouse.ts';

type GeneratedModule = { default: VoxelGrid; term?: string };

const currentMods = import.meta.glob<GeneratedModule>('/src/voxel/generated/*.ts', {
  eager: true,
});
const baselineLlmMods = import.meta.glob<GeneratedModule>(
  '/src/voxel/generated/baseline-llm/*.ts',
  { eager: true },
);

function termFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.ts$/, '');
}

function indexByTerm(mods: Record<string, GeneratedModule>): Map<string, VoxelGrid> {
  const m = new Map<string, VoxelGrid>();
  for (const [pathKey, mod] of Object.entries(mods)) {
    m.set(mod.term ?? termFromPath(pathKey), mod.default);
  }
  return m;
}

const REFERENCES: Record<string, VoxelGrid> = {
  duck: sampleDuck,
  tree: sampleTree,
  house: sampleHouse,
};

function voxelsToCubes(grid: VoxelGrid): Brick[] {
  return grid.voxels.map(v => ({ x: v.x, y: v.y, z: v.z, w: 1, d: 1, color: v.color }));
}

function Cell({ grid }: { grid: VoxelGrid | undefined }) {
  if (!grid) {
    return <div className="cmp__cell cmp__cell--empty">—</div>;
  }
  return (
    <div className="cmp__cell">
      <Scene
        cumulative={[]}
        fresh={voxelsToCubes(grid)}
        unit={16}
        margin={10}
        style="cube"
      />
    </div>
  );
}

function ColHeader({ approachKey }: { approachKey: 'baseline-llm' | 'current' | 'reference' }) {
  const labels = {
    'baseline-llm': 'LLM-only (draft + revise)',
    current: '3D pipeline + colorize',
    reference: 'Hand-authored',
  };
  return (
    <div className="cmp__colhead">
      <div className="cmp__colhead-label">{labels[approachKey]}</div>
    </div>
  );
}

export function Comparison() {
  const current = indexByTerm(currentMods);
  const baseline = indexByTerm(baselineLlmMods);

  const allTerms = Array.from(
    new Set<string>([...current.keys(), ...baseline.keys(), ...Object.keys(REFERENCES)]),
  ).sort();

  const baselineCount = baseline.size;
  const currentCount = current.size;

  return (
    <div className="cmp">
      <header className="cmp__header">
        <h1>blawx — approach comparison</h1>
        <p>
          Finished builds (no step pages), one row per term. Cells render the voxel
          grid as plain cubes so form and palette read at a glance.
        </p>
      </header>

      <div className="cmp__totals">
        <div>
          <span className="cmp__totals-num">{currentCount}</span>
          <span className="cmp__totals-lbl">current pipeline outputs</span>
        </div>
        <div>
          <span className="cmp__totals-num">{baselineCount}</span>
          <span className="cmp__totals-lbl">baseline LLM outputs</span>
        </div>
      </div>

      <div className="cmp__table" role="table">
        <div className="cmp__row cmp__row--head" role="row">
          <div className="cmp__rowhead cmp__rowhead--corner" role="columnheader">term</div>
          <div role="columnheader"><ColHeader approachKey="baseline-llm" /></div>
          <div role="columnheader"><ColHeader approachKey="current" /></div>
          <div role="columnheader"><ColHeader approachKey="reference" /></div>
        </div>

        {allTerms.map(term => (
          <div className="cmp__row" role="row" key={term}>
            <div className="cmp__rowhead" role="rowheader">{term}</div>
            <div role="cell"><Cell grid={baseline.get(term)} /></div>
            <div role="cell"><Cell grid={current.get(term)} /></div>
            <div role="cell"><Cell grid={REFERENCES[term]} /></div>
          </div>
        ))}
      </div>

    </div>
  );
}
