import type { VoxelGrid } from '../voxel/types.ts';
import { buildSteps, allBricks } from '../voxel/steps.ts';
import { TitlePage } from './TitlePage.tsx';
import { InventoryPage } from './InventoryPage.tsx';
import { StepPage } from './StepPage.tsx';
import { FinalPage } from './FinalPage.tsx';
import './pages.css';

type Props = {
  grid: VoxelGrid;
  setNumber: string;
};

export function Booklet({ grid, setNumber }: Props) {
  const steps = buildSteps(grid);
  const finalBricks = allBricks(steps);
  return (
    <div className="booklet">
      <TitlePage bricks={finalBricks} setNumber={setNumber} />
      <InventoryPage bricks={finalBricks} />
      {steps.map((step, i) => (
        <StepPage key={i} step={step} number={i + 1} />
      ))}
      <FinalPage bricks={finalBricks} setNumber={setNumber} />
    </div>
  );
}
