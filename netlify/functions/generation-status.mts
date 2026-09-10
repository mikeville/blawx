import { bytesToPostgresBytea, hashConnection } from './_shared/connection-hash.js';
import { createGenerationStatusHandler } from './_shared/generation-status-handler.js';
import { createSupabaseLaunchStore } from './_shared/supabase-launch-store.js';

function env(name: string): string {
  return Netlify.env.get(name) ?? '';
}

function configuredStore() {
  const projectUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!projectUrl || !secretKey) return null;
  try { return createSupabaseLaunchStore({ projectUrl, secretKey }); }
  catch { return null; }
}

export default (request: Request, context: { ip?: string; params?: { id?: string } }) => {
  const secret = env('BLAWX_IP_HMAC_SECRET');
  return createGenerationStatusHandler({
    store: configuredStore(),
    connectionHasher: secret
      ? async ({ ip, now }) => bytesToPostgresBytea(await hashConnection({ ip, secret, now }))
      : null,
  })(request, context);
};

export const config = {
  path: '/api/generations/:id',
  method: ['GET'],
};
