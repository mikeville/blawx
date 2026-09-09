import { randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ensurePrivateDirectory,
  PRIVATE_FILE_MODE,
  resolvePrivateDataRoot,
} from './private-data-root.js';

const MAX_PAGE = 9;
const SAFE_ID = /^[A-Za-z0-9_-]+$/;
const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

function decodeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    cacheKey: row.cache_key,
    generationVersion: row.generation_version,
    normalizedPrompt: row.normalized_prompt,
    options: JSON.parse(row.options_json),
    prompt: row.prompt,
    createdAt: row.created_at,
    model: JSON.parse(row.raw_model_json),
    diagnostics: JSON.parse(row.diagnostics_json),
    receiptRef: row.receipt_ref,
    thumbnailKey: row.thumbnail_key,
    previewStage: row.preview_stage_json ? JSON.parse(row.preview_stage_json) : null,
    provenance: JSON.parse(row.provenance_json),
    visible: Boolean(row.visible),
  };
}

export function publicRawModel(model) {
  const meta = model?.meta ?? {};
  const scale = meta.scale && typeof meta.scale === 'object' ? Object.fromEntries(
    ['studsPerVoxel', 'coursesPerVoxel', 'voxelMm'].filter(key => Number.isFinite(meta.scale[key])).map(key => [key, meta.scale[key]]),
  ) : undefined;
  return {
    version: model.version,
    kind: model.kind,
    cells: model.cells.map(({ x, y, z, color }) => ({ x, y, z, color })),
    meta: {
      ...Object.fromEntries(['prompt', 'method', 'provenance', 'limitations']
        .filter(key => typeof meta[key] === 'string').map(key => [key, meta[key]])),
      ...(scale ? { scale } : {}),
    },
  };
}

function publicProvenance(value) {
  return Object.fromEntries(['method', 'generationVersion']
    .filter(key => typeof value?.[key] === 'string').map(key => [key, value[key]]));
}

function publicPreviewStage(value) {
  if (!value || typeof value !== 'object') return null;
  const output = Object.fromEntries(['azimuth', 'elevation', 'scale']
    .filter(key => Number.isFinite(value[key])).map(key => [key, value[key]]));
  return Object.keys(output).length ? output : null;
}

export function publicResult(row) {
  if (!row) return null;
  return {
    id: row.id,
    prompt: row.prompt,
    createdAt: row.createdAt,
    model: publicRawModel(row.model),
    provenance: publicProvenance(row.provenance),
    ...(publicPreviewStage(row.previewStage) ? { previewStage: publicPreviewStage(row.previewStage) } : {}),
  };
}

export function encodeFeedCursor({ createdAt, id }) {
  return Buffer.from(JSON.stringify({ createdAt, id }), 'utf8').toString('base64url');
}

export function decodeFeedCursor(value) {
  if (typeof value !== 'string' || !value || value.length > 512) throw new TypeError('Invalid feed cursor.');
  let parsed;
  try { parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); } catch { throw new TypeError('Invalid feed cursor.'); }
  if (!parsed || typeof parsed.createdAt !== 'string' || !Number.isFinite(Date.parse(parsed.createdAt))
    || typeof parsed.id !== 'string' || !SAFE_ID.test(parsed.id)) throw new TypeError('Invalid feed cursor.');
  return parsed;
}

