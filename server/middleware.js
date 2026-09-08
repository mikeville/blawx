import { GenerationError } from './generation-service.js';

const MAX_BODY_BYTES = 2048;
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
  if (!(error instanceof GenerationError)) return 502;
  return { busy: 409, timeout: 504, unavailable: 503, cancelled: 502, 'invalid-output': 502, 'generator-failed': 502 }[error.code] ?? 502;
}

function publicError(error) {
  if (error instanceof TypeError || error instanceof RangeError) {
    const knownMessages = new Set([
      'Prompt must be a string.',
      'Prompt must not be empty.',
      'Prompt must be 500 characters or fewer.',
    ]);
    const message = knownMessages.has(error.message) ? error.message : 'Invalid generation request.';
    return { code: 'bad-request', message };
  }
  const code = error instanceof GenerationError ? error.code : 'generator-failed';
  const message = {
    busy: 'Another generation is already running.',
    timeout: 'Generation exceeded the 90 second limit.',
    unavailable: 'Generation is unavailable.',
    cancelled: 'Generation was cancelled.',
    'invalid-output': 'Generator returned an invalid result.',
    'generator-failed': 'Generator failed.',
  }[code] ?? 'Generator failed.';
  return { code, message };
}

function publicRequestId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value : null;
}

export function createGenerationMiddleware(service) {
  return async function generationMiddleware(request, response, next) {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname !== '/api/generate') return next();
    if (request.method !== 'POST') return send(response, 405, { error: { code: 'method-not-allowed', message: 'Use POST.' } });
    const host = request.headers.host ?? '';
    if (!LOCAL_HOST.test(host)) return send(response, 403, { error: { code: 'forbidden', message: 'Local requests only.' } });
    const origin = request.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch {}
      if (originHost !== host || !LOCAL_HOST.test(originHost)) return send(response, 403, { error: { code: 'forbidden', message: 'Same-origin requests only.' } });
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'prompt') || typeof body.prompt !== 'string') {
      return send(response, 400, { error: { code: 'bad-prompt', message: 'Body must contain only a string prompt.' } });
    }

    const controller = new AbortController();
    let completed = false;
    const cancel = () => { if (!completed) controller.abort(); };
    request.once('aborted', cancel);
    response.once('close', cancel);
    try {
      const result = await service.generate(body.prompt, { signal: controller.signal });
      completed = true;
      send(response, 200, result);
    } catch (error) {
      completed = true;
      const requestId = publicRequestId(error.requestId);
      send(response, statusFor(error), {
        error: publicError(error),
        ...(requestId ? { requestId } : {}),
      });
    } finally {
      request.off('aborted', cancel);
      response.off('close', cancel);
    }
  };
}
