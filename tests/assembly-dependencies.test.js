import test from 'node:test';
import assert from 'node:assert/strict';
import {orderAssemblyDependencies} from '../src/assembly-dependencies.js';

const group = (id, indexes, kind = 'detail', groupType) => ({id, indexes, kind, groupType});

test('attaches enclosed details before the covering assembly and preserves unrelated order', () => {
  const groups = [group('base',[0],'grounded'), group('roof',[1],'detail','work-surface'),
    group('upper',[2],'grounded','continuation'), group('post',[3]), group('other',[4])];
  const above = [new Set([1,2,3]),new Set([2]),new Set(),new Set([1,2]),new Set()];
  const result = orderAssemblyDependencies(groups, above);
  assert.deepEqual(result.map(g=>g.id), ['base','post','roof','upper','other']);
  assert.deepEqual(groups.map(g=>g.id), ['base','roof','upper','post','other']);
  assert.ok(result.every(g=>groups.includes(g)), 'whole assemblies retain ownership');
});

test('a cyclic assembly partition is retained for explicit failure instead of dropping dependencies', () => {
  const groups = [group('a',[0,3]), group('b',[1,2])];
  assert.equal(orderAssemblyDependencies(groups,[new Set([1]),new Set(),new Set([3]),new Set()]), groups);
});

test('detached review pieces do not become physical prerequisites', () => {
  const groups = [group('base',[0],'grounded'),group('roof',[1]),group('review',[2],'floating')];
  assert.deepEqual(orderAssemblyDependencies(groups,[new Set([1]),new Set(),new Set([1])]),groups);
});

test('does not silently change the immediate continuation scene contract', () => {
  const groups = [group('roof',[0],'detail','work-surface'), group('upper',[1],'grounded','continuation'),group('post',[2])];
  assert.equal(orderAssemblyDependencies(groups,[new Set([2]),new Set(),new Set([1])]), groups);
});
