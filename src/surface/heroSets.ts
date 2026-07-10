import { seed4ToGrid, type Seed4Json } from '../voxel/seed4.ts';
import { buildSteps, allBricks } from '../voxel/steps.ts';
import type { Brick } from '../voxel/types.ts';

// Curated pool of sets that read cleanly as a "hero" object at 16³. The
// idle stage and the parts-legend picks both draw from this (falling back
// to the full library if none are cached). Arbitrary for now — curate later.
export const HERO_SETS = [
  'duck', 'cat', 'fox', 'penguin', 'rocket-ship', 'sailboat', 'house',
  'tree', 'robot', 'dragon', 'octopus', 'snail', 'mushroom', 'car', 'fish',
];

// Non-eager: grid JSON never enters the idle bundle until a set is picked
// or the random idle model resolves. Same glob shape as App.tsx's noun
// index, but keyed here for loading the actual voxel payload — $0,
// network-free, no Worker involved.
const seed4Modules = import.meta.glob<{ default: Seed4Json }>(
  '../../runs/seed4-16char-mixed/*.json',
);

function loaderForNoun(noun: string) {
  const path = Object.keys(seed4Modules).find((p) => p.endsWith(`/${noun}.json`));
  return path ? seed4Modules[path] : undefined;
}

/** The hero pool intersected with what's actually cached; full library if none. */
export function buildHeroPool(nouns: string[]): string[] {
  const have = new Set(nouns);
  const pool = HERO_SETS.filter((n) => have.has(n));
  return pool.length > 0 ? pool : nouns;
}

/** Fisher–Yates sample of `n` items (non-mutating). */
export function sample<T>(arr: T[], n: number): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = tmp;
  }
  return copy.slice(0, n);
}

/** One random element, or null for an empty pool. */
export function pickOne<T>(arr: T[]): T | null {
  return arr.length > 0 ? (arr[Math.floor(Math.random() * arr.length)] ?? null) : null;
}

/** Load a cached set's finished bricks for the idle stage. $0, offline. */
export async function loadBricksForNoun(noun: string): Promise<Brick[]> {
  const loader = loaderForNoun(noun);
  if (!loader) return [];
  const mod = await loader();
  return allBricks(buildSteps(seed4ToGrid(mod.default)));
}