export async function createResultStore({
  sourceRoot = DEFAULT_ROOT,
  dataRoot,
  databasePath,
  allowTestDataRoot = false,
  id = randomUUID,
} = {}) {
  const requestedPath = databasePath
    ? resolve(databasePath)
    : join(resolvePrivateDataRoot({ sourceRoot, dataRoot, allowTestDataRoot }), 'feed', 'results.sqlite');
  const privateDirectory = resolvePrivateDataRoot({
    sourceRoot,
    dataRoot: dirname(requestedPath),
    allowTestDataRoot,
  });
  await ensurePrivateDirectory(privateDirectory);
  const privateFile = await open(requestedPath, 'a', PRIVATE_FILE_MODE);
  await privateFile.chmod(PRIVATE_FILE_MODE);
  await privateFile.close();
  const database = new DatabaseSync(requestedPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY,
      cache_key TEXT NOT NULL,
      generation_version TEXT NOT NULL,
      normalized_prompt TEXT NOT NULL,
      options_json TEXT NOT NULL,
      prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      raw_model_json TEXT NOT NULL,
      diagnostics_json TEXT NOT NULL,
      receipt_ref TEXT NOT NULL,
      thumbnail_key TEXT,
      preview_stage_json TEXT,
      provenance_json TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1 CHECK (visible IN (0, 1))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS results_visible_cache_key ON results(cache_key) WHERE visible = 1;
    CREATE INDEX IF NOT EXISTS results_visible_recent ON results(visible, created_at DESC, id DESC);
  `);
  const findCache = database.prepare('SELECT * FROM results WHERE cache_key = ? AND visible = 1');
  const findId = database.prepare('SELECT * FROM results WHERE id = ? AND visible = 1');
  const hideId = database.prepare('UPDATE results SET visible = 0 WHERE id = ? AND visible = 1');
  const recent = database.prepare(`SELECT id, prompt, created_at, thumbnail_key, preview_stage_json, provenance_json
    FROM results WHERE visible = 1 ORDER BY created_at DESC, id DESC LIMIT ?`);
  const recentAfter = database.prepare(`SELECT id, prompt, created_at, thumbnail_key, preview_stage_json, provenance_json
    FROM results WHERE visible = 1 AND (created_at < ? OR (created_at = ? AND id < ?))
    ORDER BY created_at DESC, id DESC LIMIT ?`);
  const insert = database.prepare(`INSERT INTO results
    (id, cache_key, generation_version, normalized_prompt, options_json, prompt, created_at, raw_model_json, diagnostics_json, receipt_ref, thumbnail_key, preview_stage_json, provenance_json, visible)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`);

  return {
    findReusable(cacheKey) { return decodeRow(findCache.get(cacheKey)); },
    getVisible(resultId) { return SAFE_ID.test(resultId ?? '') ? publicResult(decodeRow(findId.get(resultId))) : null; },
    getPrivateVisible(resultId) { return SAFE_ID.test(resultId ?? '') ? decodeRow(findId.get(resultId)) : null; },
    saveSuccess(record) {
      const resultId = record.id ?? id();
      if (typeof resultId !== 'string' || !SAFE_ID.test(resultId)) {
        throw new TypeError('Result id must contain only letters, numbers, underscores, or hyphens.');
      }
      try {
        insert.run(resultId, record.cacheKey, record.generationVersion, record.normalizedPrompt,
          JSON.stringify(record.options), record.prompt, record.createdAt, JSON.stringify(record.model),
          JSON.stringify(record.diagnostics), record.receiptRef, record.thumbnailKey ?? null,
          record.previewStage ? JSON.stringify(record.previewStage) : null, JSON.stringify(record.provenance ?? {}));
      } catch (error) {
        if (error?.code === 'ERR_SQLITE_CONSTRAINT_UNIQUE') return decodeRow(findCache.get(record.cacheKey));
        throw error;
      }
      return decodeRow(findId.get(resultId));
    },
    listVisible({ cursor = null, limit = MAX_PAGE } = {}) {
      const bounded = Math.max(1, Math.min(MAX_PAGE, Number(limit) || MAX_PAGE));
      const boundary = cursor ? decodeFeedCursor(cursor) : null;
      const rows = boundary ? recentAfter.all(boundary.createdAt, boundary.createdAt, boundary.id, bounded + 1) : recent.all(bounded + 1);
      const page = rows.slice(0, bounded).map(row => ({
        id: row.id, prompt: row.prompt, createdAt: row.created_at, thumbnailKey: row.thumbnail_key,
        previewStage: row.preview_stage_json ? JSON.parse(row.preview_stage_json) : null,
        provenance: JSON.parse(row.provenance_json),
      }));
      return {
        items: page.map(row => ({
          id: row.id, prompt: row.prompt, createdAt: row.createdAt,
          thumbnailUrl: row.thumbnailKey ? `/api/results/${encodeURIComponent(row.id)}/thumbnail` : null,
          previewStage: publicPreviewStage(row.previewStage), provenance: publicProvenance(row.provenance),
        })),
        nextCursor: rows.length > bounded ? encodeFeedCursor(page.at(-1)) : null,
      };
    },
    hide(resultId) { return SAFE_ID.test(resultId ?? '') && hideId.run(resultId).changes === 1; },
    close() { database.close(); },
  };
}
