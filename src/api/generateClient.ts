import type { VoxelGrid } from '../voxel/types.ts';

const API_BASE = import.meta.env.VITE_BLAWX_API ?? '';

export type GenerateResult =
  | { status: 'ok'; grid: VoxelGrid; cache: 'hit' | 'miss'; degraded: boolean }
  | { status: 'miss' }
  | { status: 'error'; message: string };

// Fetch a built grid from the Worker. A 404 means "no cached build"
// (v1 cache-only mode); the SPA renders a placeholder rather than an
// error. The bare VoxelGrid is returned as the 200 body.
export async function generate(term: string): Promise<GenerateResult> {
  if (!API_BASE) {
    return { status: 'error', message: 'VITE_BLAWX_API not set' };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/generate?q=${encodeURIComponent(term)}`);
  } catch {
    return { status: 'error', message: 'network error' };
  }
  if (res.status === 404) return { status: 'miss' };
  if (!res.ok) return { status: 'error', message: `HTTP ${res.status}` };
  let grid: VoxelGrid;
  try {
    grid = (await res.json()) as VoxelGrid;
  } catch {
    return { status: 'error', message: 'bad response' };
  }
  const cache = res.headers.get('x-cache') === 'hit' ? 'hit' : 'miss';
  const degraded = res.headers.get('x-degraded') === '1';
  return { status: 'ok', grid, cache, degraded };
}
