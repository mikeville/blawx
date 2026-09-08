import { SemanticGuideError } from './semantic-guide-service.js';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i;

function send(response, status, value) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.end(JSON.stringify(value));
}

function statusFor(error) {
  if (error instanceof TypeError || error instanceof RangeError) return 400;
  if (!(error instanceof SemanticGuideError)) return 502;
  return {
    busy: 409,
    timeout: 504,
    unavailable: 503,
    cancelled: 502,
    'invalid-output': 502,
    'annotator-failed': 502,
  }[error.code] ?? 502;
}

function publicError(error) {
  if (error instanceof TypeError || error instanceof RangeError) {
    return { code: 'bad-request', message: 'Invalid semantic guide request.' };
  }
  const code = error instanceof SemanticGuideError ? error.code : 'annotator-failed';
  const message = {
    busy: 'Another local model request is already running.',
    timeout: 'Semantic annotation exceeded the 90 second limit.',
    unavailable: 'Semantic annotation is unavailable.',
    cancelled: 'Semantic annotation was cancelled.',
    'invalid-output': 'Semantic annotator returned an invalid result.',
    'annotator-failed': 'Semantic annotator failed.',
  }[code] ?? 'Semantic annotator failed.';
  return { code, message };
}

function publicRequestId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

function allowedRequest(request) {
  const host = request.headers.host ?? '';
  if (!LOCAL_HOST.test(host)) return { code: 'forbidden', message: 'Local requests only.' };
  const origin = request.headers.origin;
  if (!origin) return null;
  let originHost = '';
  try { originHost = new URL(origin).host; } catch {}
  if (originHost !== host || !LOCAL_HOST.test(originHost)) return { code: 'forbidden', message: 'Same-origin requests only.' };
  return null;
}

export function createSemanticGuideMiddleware(service) {
  return async function semanticGuideMiddleware(request, response, next) {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/api/semantic-guide') return next();

    const forbidden = allowedRequest(request);
    if (forbidden) return send(response, 403, { error: forbidden });

    if (request.method === 'GET') {
      const keys = [...url.searchParams.keys()];
      if (keys.length !== 1 || keys[0] !== 'fingerprint' || url.searchParams.getAll('fingerprint').length !== 1) {
        return send(response, 400, { error: { code: 'bad-request', message: 'GET requires exactly one fingerprint query parameter.' } });
      }
      try {
        const result = await service.lookup(url.searchParams.get('fingerprint'));
        return send(response, 200, result);
      } catch (error) {
        return send(response, statusFor(error), {
          error: error instanceof TypeError || error instanceof RangeError
            ? publicError(error)
            : { code: 'lookup-failed', message: 'Semantic guide lookup failed.' },
        });
      }
    }

    if (request.method !== 'POST') {
      return send(response, 405, { error: { code: 'method-not-allowed', message: 'Use GET or POST.' } });
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) {
      return send(response, 415, { error: { code: 'unsupported-media-type', message: 'Content-Type must be application/json.' } });
    }
    const declared = Number(request.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.resume();
      return send(response, 413, { error: { code: 'body-too-large', message: 'Request body is too large.' } });
    }

    const chunks = [];
    let size = 0;
    let tooLarge = false;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) tooLarge = true;
        else chunks.push(chunk);
      }
    } catch { return; }
    if (tooLarge) return send(response, 413, { error: { code: 'body-too-large', message: 'Request body is too large.' } });

    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return send(response, 400, { error: { code: 'bad-request', message: 'Request body must be valid JSON.' } }); }

    const controller = new AbortController();
    let completed = false;
    const cancel = () => { if (!completed) controller.abort(); };
    request.once('aborted', cancel);
    response.once('close', cancel);
    try {
      const result = await service.annotate(body, { signal: controller.signal });
      completed = true;
      return send(response, 200, result);
    } catch (error) {
      completed = true;
      const requestId = publicRequestId(error.requestId);
      return send(response, statusFor(error), {
        error: publicError(error),
        ...(requestId ? { requestId } : {}),
      });
    } finally {
      request.off('aborted', cancel);
      response.off('close', cancel);
    }
  };
}
