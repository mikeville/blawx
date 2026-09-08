import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyPlan } from '../src/assembly.js';
import { sequenceAssembly } from '../src/assembly-sequence.js';

const brick = (x,y,w=1) => ({x,y,z:0,w,d:1,color:'red'});
test('downstream sequence resolves a clear underside attachment without changing placements or baseline', () => {
  const brickModel = {version:1,kind:'bricks',bricks:[brick(0,0),brick(0,1),brick(0,2,2),brick(1,1)]};
  const baselinePlan = createAssemblyPlan({brickModel});
  const original = JSON.stringify({brickModel,baselinePlan});
  const result = sequenceAssembly({brickModel,baselinePlan});
  assert.equal(result.comparison.selectedPolicy,'bounded-under-attachments');
  assert.equal(result.plan.stats.rootFailureCount,0);
  assert.equal(result.plan.stats.unresolvedBrickCount,0);
  assert.equal(result.comparison.upwardStepCount,1);
  assert.deepEqual(result.plan.bricks,baselinePlan.bricks);
  assert.equal(JSON.stringify({brickModel,baselinePlan}),original);
});

test('unchanged sequence retains the original plan and reports local timing', () => {
  const brickModel = {version:1,kind:'bricks',bricks:[brick(0,0),brick(0,1)]};
  const baselinePlan = createAssemblyPlan({brickModel});
  const result = sequenceAssembly({brickModel,baselinePlan});
  assert.equal(result.plan,baselinePlan);
  assert.equal(result.comparison.selectedPolicy,'downward-only');
  assert.equal(result.comparison.upwardStepCount,0);
  assert.ok(result.comparison.sequencingMs >= 0);
});
