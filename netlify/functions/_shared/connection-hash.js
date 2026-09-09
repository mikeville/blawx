const encoder = new TextEncoder();

async function hmac(keyBytes, value) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function hashConnection({ ip, secret, now = new Date() }) {
  const normalizedIp = typeof ip === 'string' ? ip.trim() : '';
  if (!normalizedIp) throw new Error('trusted_ip_missing');
  if (typeof secret !== 'string' || encoder.encode(secret).byteLength < 32) {
    throw new Error('connection_secret_too_short');
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error('invalid_clock');

  const day = now.toISOString().slice(0, 10);
  const dayKey = await hmac(encoder.encode(secret), `blawx-connection:${day}`);
  return hmac(dayKey, normalizedIp);
}

export function bytesToPostgresBytea(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== 32) {
    throw new Error('connection_hash_must_be_32_bytes');
  }
  return `\\x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}
