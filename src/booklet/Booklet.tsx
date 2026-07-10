import type { VoxelGrid } from '../voxel/types.ts';
import { buildSteps, allBricks } from '../voxel/steps.ts';
import { TitlePage } from './TitlePage.tsx';
import { InventoryPage } from './InventoryPage.tsx';
import { StepPage } from './StepPage.tsx';
import { FinalPage } from './FinalPage.tsx';
import './pages.css';

type Props = {
  grid: VoxelGrid;
  term: string;
  setNumber: string;
  onReset: () => void;
};

// The unified result scroll: one manual, top to bottom. The finished iso
// model is the persistent hero; beneath it the booklet flows flush —
// parts inventory → build steps → final — with each section separated
// from the last by a single brick-weight rule instead of being boxed in
// a shadowed card. "Build another set" waits at the very end.
export function Booklet({ grid, term, setNumber, onReset }: Props) {
  const steps = buildSteps(grid);
  const finalBricks = allBricks(steps);
  return (
    <div className="result">
      <div className="result__sheet">
        <TitlePage
          bricks={finalBricks}
          term={term}
          setNumber={setNumber}
          stepCount={steps.length}
        />
        <InventoryPage bricks={finalBricks} />
        {steps.map((step, i) => (
          <StepPage key={i} step={step} number={i + 1} total={steps.length} />
        ))}
        <FinalPage bricks={finalBricks} setNumber={setNumber} onReset={onReset} />
      </div>
    </div>
  );
}
