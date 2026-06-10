import type { VoxelGrid } from '../voxel/types.ts';

type Mod = { default: VoxelGrid; term?: string };

// Phase 0 uses local files as a stand-in for the real KV cache: the frozen
// baseline-llm batch plus anything the generation CLIs have written into
// src/voxel/generated/ (current pipeline — wins over the baseline on slug
// collisions). Once the Cloudflare Worker is wired, the client switches to
// fetching from VITE_BLAWX_API and these stay only as a dev fallback.
const baselineMods = import.meta.glob<Mod>(
  '/src/voxel/generated/baseline-llm/*.ts',
  { eager: true },
);
const currentMods = import.meta.glob<Mod>('/src/voxel/generated/*.ts', {
  eager: true,
});

const cache = new Map<string, VoxelGrid>();
for (const mods of [baselineMods, currentMods]) {
  for (const [path, mod] of Object.entries(mods)) {
    const fileSlug = path.split('/').pop()!.replace(/\.ts$/, '');
    cache.set((mod.term ?? fileSlug).toLowerCase(), mod.default);
  }
}

export function mockLookup(slug: string): VoxelGrid | undefined {
  return cache.get(slug);
}

export function mockTerms(): string[] {
  return [...cache.keys()].sort();
}
