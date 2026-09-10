# Blawx public launch plan

Status: public generation launched 2026-09-10 at `https://blawx.netlify.app/`; immutable production deploy `https://6aa28ec83ac423752756e077--blawx.netlify.app/` is ready. The production-only browser and Netlify Function switches are `true`, the Supabase `generation_enabled` switch is `true`, and Deploy Preview generation remains off. The dedicated Free Plan Supabase project `Blawx` (`iveecrkegbqohgfkcbda`) is active and healthy in `us-east-1`; all six launch migrations are applied. The private quota/spend/lease/alert/result ledgers and server-role-only RPCs pass rollback and live transactional tests; exact raw-generation cache hits bypass quota and provider work, and sanitized feed/detail projections omit source, provider, diagnostic, and accounting fields. Anonymous hourly rollups count daily-rate, budget, concurrency, kill-switch, replay, and conflict rejections inside the atomic reservation transaction without retaining prompts, IPs, connection hashes, request IDs, or user agents. Owner-only `blawx_private.monitoring_dashboard` combines those gates with daily provider outcomes and spend while hiding preserved future-dated test fixtures. Live parallel races prove the 10-call concurrency ceiling and both monetary ceilings without provider entry. OpenAI project `Blawx` is verified Astra-only with a $1,000 enforced monthly limit, eight owner-email alerts, and 60 RPM / 500,000 TPM. Its service-account key is Restricted to model requests, with every unrelated API category set to None; it has no provider expiry, so a 90-day rotation reminder is planned. OpenAI, Supabase, IP-HMAC, and send-only Resend secrets are protected in Netlify for Production and Deploy Previews; the five-minute scheduled Resend worker is active on production and its isolated delivery test passed exactly once. One separately authorized paid smoke generated result `f935c1cc-b1e0-4217-8ead-5ca4bc17b04e` on `gpt-6-astra` with one request, zero retries, 19.185 seconds provider time, and $0.058780 actual spend. Launch verification served that result as a zero-cost production cache hit, recorded one deliberate database kill-switch rejection, and then enabled the final database switch without another paid call. Current controls are 3 fresh attempts per connection per UTC day, $200/day, $1,000/month, $0.20 reserved per request, and 10 concurrent generations; launch state is $0 reserved and zero active calls. `MONITORING.md` is the owner runbook.

## Launch outcome

Publish Blawx as an open-source portfolio app at a standalone Netlify URL and, after the standalone deployment is stable, proxy it at `https://mikemake.com/blawx/`. Visitors can explore saved sets immediately. Fresh generation turns on only after quota, spend, secret, concurrency, failure, and monitoring gates pass.

## Fixed safeguards

| Control | Launch value | Enforcement point |
| --- | ---: | --- |
| Fresh provider attempts | 3 per connection per UTC day | Atomic Supabase reservation before provider entry |
| Daily application ceiling | $200 per UTC day, editable | Same atomic reservation |
| Monthly application ceiling | $1,000 per calendar month, editable | Same atomic reservation |
| OpenAI project hard limit | $1,000 per month | OpenAI project settings, independent of the app |
| Per-request reservation | $0.20 maximum | Supabase ledger before provider entry |
| Concurrent fresh generations | 10 globally | Atomic lease in Supabase |
| OpenAI throughput | 60 RPM / 500,000 TPM | Project-level Astra limit |
| Application retries | 0 | Netlify Function/provider adapter |
| Provider fallbacks | 0 at launch | Netlify Function/provider adapter |
| Prompt length | 500 Unicode characters | Browser and Function |
| Provider input | 7,000 UTF-8 bytes after templating | Function, before reservation |
| Provider output | 2,000 tokens including reasoning | Fixed Responses request |
| Model/settings | `gpt-6-astra`, low reasoning, default tier | Fixed allowlisted request; no tools |
| Provider timeout | 50 seconds | Netlify Function/provider adapter; stays below Netlify's 60-second synchronous limit |

“Connection” means a privacy-preserving HMAC of Netlify’s trusted client-IP value and a server secret that rotates on a documented schedule. Raw IP addresses are never stored. Cache hits, saved examples, and requests rejected before provider entry are free and do not consume a slot. Once a provider request starts, the attempt consumes a slot even if it fails, because failed provider work may still cost money.

The $0.20 reservation is a fail-closed maximum, not an expected price. At official 2026-09-09 standard pricing, the fixed Astra profile uses a conservative $0.1875 content estimate: 7,000 input-token equivalents at a deliberately padded $12.50/M plus 2,000 output/reasoning tokens at $50/M. The remaining $0.0125 covers request overhead. Unknown usage is charged at the full reservation. Pricing changes fail the policy test until the reservation or request bounds are explicitly reviewed.

## Architecture

