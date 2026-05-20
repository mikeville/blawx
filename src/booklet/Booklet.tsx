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
      <div className="page-wrap page-wrap--span">
        <TitlePage bricks={finalBricks} setNumber={setNumber} />
      </div>
      <div className="page-wrap">
        <InventoryPage bricks={finalBricks} />
      </div>
      {steps.map((step, i) => (
        <div key={i} className="page-wrap">
          <StepPage step={step} number={i + 1} />
        </div>
      ))}
      <div className="page-wrap page-wrap--span">
        <FinalPage bricks={finalBricks} setNumber={setNumber} />
      </div>
    </div>
  );
}
