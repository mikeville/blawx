# OpenAI launch checklist

Status: the bounded provider adapter and deployable Function package pass mocked tests, but no OpenAI project key is connected to the public app, the Netlify and database kill switches remain off, and no paid smoke test is authorized.

## Fixed public request profile

- Model: `gpt-6-astra` only.
- Responses API, one request, zero application retries, zero fallback models, no tools, `store: false`.
- Reasoning: `low`; service tier: `default` (never `auto`, Fast, or Priority).
- Final input: at most 7,000 UTF-8 bytes; output: at most 2,000 tokens, including reasoning tokens.
- Provider deadline: 50 seconds, below Netlify's 60-second synchronous Function limit.
- Database reservation: $0.20 before provider entry.

Official OpenAI pricing currently lists GPT-6 Astra standard text rates at $10 per million input tokens and $50 per million output tokens. The code uses $12.50/M for input as a deliberate 25% safety premium. At the fixed bounds, the conservative content estimate is $0.1875: 7,000 input-token equivalents × $12.50/M = $0.0875, plus 2,000 output tokens × $50/M = $0.10. The remaining $0.0125 reservation margin covers request-format overhead. If pricing or any request bound changes, the test fails until the database reservation is reviewed too.

References: [GPT-6 Astra model and pricing](https://developers.openai.com/api/docs/models/gpt-6-astra), [Responses API output cap and usage fields](https://developers.openai.com/api/reference/resources/responses/methods/create), [project hard spend limits and alerts](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/projects).

## Mike: OpenAI dashboard

Do not create or paste a key until steps 1–5 visibly match.

1. Open the OpenAI API dashboard and create a dedicated project named **Blawx**. Do not use the Default project.
2. In **Project → Limits → Model usage**, allow only `gpt-6-astra`. Disable every model/tool family the app does not use.
3. In **Project → Limits → Spend limit**, set a monthly limit of **$1,100**, choose **hard enforcement**, save, then reopen the setting and confirm it still says hard. A hard limit can stop new requests, but enforcement is not instantaneous and tracked spend can slightly overshoot, so the $1,000 application ceiling remains the primary guard.
4. Add project email alerts at **$250, $500, $750, $900, and $1,000**. Confirm the intended project/organization owners receive them.
5. Set the lowest model rate limits the dashboard permits while supporting the two-call app concurrency target. Start with **6 requests/minute** and **24,000 tokens/minute** for `gpt-6-astra`; if the dashboard's minimum is higher, record the displayed value rather than guessing.
6. Create a project service account named `blawx-netlify-prod`. Create a restricted, expiring key that can call Responses for this project but cannot administer the organization, projects, keys, files, fine-tunes, assistants, images, audio, or other models. Copy it once directly into Netlify as `OPENAI_API_KEY`; do not paste it into chat, a terminal command, or a repo file.

Official OpenAI documentation now distinguishes alerts from hard spend limits and exposes project hard-limit, alert, model-permission, rate-limit, and service-account resources. A `project_spend_limit_exceeded` error is non-retryable until the limit resets or changes.

## Mike: Netlify secret settings

Enter values directly in Netlify's UI, scoped to Functions and the intended deploy contexts. Codex only needs to verify that the names exist; it does not need to read the values.

- `OPENAI_API_KEY` — project-scoped Blawx service-account key.
- `SUPABASE_URL` — `https://iveecrkegbqohgfkcbda.supabase.co`.
- `SUPABASE_SECRET_KEY` — a server-only Supabase secret key for the Blawx project, not a publishable key.
- `BLAWX_IP_HMAC_SECRET` — at least 32 random bytes; never a human phrase.
- `GENERATION_ENABLED` — keep exactly `false` through all no-spend tests.
- `BLAWX_ALLOWED_ORIGINS` — `https://blawx.netlify.app` plus only the canary URL when one exists.

Do not use a `VITE_` prefix for any secret. Do not enable the browser generation build flag yet.

## Codex: after Mike completes the dashboard steps

1. Verify environment-variable names/scopes without displaying values.
2. Verify the already-integrated bounded provider adapter while both kill switches remain off.
3. Re-run the passing mocked response, timeout, invalid-output, 429/hard-limit, unknown-usage, and zero-retry tests.
4. Run the remaining parallel reservation race in a safe canary, then deploy generation-disabled. Bundle and secret scans already pass locally.
5. Ask Mike for a separate, explicit authorization for one paid smoke test capped at $0.20.
6. Reconcile that one provider usage receipt with Supabase before asking to enable public generation.
