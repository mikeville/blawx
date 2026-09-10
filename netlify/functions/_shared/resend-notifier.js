const RESEND_EMAILS_URL = 'https://api.resend.com/emails';

function plainHeader(value, name, maxLength = 320) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\r\n]/.test(value)) {
    throw new Error(`resend_${name}_invalid`);
  }
  return value.trim();
}

export function createResendNotifier({ apiKey, from, to, fetchImpl = fetch } = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) throw new Error('resend_api_key_required');
  if (typeof fetchImpl !== 'function') throw new Error('resend_fetch_required');
  const safeFrom = plainHeader(from, 'from');
  const safeTo = plainHeader(to, 'to');

  return Object.freeze({
    async send({ subject, text, idempotencyKey, signal } = {}) {
      const safeSubject = plainHeader(subject, 'subject', 200);
      const safeKey = plainHeader(idempotencyKey, 'idempotency_key', 256);
      if (typeof text !== 'string' || !text || text.length > 10_000) {
        throw new Error('resend_text_invalid');
      }
      const response = await fetchImpl(RESEND_EMAILS_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'idempotency-key': safeKey,
          'user-agent': 'blawx-spend-alerts/1.0',
        },
        body: JSON.stringify({ from: safeFrom, to: [safeTo], subject: safeSubject, text }),
        redirect: 'error',
        signal,
      });
      if (!response.ok) {
        const error = new Error('resend_send_failed');
        error.code = `resend_http_${response.status}`;
        throw error;
      }
    },
  });
}

export const resendNotifierConfig = Object.freeze({ endpoint: RESEND_EMAILS_URL });
