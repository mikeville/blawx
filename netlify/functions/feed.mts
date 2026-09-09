import { createPublicFeedHandler } from './_shared/public-results-handler.js';
import { createSupabaseLaunchStore } from './_shared/supabase-launch-store.js';

function configuredStore() {
  const projectUrl = Netlify.env.get('SUPABASE_URL') ?? '';
  const secretKey = Netlify.env.get('SUPABASE_SECRET_KEY') ?? '';
  if (!projectUrl || !secretKey) return null;
  try { return createSupabaseLaunchStore({ projectUrl, secretKey }); }
  catch { return null; }
}

export default (request: Request) => createPublicFeedHandler({ store: configuredStore() })(request);

export const config = { path: '/api/feed', method: ['GET'] };
