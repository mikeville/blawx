# OpenAI launch checklist

Status: public generation launched 2026-09-10 on production deploy `6aa28ec83ac423752756e077`. The production browser flag, Netlify Function switch, and Supabase switch are on; Deploy Preview generation remains off. The dedicated OpenAI project and Restricted service-account key, Astra-only allowlist, $1,000 hard monthly limit, eight owner alerts, 60 RPM / 500,000 TPM, atomic Supabase safeguards, and scheduled Resend alerts are active. Launch verification used only the existing lighthouse cache and left actual spend at $0.058780, with $0 reserved and zero active requests. The OpenAI key has no provider expiry, so schedule a 90-day rotation reminder.

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

Completed 2026-09-09; retained as the configuration receipt.

1. Dedicated non-default project **Blawx** created (`proj_El5CEYWmp20hTUh8cHmjRqbt`).
2. Model usage allows only `gpt-6-astra`.
3. Enforced monthly project limit saved and reopened at **$1,000**. This intentionally matches the application monthly ceiling; enforcement is not instantaneous, so the atomic application ceiling remains primary.
4. Owner-email alerts saved at **$25, $50, $100, $250, $500, $750, $950, and $1,000**.
5. Astra project rate limits saved at **60 requests/minute** and **500,000 tokens/minute**, supporting the ten-call launch concurrency target with burst headroom.
6. Project service account `blawx-netlify-prod` and its key were created. The key was entered directly into Netlify as protected `OPENAI_API_KEY` values for Production and Deploy Previews and was never pasted into chat or the repository. The key now shows Restricted with Model capabilities: Request; List models, Threads, Evals, Fine-tuning, Files, Videos, Vector Stores, Prompts, Batch, Tunnels, Datasets, and Project safety alerts remain None. It shows Expires: Never; use a 90-day rotation reminder rather than relying on provider expiry.

Official OpenAI documentation now distinguishes alerts from hard spend limits and exposes project hard-limit, alert, model-permission, rate-limit, and service-account resources. A `project_spend_limit_exceeded` error is non-retryable until the limit resets or changes.

## Mike: Netlify secret settings

Completed 2026-09-09. Secret values are marked protected and exist only in Production and Deploy Previews. On the current Free plan Netlify fixes protected variables to Builds, Functions, and Runtime scopes; no secret uses a `VITE_` prefix, and bundle/source scans remain clean.

- `OPENAI_API_KEY` — project-scoped Blawx service-account key.
- `SUPABASE_URL` — `https://iveecrkegbqohgfkcbda.supabase.co`.
- `SUPABASE_SECRET_KEY` — a server-only Supabase secret key for the Blawx project, not a publishable key.
- `BLAWX_IP_HMAC_SECRET` — at least 32 random bytes; never a human phrase.
- `GENERATION_ENABLED` — `true` in Production after launch verification; keep false in Deploy Previews.
- `BLAWX_ALLOWED_ORIGINS` — `https://blawx.netlify.app,https://mikemake.com`; the Function also derives the exact current Netlify deploy origin from the request and Netlify-provided URL variables, so disposable canary URLs are not hard-coded.

Do not use a `VITE_` prefix for any secret. `VITE_GENERATION_ENABLED=true` is a non-secret Production build flag; it remains absent from Deploy Previews.

## Codex: after Mike completes the dashboard steps

1. Done: environment-variable names/scopes verified without displaying values.
2. Done: bounded provider adapter verified while both kill switches remain off.
3. Done: effective 592/592 test checkpoint and production build pass; the sole sandbox localhost-bind failure passes when rerun with bind permission.
4. Done: current canary `https://6aa1f2dd694a49178eb31914--blawx.netlify.app/` returns 200 for the app/feed and the friendly 503 for a unique generation miss. Live parallel races produce exactly 10 reservations plus 2 concurrency rejections and, under isolated $1 test caps, exactly 5 reservations plus 3 daily rejections and 5 reservations plus 3 monthly rejections. All accepted test reservations were cancelled before provider entry; cleanup restored generation off, production caps, zero active reservations, zero reserved spend, and zero actual spend.
5. Done 2026-09-10: Mike separately authorized one paid smoke test capped at $0.20. The disposable deploy-preview request generated “A tiny blue lighthouse with a red roof on a sandy island” on `gpt-6-astra` in 19.185 seconds. Result `f935c1cc-b1e0-4217-8ead-5ca4bc17b04e` is valid, saved, and visible through the sanitized production feed/detail APIs.
6. Done: Supabase records one successful request, a $0.20 reservation, $0.058780 actual spend, no failure, zero active reservations, and $0 reserved after finalization. The enabled disposable deploy was deleted and returns 404.
7. Done 2026-09-10: Mike approved public generation. Production deploy `6aa28ec83ac423752756e077` passed app/feed/detail checks, served the lighthouse as a zero-cost cache hit, and returned the friendly database-gated 503 for a unique miss before the final Supabase switch was enabled. Production is live with 3 attempts/connection/day, $200/day, $1,000/month, $0.20/request reserve, 10 concurrent requests, and Deploy Preview generation off.

## Owner monitoring

Anonymous hourly Supabase rollups count each database kill-switch, daily-rate, daily/monthly-budget, concurrency, replay, and conflict rejection in the same atomic transaction that makes the decision. `blawx_private.monitoring_dashboard` combines those counts with daily provider outcomes and spend; see `MONITORING.md`. No prompt, IP, connection hash, request ID, or user agent is retained in the rollup.
