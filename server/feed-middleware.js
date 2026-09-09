const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;
import { decodeFeedCursor } from './result-store.js';

const RESULT_PATH = /^\/api\/results\/([A-Za-z0-9_-]+)$/;
const THUMBNAIL_PATH = /^\/api\/results\/([A-Za-z0-9_-]+)\/thumbnail$/;

function sendJson(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function authorized(request) {
  const host = request.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    return originHost === host && LOCAL_HOST.test(originHost);
  } catch { return false; }
}

export function createFeedMiddleware(store, { loadThumbnail } = {}) {
  return async function feedMiddleware(request, response, next) {
    const url = new URL(request.url, 'http://localhost');
    const resultMatch = url.pathname.match(RESULT_PATH);
    const thumbnailMatch = url.pathname.match(THUMBNAIL_PATH);
    const apiResultPath = String(request.url).split(/[?#]/, 1)[0].startsWith('/api/results');
    if (url.pathname !== '/api/feed' && !apiResultPath) return next();
    if (apiResultPath && !resultMatch && !thumbnailMatch) return sendJson(response, 404, { error: { code: 'not-found', message: 'Set not found.' } });
    if (request.method !== 'GET') return sendJson(response, 405, { error: { code: 'method-not-allowed', message: 'Use GET.' } });
    if (!authorized(request)) return sendJson(response, 403, { error: { code: 'forbidden', message: 'Local same-origin requests only.' } });

    if (url.pathname === '/api/feed') {
      const keys = [...url.searchParams.keys()];
      if (keys.some(key => key !== 'cursor') || url.searchParams.getAll('cursor').length > 1) {
        return sendJson(response, 400, { error: { code: 'bad-request', message: 'Only one cursor is supported.' } });
      }
      const cursor = url.searchParams.get('cursor') || null;
      try { if (cursor) decodeFeedCursor(cursor); }
      catch { return sendJson(response, 400, { error: { code: 'bad-cursor', message: 'Invalid feed cursor.' } }); }
      try { return sendJson(response, 200, store.listVisible({ cursor, limit: 9 })); }
      catch { return sendJson(response, 500, { error: { code: 'internal-error', message: 'The feed could not be read.' } }); }
    }

    if (url.search) return sendJson(response, 400, { error: { code: 'bad-request', message: 'Query parameters are not supported.' } });
    const resultId = resultMatch?.[1] ?? thumbnailMatch[1];
    if (resultMatch) {
      let result;
      try { result = store.getVisible(resultId); }
      catch { return sendJson(response, 500, { error: { code: 'internal-error', message: 'The set could not be read.' } }); }
      return result ? sendJson(response, 200, result) : sendJson(response, 404, { error: { code: 'not-found', message: 'Set not found.' } });
    }

    let row;
    try { row = store.getPrivateVisible(resultId); }
    catch { return sendJson(response, 500, { error: { code: 'internal-error', message: 'The thumbnail could not be read.' } }); }
    if (!row?.thumbnailKey || typeof loadThumbnail !== 'function') {
      return sendJson(response, 404, { error: { code: 'not-found', message: 'Thumbnail not found.' } });
    }
    let thumbnail;
    try { thumbnail = await loadThumbnail(row.thumbnailKey); }
    catch { return sendJson(response, 500, { error: { code: 'internal-error', message: 'The thumbnail could not be read.' } }); }
    if (!thumbnail?.body || !thumbnail.contentType) return sendJson(response, 404, { error: { code: 'not-found', message: 'Thumbnail not found.' } });
    response.statusCode = 200;
    response.setHeader('Content-Type', thumbnail.contentType);
    response.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    if (thumbnail.etag) response.setHeader('ETag', thumbnail.etag);
    response.end(thumbnail.body);
  };
}
