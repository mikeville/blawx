import { deliverSpendAlerts } from './_shared/alert-delivery.js';
import { createResendNotifier } from './_shared/resend-notifier.js';
import { createSupabaseLaunchStore } from './_shared/supabase-launch-store.js';

function env(name: string): string {
  return Netlify.env.get(name) ?? '';
}

export default async (_request: Request) => {
  const projectUrl = env('SUPABASE_URL');
  const secretKey = env('SUPABASE_SECRET_KEY');
  const apiKey = env('RESEND_API_KEY');
  const from = env('BLAWX_ALERT_EMAIL_FROM');
  const to = env('BLAWX_ALERT_EMAIL_TO');
  if (!projectUrl || !secretKey || !apiKey || !from || !to) {
    console.log('Blawx spend-alert delivery is not configured; no alerts were claimed.');
    return;
  }

  const store = createSupabaseLaunchStore({ projectUrl, secretKey });
  const notifier = createResendNotifier({ apiKey, from, to });
  const summary = await deliverSpendAlerts({ store, notifier, limit: 10 });
  console.log(`Blawx spend-alert delivery: claimed=${summary.claimed} sent=${summary.sent} failed=${summary.failed}`);
};

export const config = { schedule: '*/5 * * * *' };
