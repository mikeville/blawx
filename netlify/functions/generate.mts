import { readFile } from 'node:fs/promises';
import { bytesToPostgresBytea, hashConnection } from './_shared/connection-hash.js';
import { createLaunchHandler } from './_shared/launch-handler.js';
import { createOpenAIProvider } from './_shared/openai-provider.js';
import { createPublicGenerationVersion } from './_shared/generation-cache.js';
import { OPENAI_LAUNCH_POLICY } from './_shared/openai-budget.js';
import { createSupabaseLaunchStore } from './_shared/supabase-launch-store.js';

const PROMPT_TEMPLATE_URL = new URL('../../server/prompts/voxel-loft.txt', import.meta.url);

function env(name: string): string {
  return Netlify.env.get(name) ?? '';
}

function allowedOrigins(request: Request): string[] {
  return [new URL(request.url).origin, env('URL'), env('DEPLOY_PRIME_URL'), ...env('BLAWX_ALLOWED_ORIGINS').split(',')]
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });
}

function configuredStore() {
  const projectUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!projectUrl || !secretKey) return null;
  try {
    return createSupabaseLaunchStore({ projectUrl, secretKey });
  } catch {
    return null;
  }
}

async function configuredRuntime() {
  const apiKey = env('OPENAI_API_KEY');
  try {
    const promptTemplate = await readFile(PROMPT_TEMPLATE_URL, 'utf8');
    const generationVersion = await createPublicGenerationVersion({
      promptTemplate,
      policy: OPENAI_LAUNCH_POLICY,
    });
    return {
      generationVersion,
      provider: apiKey ? createOpenAIProvider({ apiKey, promptTemplate }) : null,
    };
  } catch {
    return { generationVersion: null, provider: null };
  }
}

export default async (request: Request, context: { ip?: string; requestId?: string }) => {
  const secret = env('BLAWX_IP_HMAC_SECRET');
  const runtime = await configuredRuntime();
  const handler = createLaunchHandler({
    generationEnabled: env('GENERATION_ENABLED') === 'true',
    allowedOrigins: allowedOrigins(request),
    store: configuredStore(),
    // A provider exists only when a server-scoped key and the bundled fixed
    // prompt are both available. Either kill switch can still prevent entry.
    provider: runtime.provider,
    generationVersion: runtime.generationVersion,
    connectionHasher: secret
      ? async ({ ip, now }) => bytesToPostgresBytea(await hashConnection({ ip, secret, now }))
      : null,
  });
  return handler(request, context);
};

export const config = {
  path: '/api/generate',
  method: ['POST'],
};
