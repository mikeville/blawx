import type { VoxelGrid } from '../voxel/types.ts';
import { buildSteps, allBricks } from '../voxel/steps.ts';
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

function displayTerm(term: string): string {
  return term.replace(/-/g, ' ');
}

// The result content below the shell's seam rule: one manual, top to
// bottom. The finished iso model is the shell's persistent stage above the
// rule; here the booklet flows flush — lead (term + counts) → parts
// inventory → build steps → final — each section separated from the last by
// a single brick-weight rule instead of being boxed in a shadowed card.
// "Build another set" waits at the very end.
export function Booklet({ grid, term, setNumber, onReset }: Props) {
  const steps = buildSteps(grid);
  const finalBricks = allBricks(steps);
  return (
    <>
      <header className="result__lead">
        <h1 className="result__term">{displayTerm(term)}</h1>
        <p className="result__meta">
          {finalBricks.length} pieces · {steps.length} steps
        </p>
      </header>
      <InventoryPage bricks={finalBricks} />
      {steps.map((step, i) => (
        <StepPage key={i} step={step} number={i + 1} total={steps.length} />
      ))}
      <FinalPage bricks={finalBricks} setNumber={setNumber} onReset={onReset} />
    </>
  );
}