```text
Browser
  -> Netlify static app
  -> POST /api/generate (Netlify Function)
       -> validate body and trusted IP context
       -> look up an exact public cache hit (free path)
       -> Supabase reserve_generation(...) transaction
            checks kill switch, IP quota, day/month ceilings, concurrency
            records one attempt and reserves $0.20
       -> one OpenAI request with server-only project key
       -> validate bounded model output
       -> Supabase finalize_generation(...) transaction
            records actual spend and releases concurrency lease
       -> save the raw generation in the exact server-only cache
       -> return public-safe result
```

Supabase is the authority for quota and money state. A process-local counter, Netlify log, OpenAI dashboard alert, or browser cookie is never the primary spend control. All check-and-reserve decisions happen in one database transaction so simultaneous requests cannot each observe the same remaining budget.

## Supabase data contract

Create migrations in the repo and apply them through the connected Supabase tooling.

### Private tables

- `launch_config`: one active row containing `generation_enabled`, `daily_cap_micros`, `monthly_cap_micros`, `request_reserve_micros`, `daily_attempt_limit`, `concurrency_limit`, and `updated_at`.
- `connection_daily_usage`: HMAC connection identifier, UTC day, and attempt count; no raw IP address.
- `period_spend`: integer reserved and actual micro-dollars for each UTC day and calendar month.
- `generation_attempts`: request id, connection hash, UTC day/month keys, state, reserved micros, actual micros, lease expiry, provider request id if safe, timestamps, result id, and sanitized failure code.
- `spend_alerts`: threshold scope/value, period key, first crossed time, delivery state, and deduplication key.
- `generation_results`: exact cache key/version, normalized and submitted prompt, bounded raw voxel model, private source program, safe diagnostics/provenance, visibility, and timestamps.

Money is stored as integer micro-dollars. No floating-point comparisons decide whether a call can start.

### Browser read surface

- The result cache remains in `blawx_private`; browser roles cannot query it directly.
- Sanitized Netlify `/api/feed` and `/api/results/:id` endpoints expose only the bounded public fields needed by the feed.
- If thumbnails move to Storage, expose only the public result bucket or signed read path required by the UI.

### Database access

- Browser roles receive no access to private quota, attempt, spend, or configuration rows.
- RLS remains enabled on every private table as defense in depth, with no browser policies. Public feed reads will go through the sanitized Function surface rather than direct table access.
- Revoke function execution from `public`, `anon`, and `authenticated` for reservation/finalization functions; grant only to the server role.
- Reservation and finalization functions are `SECURITY DEFINER` only if required, use an explicit safe `search_path`, validate every argument, and are reviewed with Supabase security advisors after migration.
- The Supabase secret/service-role key is stored only in Netlify Function scope, never a `VITE_*` value.

### Atomic reservation rules

`blawx_reserve_generation(request_id, connection_hash, now)` locks the single config row and current day/month ledger rows, then rejects before provider entry if any of these is true:

1. `generation_enabled` is false.
2. An idempotency record already exists in a non-replayable state.
3. Three provider attempts already started for the connection in the current UTC day.
4. `day_actual + day_reserved + request_reserve > daily_cap`.
5. `month_actual + month_reserved + request_reserve > monthly_cap`.
6. Two unexpired generation leases are already active.
7. Required accounting state is missing or invalid.

On success it inserts the attempt, increments the connection’s attempt count, reserves $0.20 in both periods, and creates a 120-second concurrency lease. The Function may enter the provider only after this commit succeeds.

`blawx_mark_provider_started` fixes the boundary where an attempt becomes chargeable. `blawx_cancel_before_provider` is the only refund path and works only before that marker; it releases the reservation and attempt count while retaining a cancelled audit row. `blawx_finalize_generation` is idempotent. It converts the reservation to actual spend and releases the lease. Missing or untrusted usage charges the full $0.20 reservation. An actual charge above the reservation is recorded and atomically turns database generation off. Expired leases are charged as unknown at the full reservation and never silently refunded.

## What is cached

The launch cache deliberately does not store one monolithic “set + guide” object. Each layer has its own identity so a converter or instruction change cannot silently reuse stale downstream output.

| Artifact | Durable cache? | Current behavior |
| --- | --- | --- |
| Generated raw voxel set | Yes | Supabase exact cache keyed by normalized prompt, full fixed generation prompt, provider policy, schema version, and relevant options. A hit makes no OpenAI request and consumes no daily slot. |
| Private generator source program | Yes, server-only | Stored beside the raw set for provenance/debugging; never returned to the public browser response. |
| Packed brick placements | No | Deterministically recomputed in the browser construction worker when a detail page opens; retained only in memory for that mounted view. |
| Assembly and instruction steps | No | Deterministically rebuilt from the current converter/planner with the brick placements. |
| Instruction section labels | Separate exact-fingerprint cache | Existing static/private semantic receipts are reused only when the rebuilt guide fingerprint matches exactly. A mismatch falls back to truthful generic labels; launch generation does not make a second naming call. |
| Bundled examples and static assets | Yes | Shipped with the app and cacheable by Netlify's static CDN. |
| `POST /api/generate` HTTP response | No | Explicitly `no-store`; durable reuse happens in Supabase rather than a shared CDN POST cache. |

