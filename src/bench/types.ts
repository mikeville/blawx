// Interchange format for benchmark results. One JSON file per generated
// object, grouped into run folders under runs/<run-id>/. The harness is
// human-in-loop: these files are written by hand-pasting model output through
// a converter (or by import scripts), never by live API calls.

export type Vec3 = [number, number, number];

export type BenchMeta = {
  model?: string;
  encoding?: string;
  /** Estimated tokens for hypothetical cost math — see cost.ts. */
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  notes?: string;
};

export type BenchResult = {
  noun: string;
  /** Grid is size³, coordinates in [0, size). */
  size: number;
  voxels: Vec3[];
  /** Optional hex colors parallel to voxels (secondary color render only). */
  colors?: string[];
  meta?: BenchMeta;
};

export type ParseOutcome = {
  result: BenchResult;
  /** Voxels discarded for being out of range / duplicated — itself a signal. */
  dropped: number;
};

export type RunManifest = {
  id: string;
  label: string;
  date: string;
  pipeline: string;
  conditions?: Record<string, string>;
};

export type Verdict = 'hit' | 'close' | 'miss';

export type ScoreEntry = {
  /** The blind namer's raw answer, verbatim. */
  answer: string;
  verdict: Verdict;
  notes?: string;
};

/** runs/<id>/scores.json — keyed by noun. */
export type RunScores = Record<string, ScoreEntry>;

export const VERDICT_VALUE: Record<Verdict, number> = { hit: 1, close: 0.5, miss: 0 };

function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every((n) => Number.isInteger(n));
}

/**
 * Validate a result file. Structural problems throw; out-of-range and
 * duplicate voxels are dropped and counted (an LLM emitting them is a
 * failure signal the harness wants to measure, not crash on).
 */
export function parseBenchResult(data: unknown): ParseOutcome {
  if (typeof data !== 'object' || data === null) throw new Error('not an object');
  const d = data as Record<string, unknown>;
  if (typeof d.noun !== 'string' || d.noun.length === 0) throw new Error('missing noun');
  if (!Number.isInteger(d.size) || (d.size as number) < 1 || (d.size as number) > 64) {
    throw new Error(`bad size: ${String(d.size)}`);
  }
  if (!Array.isArray(d.voxels)) throw new Error('missing voxels array');
  const size = d.size as number;
  const rawColors = Array.isArray(d.colors) ? (d.colors as unknown[]) : undefined;
  if (rawColors && rawColors.length !== d.voxels.length) {
    throw new Error('colors length must match voxels length');
  }

  const seen = new Set<string>();
  const voxels: Vec3[] = [];
  const colors: string[] = [];
  let dropped = 0;
  d.voxels.forEach((v, i) => {
    if (!isVec3(v)) throw new Error(`voxel ${i} is not an integer triple`);
    const inRange = v.every((n) => n >= 0 && n < size);
    const k = v.join(',');
    if (!inRange || seen.has(k)) {
      dropped += 1;
      return;
    }
    seen.add(k);
    voxels.push([v[0], v[1], v[2]]);
    if (rawColors) colors.push(String(rawColors[i]));
  });

  const result: BenchResult = {
    noun: d.noun,
    size,
    voxels,
    ...(rawColors ? { colors } : {}),
    ...(typeof d.meta === 'object' && d.meta !== null ? { meta: d.meta as BenchMeta } : {}),
  };
  return { result, dropped };
}
