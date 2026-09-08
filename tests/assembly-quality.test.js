import test from 'node:test';
import assert from 'node:assert/strict';
import { assessAssemblyQuality, orderQualityRejections } from '../src/assembly-quality.js';

test('late foundations and downward returns are measured inside each successful module only', () => {
  const bricks = [0, 3, 0, 0, 8, 0].map((y, index) => ({ id: `b${index}`, y }));
  const steps = bricks.map((brick, index) => ({ id: `s${index}`, moduleId: index < 3 ? 'a' : 'b',
    kind: index === 4 ? 'unresolved' : 'build', newBrickIds: [brick.id], issues: [] }));
  const result = assessAssemblyQuality({bricks, steps, stats: {unresolvedBrickCount:1, rootFailureCount:1, blockedJoinCount:0}});
  assert.equal(result.lateFoundationCount, 1);
  assert.equal(result.downwardReturnCount, 1);
  assert.equal(result.downwardCourseDistance, 3);
  assert.equal(result.lateFoundations[0].stepId, 's2');
  assert.deepEqual(orderQualityRejections(result, {...result, lateFoundationCount:2}), ['lateFoundationCount increased']);
});
