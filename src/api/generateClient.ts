import type { VoxelGrid } from '../voxel/types.ts';
import { mockLookup } from './mockCache.ts';
import { slug, validateTerm } from './slug.ts';

const API_HOST: string | undefined = import.meta.env.VITE_BLAWX_API;

export type GenerateResult = {
  grid: VoxelGrid;
  term: string;
  cached: boolean;
};

export type ProgressPhase = 'starting' | 'cached' | 'generating' | 'done';

export type ProgressEvent = {
  phase: ProgressPhase;
  message: string;
};

export type GenerateOptions = {
  signal?: AbortSignal;
  onProgress?: (e: ProgressEvent) => void;
};

export async function generateBooklet(
  rawTerm: string,
  opts: GenerateOptions = {},
): Promise<GenerateResult> {
  const err = validateTerm(rawTerm);
  if (err) throw new Error(err);
  const s = slug(rawTerm);

  if (API_HOST) {
    opts.onProgress?.({ phase: 'starting', message: 'asking the api' });
    const res = await fetch(`${API_HOST}/api/generate?q=${encodeURIComponent(s)}`, {
      signal: opts.signal,
    });
    if (res.status === 429) throw new Error('rate limit — try again in a bit.');
    if (!res.ok) throw new Error(`api error ${res.status}`);
    const cached = res.headers.get('x-cache') === 'hit';
    opts.onProgress?.({
      phase: cached ? 'cached' : 'done',
      message: cached ? 'cache hit' : 'fresh build',
    });
    const grid = (await res.json()) as VoxelGrid;
    return { grid, term: s, cached };
  }

  const hit = mockLookup(s);
  if (hit) {
    opts.onProgress?.({ phase: 'cached', message: 'cache hit (mock)' });
    await delay(180, opts.signal);
    return { grid: hit, term: s, cached: true };
  }

  opts.onProgress?.({ phase: 'generating', message: 'mocking a fresh build…' });
  await delay(1800, opts.signal);
  throw new Error(
    `no mock for "${s}". the real api lands in phase 0 part 2 — pick a seeded term for now.`,
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    if (!signal) return;
    if (signal.aborted) {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
