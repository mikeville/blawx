import { validateVoxels } from '../../../src/voxels.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE = 9;

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function errorResponse(status, code, message) {
  return jsonResponse(status, { error: { code, message } });
}

function publicProvenance(row) {
  const method = typeof row?.raw_model?.meta?.method === 'string'
    ? row.raw_model.meta.method
    : 'voxel-loft';
  return { method, generationVersion: row.generation_version };
}

function publicRawModel(model) {
  const meta = model?.meta ?? {};
  const scale = meta.scale && typeof meta.scale === 'object'
    ? Object.fromEntries(['studsPerVoxel', 'coursesPerVoxel', 'voxelMm']
      .filter((key) => Number.isFinite(meta.scale[key])).map((key) => [key, meta.scale[key]]))
    : null;
  return {
    version: model.version,
    kind: model.kind,
    cells: model.cells.map(({ x, y, z, color }) => ({ x, y, z, color })),
    meta: {
      ...Object.fromEntries(['prompt', 'method', 'provenance', 'limitations']
        .filter((key) => typeof meta[key] === 'string').map((key) => [key, meta[key]])),
      ...(scale ? { scale } : {}),
    },
  };
}

export function encodePublicFeedCursor({ createdAt, id }) {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export function decodePublicFeedCursor(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw new TypeError('invalid_cursor');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { throw new TypeError('invalid_cursor'); }
  if (!parsed || typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))
      || typeof parsed.id !== 'string' || !UUID.test(parsed.id)) throw new TypeError('invalid_cursor');
  return parsed;
}

function validSummaryRow(row) {
  return row && typeof row.result_id === 'string' && UUID.test(row.result_id)
    && typeof row.prompt === 'string' && row.prompt.length > 0
    && typeof row.created_at === 'string' && Number.isFinite(Date.parse(row.created_at))
    && typeof row.generation_version === 'string' && row.generation_version.length > 0;
}

export function createPublicFeedHandler({ store }) {
  return async function handle(request) {
    if (request.method !== 'GET') return errorResponse(405, 'method-not-allowed', 'Use GET.');
    if (!store) return errorResponse(503, 'feed-unavailable', 'Recent sets are temporarily unavailable.');
    const url = new URL(request.url);
    if ([...url.searchParams.keys()].some((key) => key !== 'cursor')
        || url.searchParams.getAll('cursor').length > 1) {
      return errorResponse(400, 'bad-request', 'Only one cursor is supported.');
    }
    let cursor = null;
    try {
      const value = url.searchParams.get('cursor');
      cursor = value ? decodePublicFeedCursor(value) : null;
    } catch {
      return errorResponse(400, 'bad-cursor', 'Invalid feed cursor.');
    }
    let rows;
    try {
      rows = await store.listVisibleResults({
        cursorCreatedAt: cursor?.createdAt ?? null,
        cursorId: cursor?.id ?? null,
        limit: MAX_PAGE + 1,
        signal: request.signal,
      });
    } catch {
      return errorResponse(503, 'feed-unavailable', 'Recent sets are temporarily unavailable.');
    }
    if (!Array.isArray(rows) || rows.length > MAX_PAGE + 1 || rows.some((row) => !validSummaryRow(row))) {
      return errorResponse(503, 'feed-unavailable', 'Recent sets are temporarily unavailable.');
    }
    const page = rows.slice(0, MAX_PAGE);
    return jsonResponse(200, {
      items: page.map((row) => ({
        id: row.result_id,
        prompt: row.prompt,
        createdAt: row.created_at,
        thumbnailUrl: null,
        previewStage: null,
        provenance: { method: 'voxel-loft', generationVersion: row.generation_version },
      })),
      nextCursor: rows.length > MAX_PAGE
        ? encodePublicFeedCursor({ createdAt: page.at(-1).created_at, id: page.at(-1).result_id })
        : null,
    });
  };
}

export function createPublicResultHandler({ store }) {
  return async function handle(request, context = {}) {
    if (request.method !== 'GET') return errorResponse(405, 'method-not-allowed', 'Use GET.');
    if (!store) return errorResponse(503, 'result-unavailable', 'That set is temporarily unavailable.');
    const id = context.params?.id;
    if (typeof id !== 'string' || !UUID.test(id) || new URL(request.url).search) {
      return errorResponse(404, 'not-found', 'Set not found.');
    }
    let row;
    try { row = await store.getVisibleResult({ resultId: id, signal: request.signal }); }
    catch { return errorResponse(503, 'result-unavailable', 'That set is temporarily unavailable.'); }
    if (!row) return errorResponse(404, 'not-found', 'Set not found.');
    const validation = validateVoxels(row.raw_model);
    if (!validSummaryRow(row) || row.result_id !== id || !validation.valid) {
      return errorResponse(503, 'result-unavailable', 'That set is temporarily unavailable.');
    }
    return jsonResponse(200, {
      id: row.result_id,
      prompt: row.prompt,
      createdAt: row.created_at,
      model: publicRawModel(row.raw_model),
      provenance: publicProvenance(row),
    });
  };
}
