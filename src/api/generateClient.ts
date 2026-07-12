import type { VoxelGrid } from '../voxel/types.ts';

const API_BASE = import.meta.env.VITE_BLAWX_API ?? '';

// Honest build-log events streamed from the Worker during a live gen.
// `front` (the FA front mask, known at t=0) drives the on-stage front-layer
// assemble; `paint` arrives once the model has assigned real per-cell colors
// to that same front silhouette, so the stage repaints in place rather than
// reassembling; each `step` is one real pipeline op. Mirror of the Worker's
// ProgressEvent — kept as a hand copy so the client owns no server import.
export type BuildEvent =
  | { kind: 'front'; mask: string; color: string }
  | { kind: 'paint'; overlay: string }
  | { kind: 'step'; id: string; label: string };

export type GenerateResult =
  | { status: 'ok'; grid: VoxelGrid; cache: 'hit' | 'miss'; degraded: boolean }
  | { status: 'miss'; code: 'miss' | 'no-source' }
  | {
      status: 'error';
      kind: 'rate-limit' | 'upstream' | 'network' | 'config' | 'bad-response';
      message: string;
    };

/**
 * Fetch (or generate) a built grid from the Worker.
 *
 * The Worker answers a cache hit / cache-only miss / rate-limit as plain
 * JSON, but streams the live-generation path as Server-Sent Events so the
 * caller can show an honest build log. `onEvent` receives those `front` /
 * `paint` / `step` beats as they arrive; the promise resolves once `done`
 * (or a terminal `error`) lands. When the answer is immediate JSON,
 * `onEvent` never fires.
 */
export async function generate(
  term: string,
  onEvent?: (e: BuildEvent) => void,
): Promise<GenerateResult> {
  if (!API_BASE) {
    return { status: 'error', kind: 'config', message: 'VITE_BLAWX_API not set' };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/generate?q=${encodeURIComponent(term)}`);
  } catch {
    return { status: 'error', kind: 'network', message: 'network error' };
  }

  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('text/event-stream') && res.body) {
    return consumeStream(res.body, onEvent);
  }

  // Immediate JSON: hit, cache-only miss, rate limit, or a hard error.
  if (res.status === 429) {
    return { status: 'error', kind: 'rate-limit', message: 'rate limit' };
  }
  if (res.status === 404) {
    const code = await bodyCode(res);
    return { status: 'miss', code: code === 'no-source' ? 'no-source' : 'miss' };
  }
  if (!res.ok) {
    return { status: 'error', kind: 'upstream', message: `HTTP ${res.status}` };
  }
  let grid: VoxelGrid;
  try {
    grid = (await res.json()) as VoxelGrid;
  } catch {
    return { status: 'error', kind: 'bad-response', message: 'bad response' };
  }
  const cache = res.headers.get('x-cache') === 'hit' ? 'hit' : 'miss';
  const degraded = res.headers.get('x-degraded') === '1';
  return { status: 'ok', grid, cache, degraded };
}

async function bodyCode(res: Response): Promise<string | undefined> {
  try {
    const b = (await res.json()) as { code?: string };
    return b.code;
  } catch {
    return undefined;
  }
}

// Parse the SSE frames off the body, dispatch front/step to `onEvent`, and
// resolve on the terminal done/error frame. Frame shape: lines `event: X`
// and `data: <json>`, blank line terminates a frame.
async function consumeStream(
  body: ReadableStream<Uint8Array>,
  onEvent?: (e: BuildEvent) => void,
): Promise<GenerateResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let result: GenerateResult | null = null;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });

      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const raw = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const parsed = handleFrame(raw, onEvent);
        if (parsed) result = parsed;
      }
      if (done) break;
    }
  } catch {
    return result ?? { status: 'error', kind: 'network', message: 'stream error' };
  }

  return (
    result ?? { status: 'error', kind: 'upstream', message: 'stream ended without result' }
  );
}

function handleFrame(
  raw: string,
  onEvent?: (e: BuildEvent) => void,
): GenerateResult | null {
  let event = 'message';
  let data = '';
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }

  switch (event) {
    case 'front': {
      const p = payload as { mask: string; color: string };
      onEvent?.({ kind: 'front', mask: p.mask, color: p.color });
      return null;
    }
    case 'paint': {
      const p = payload as { overlay: string };
      onEvent?.({ kind: 'paint', overlay: p.overlay });
      return null;
    }
    case 'step': {
      const p = payload as { id: string; label: string };
      onEvent?.({ kind: 'step', id: p.id, label: p.label });
      return null;
    }
    case 'done': {
      const p = payload as { grid: VoxelGrid; degraded: boolean };
      return { status: 'ok', grid: p.grid, cache: 'miss', degraded: !!p.degraded };
    }
    case 'error': {
      const p = payload as { code?: string };
      if (p.code === 'no-source') return { status: 'miss', code: 'no-source' };
      return { status: 'error', kind: 'upstream', message: p.code ?? 'generation failed' };
    }
    default:
      return null;
  }
}