This caches the only paid step while leaving deterministic local work cheap and current. If derived artifacts later become too slow, add a separate versioned cache keyed by raw result id plus converter, planner, and semantic-guide versions; do not append them to the raw generation row without those invalidation keys.

## Function contract

`POST /api/generate`

- Accept only same-site JSON requests with body at most 4 KiB and exactly one `prompt` string.
- Normalize and validate 1–500 characters; reject control characters and unsupported content before reservation.
- Use an idempotency key generated by the server. A client retry cannot create another provider call for the same accepted request.
- Check cache before quota reservation using the normalized prompt plus generation version and relevant options.
- Make exactly one bounded OpenAI request. No automatic application retry, model fallback, or second semantic-naming call at launch.
- Validate schema, dimensions, occupied-cell count, output byte size, and unsafe fields before persistence or response.
- Return `429` for the connection quota and `503` for global capacity/spend/kill-switch closures. Include no internal cost totals, hashes, secrets, SQL messages, or stack traces.

Friendly quota copy:

> Blawx is getting a lot of building requests today. This connection has used its three fresh builds for now—try again after midnight UTC. You can still explore saved sets, or clone the repo and connect your own API key to build without this demo’s shared limit.

Friendly global closure copy:

> Fresh builds are paused for a bit while I keep the public demo within its budget. Saved sets are still available. Try again later, or clone the repo and connect your own API key.

## Defense in depth

- Global `GENERATION_ENABLED` Netlify environment kill switch plus database `generation_enabled`; either one being off prevents provider entry.
- One request in flight per connection and a short burst limiter before the database path.
- Netlify trusted-IP context only; ignore visitor-supplied forwarding headers.
- Daily-rotated IP HMAC secret with an overlap strategy for requests around UTC midnight; never log the raw IP.
- No anonymous endpoint that exposes quota/spend counters or confirms whether two visitors share an IP.
- Constant request/output bounds, one model/settings profile, and exact provider origin allowlist.
- Sanitized logs with request id and outcome code only. Prompt logging is off by default.
- Optional bot challenge can be enabled if abuse appears; it supplements rather than replaces the database limits.
- Dependency, secret, and public-bundle scans run before production promotion.

## Monitoring and notifications

Configure independent channels so one broken subsystem cannot hide spend:

1. OpenAI project budget notifications and the $1,000 enforced project limit.
2. Application alerts from the Supabase ledger at daily $100, $160, $190, and $200; monthly $250, $500, $750, $900, and $1,000.
3. Immediate alerts for kill-switch activation, unknown usage charged at reservation, reconciliation mismatch, repeated provider failures, and a ceiling rejection.
4. A scheduled reconciliation compares application totals with available OpenAI project usage/cost data. Any material mismatch turns database generation off before notifying.
5. Alert delivery is deduplicated in `spend_alerts`. Failed alert delivery does not re-enable generation or bypass a cap.

Implemented now: daily thresholds at 50/80/95/100%, monthly thresholds at 25/50/75/90/100%, unknown-usage alerts, and accounting-breach alerts are enqueued atomically. A Netlify scheduled function runs every five minutes on published deploys, claims with `SKIP LOCKED`, sends through Resend using the durable alert key as the provider idempotency key, and dead-letters after five failed deliveries. Missing mail configuration claims nothing. The queue, Resend adapter, disabled behavior, preview bundle, and mocked delivery path are verified; a send-only provider key and the recipient/sender are configured in Netlify. One isolated real delivery test was delivered and acknowledged exactly once.

Email is the proposed first channel. Mike supplies the recipient and configures the mail provider/API key outside chat; Codex can implement and test delivery with a mock first.

## Rollout sequence and ownership

