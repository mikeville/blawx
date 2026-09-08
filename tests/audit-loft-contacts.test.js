import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { auditCellPair, auditProgram, connectedComponents } from '../scripts/audit-loft-contacts.mjs';

test('contact audit distinguishes overlap, face contact, and a gap', () => {
  const origin = [{ x: 0, y: 0, z: 0 }];
  assert.deepEqual(auditCellPair(origin, origin), {
    comparisons: 1, overlapCellCount: 1, sharedFaceCount: 0, nearestManhattanCellDistance: 0,
  });
  assert.deepEqual(auditCellPair(origin, [{ x: 1, y: 0, z: 0 }]), {
    comparisons: 1, overlapCellCount: 0, sharedFaceCount: 1, nearestManhattanCellDistance: 1,
  });
  assert.deepEqual(auditCellPair(origin, [{ x: 2, y: 0, z: 0 }]), {
    comparisons: 1, overlapCellCount: 0, sharedFaceCount: 0, nearestManhattanCellDistance: 2,
  });
});

test('components retain final last-writing-operation attribution', () => {
  const components = connectedComponents([
    { x: 0, y: 0, z: 0, lastWritingOp: 1 },
    { x: 1, y: 0, z: 0, lastWritingOp: 2 },
    { x: 4, y: 0, z: 0, lastWritingOp: 3 },
  ]);
  assert.deepEqual(components, [
    { cellCount: 2, lastWritingOpCellCounts: [{ opIndex: 1, cellCount: 1 }, { opIndex: 2, cellCount: 1 }] },
    { cellCount: 1, lastWritingOpCellCounts: [{ opIndex: 3, cellCount: 1 }] },
  ]);
});

test('pair comparison guard rejects unbounded work', () => {
  assert.throws(() => auditCellPair(new Array(2).fill({ x: 0, y: 0, z: 0 }), new Array(2).fill({ x: 1, y: 0, z: 0 }), 3), /limit is 3/);
});

test('an empty cell set reports no finite pair distance explicitly', () => {
  assert.deepEqual(auditCellPair([], [{ x: 0, y: 0, z: 0 }]), {
    comparisons: 0, overlapCellCount: 0, sharedFaceCount: 0, nearestManhattanCellDistance: null,
  });
});

test('a generic source is completed without Shape39 hypotheses', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'loft-contact-audit-'));
  const sourcePath = path.join(directory, 'source.json');
  const outputPath = path.join(directory, 'report.json');
  try {
    await writeFile(sourcePath, JSON.stringify({ ops: [
      ['b', 0, 0, 0, 1, 1, 1, 'R'],
      ['b', 1, 0, 0, 1, 1, 1, 'B'],
    ] }));
    const report = await auditProgram({ sourcePath, outputPath, pairs: [[1, 2]] });
    assert.equal(report.status, 'completed');
    assert.equal(Object.hasOwn(report, 'parentHypotheses'), false);
    assert.deepEqual(JSON.parse(await readFile(outputPath, 'utf8')), report);
  } finally {
    await rm(directory, { recursive: true });
  }
});
