import test from 'node:test';
import assert from 'node:assert/strict';
import { expandLoftProgram } from '../src/loft-program.js';
import { repairLoftDiagonals } from '../scripts/repair-loft-diagonals.mjs';

const diagonal = (symbol = 'R', offset = 0) => ['l', 'x', 'box', symbol, [
  [offset, 0.5, 0.5, 1, 1],
  [offset + 2, 1.5, 0.5, 1, 1],
]];

test('joins an internally diagonal loft with one deterministic face bridge', () => {
  const result = repairLoftDiagonals({ ops: [diagonal()] });
  assert.deepEqual(result.additions, [{ x: 1, y: 0, z: 0, color: 'red' }]);
  assert.equal(result.report.lofts[0].componentCountBefore, 2);
  assert.equal(result.report.lofts[0].componentCountAfter, 1);
});

test('leaves an already face-connected loft unchanged', () => {
  const program = { ops: [['l', 'x', 'box', 'R', [[0, 0.5, 0.5, 1, 1], [2, 0.5, 0.5, 1, 1]]]] };
  const result = repairLoftDiagonals(program);
  assert.deepEqual(result.additions, []);
  assert.deepEqual(result.model.cells, expandLoftProgram(program).cells);
});

test('does not bridge distant separated regions', () => {
  const program = { ops: [['l', 'x', 'box', 'R', [[0, 0.5, 0.5, 1, 1], [2, 5.5, 0.5, 1, 1]]]] };
  const result = repairLoftDiagonals(program);
  assert.equal(result.additions.length, 0);
  assert.equal(result.report.lofts[0].residualDisconnected, true);
});

test('preserves original colors and skips a bridge occupied by another color', () => {
  const program = { ops: [
    diagonal('R'),
    ['b', 1, 0, 0, 1, 1, 1, 'B'],
    ['b', 0, 1, 0, 1, 1, 1, 'B'],
  ] };
  const original = expandLoftProgram(program);
  const result = repairLoftDiagonals(program);
  assert.deepEqual(result.additions, []);
  assert.deepEqual(result.model.cells, original.cells);
  assert.equal(result.model.cells.find(cell => cell.x === 1 && cell.y === 0 && cell.z === 0).color, 'blue');
  assert.equal(result.report.lofts[0].residualDisconnected, true);
});

test('honors the cap and chooses lower y then x/z deterministically', () => {
  const program = { ops: [diagonal('R'), ['l', 'x', 'box', 'R', [[3, 2.5, 0.5, 1, 1], [5, 3.5, 0.5, 1, 1]]]] };
  const first = repairLoftDiagonals(program, { maxAddedCells: 1 });
  const second = repairLoftDiagonals(program, { maxAddedCells: 1 });
  assert.deepEqual(first.additions, [{ x: 1, y: 0, z: 0, color: 'red' }]);
  assert.deepEqual(second.additions, first.additions);
  assert.equal(first.report.capReached, true);
  assert.equal(first.report.residualDisconnectedLoftCount, 1);
});