| Step | Action | Owner | Current state |
| ---: | --- | --- | --- |
| 1 | Audit blawx4; preserve local-only provider and identify static/runtime split | Codex | Done |
| 2 | Add Netlify build config, relative/subpath-safe resources, and static no-provider UI | Codex | Done; build and focused tests pass |
| 3 | Build and deploy a draft Netlify site with generation disabled | Codex after Mike confirms it is a new site named `blawx` | Done; `https://blawx.netlify.app/` verified |
| 4 | Confirm Supabase organization, new project name/region, and displayed recurring cost | Mike | Done; Free Plan, $0/month, no paid add-ons |
| 5 | Create Supabase project and migrations; run security/performance advisors | Codex after step 4 | Done; quota/spend, alert-queue, exact result-cache, server-only feed-read, anonymous gate-rollup, and owner-dashboard migrations applied; rollback/live tests pass, kill switch off, advisor notes are informational/expected |
| 6 | Implement Netlify Functions and Supabase adapter against mocked OpenAI responses | Codex | Done; generation controller, connection hash, Supabase adapter, bounded one-request OpenAI adapter, and sanitized feed/detail handlers pass mocked HTTP tests |
| 7 | Configure OpenAI project, enforced limit, alerts, rate limits, and a project-scoped service-account key | Mike; Codex supplies click-by-click checklist | Done; $1,000 limit, eight alerts, Astra-only allowlist, 60 RPM / 500,000 TPM, and Restricted model-request-only service-account key saved; key has no provider expiry, so schedule 90-day rotation |
| 8 | Put OpenAI/Supabase/HMAC/Resend secrets in protected Netlify environment settings | Mike enters provider secrets directly; Codex generates the HMAC secret and verifies names/behavior without printing values | Done for Production and Deploy Previews; Resend is limited to Sending access and alert sender/recipient are configured |
| 9 | Run quota, race, cap, kill-switch, failure, secret, alert-queue, cache, and bundle tests | Codex | Done; effective 594/594 test checkpoint, production build, live zero-ledger canary refusal, exact concurrency/daily/monthly parallel-race outcomes, database behavior, alert queue and Resend adapter, cache/privacy, mocked failure paths, and source secret scan pass |
| 10 | Authorize one paid smoke test with an explicit maximum of $0.20 | Mike | Done 2026-09-10; separately authorized |
| 11 | Deploy a non-production canary, verify ledgers and alerts, then promote | Codex after gates pass | Done 2026-09-10; paid canary reconciled at $0.058780, production deploy `6aa28ec83ac423752756e077` passed the database-gated preflight, and public generation is enabled. |
| 12 | Add the `/blawx/` proxy in the portfolio repo and verify assets/API/hash routes | Codex after standalone stability | Not started |

## Mike’s required decisions/actions

These cannot be safely inferred or completed without Mike:

1. Confirm that there is no legacy Blawx Netlify site to reuse and authorize creating a new Netlify project named `blawx` in the connected team.
2. Confirm the connected Supabase organization, project name `Blawx`, region (proposed `us-east-1`), and the exact recurring cost returned by Supabase before creation.
3. Done: Resend is signed in; a Sending-access key is protected in Netlify and the alert sender/recipient are configured for Production and Deploy Previews.
4. Done: dedicated OpenAI project, $1,000 enforced monthly limit, alerts, Astra allowlist/rate limits, service account, and protected Netlify key are configured; Restricted model-request-only permissions and no provider expiry were verified before paid use.
5. Done: the bounded paid smoke test was explicitly authorized, completed, and reconciled at $0.058780.
6. Done for standalone public promotion. Portfolio navigation placement remains a separate decision.

## Autonomous Codex work

With standalone public generation live, Codex can:

- finish and verify the static draft code;
- create all database migrations and Function code locally with mocks;
- add unit, integration, race, failure, and bundle-secret tests;
- build, inspect, and deploy a non-production static draft after new-site confirmation;
- apply confirmed Supabase migrations, configure non-secret values, and run advisors after project creation;
- prepare exact OpenAI and email dashboard checklists;
- verify deployment health and portfolio subpath behavior without invoking the model.

Codex will not create a billable Supabase project without cost confirmation, paste or retrieve secrets, enable public generation, make any additional paid OpenAI call, promote generation, or change the portfolio site without the corresponding checkpoint above.

## Launch acceptance

Public generation is ready only when all checks pass:

- Static examples, guide rendering, hash routes, standalone URL, and `/blawx/` proxy work on desktop and phone.
- Three attempts are allowed and the fourth is rejected before provider entry; cache hits remain free.
- Parallel tests prove no daily/monthly overspend and at most two active provider calls.
- Provider failures still consume an attempt and record spend conservatively; pre-provider rejections do neither.
- Both kill switches fail closed.
- Application and OpenAI limits/alerts are visibly configured and one bounded alert path is tested.
- The production bundle and logs contain no secret or private accounting data.
- The one paid smoke test is reconciled to the ledger, then Mike explicitly approves promotion.

## Rollback

Turn off the Supabase `generation_enabled` switch first because it takes effect immediately, then set Netlify `GENERATION_ENABLED=false` and redeploy Production. Keep the static site and saved sets online. Revoke the OpenAI project key if misuse is suspected. Roll back Functions independently from the static build; never delete spend/attempt rows during incident response.
