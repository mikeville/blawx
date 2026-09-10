import { readFile } from 'node:fs/promises';
import { createBackgroundGenerationHandler } from './_shared/background-generation-handler.js';
import { createOpenAIProvider } from './_shared/openai-provider.js';
import { createPublicGenerationVersion } from './_shared/generation-cache.js';
import { OPENAI_LAUNCH_POLICY } from './_shared/openai-budget.js';
import { createSupabaseLaunchStore } from './_shared/supabase-launch-store.js';

const PROMPT_TEMPLATE_URL = new URL('../../server/prompts/voxel-loft.txt', import.meta.url);

function env(name: string): string {
  return Netlify.env.get(name) ?? '';
}

function configuredStore() {
  const projectUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  if (!projectUrl || !secretKey) return null;
  try { return createSupabaseLaunchStore({ projectUrl, secretKey }); } catch { return null; }
}

async function configuredRuntime() {
  const apiKey = env('OPENAI_API_KEY');
  if (!apiKey) return { generationVersion: null, provider: null };
  try {
    const promptTemplate = await readFile(PROMPT_TEMPLATE_URL, 'utf8');
    const generationVersion = await createPublicGenerationVersion({
      promptTemplate,
      policy: OPENAI_LAUNCH_POLICY,
    });
    return {
      generationVersion,
      provider: createOpenAIProvider({ apiKey, promptTemplate }),
    };
  } catch {
    return { generationVersion: null, provider: null };
  }
}

export default async (request: Request) => {
  const runtime = await configuredRuntime();
  const handler = createBackgroundGenerationHandler({
    secret: env('BLAWX_IP_HMAC_SECRET'),
    store: configuredStore(),
    provider: runtime.provider,
    generationVersion: runtime.generationVersion,
    logEvent: (event) => console.info(JSON.stringify({ scope: 'blawx-generation', ...event })),
  });
  return handler(request);
};

export const config = {
  background: true,
};
