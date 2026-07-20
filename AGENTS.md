# blawx2

Read `PLAN.md` for the project plan.

## Entry point

**Current state (2026-07-19):** live local generation is ON. The local
Worker (`../api`, wrangler dev on :8787) bills `ANTHROPIC_API_KEY` for any
novel term typed at the local Vite port (~$0.017/term FA-matched: ≤2 Sonnet
+ 1 Haiku color; +~$0.02 Replicate when FLUX sources the front). Every
result caches to local KV forever. Mike granted a **standing allowance for
spend below $5/session** (2026-07-12); above that, or for new spend shapes
(batch seeding, A/B sweeps, deploy-side spend, Replicate batches),
re-confirm per run. Restore `REPLAY=1` in `../api/.dev.vars` for
$0-by-construction.

`../api/.dev.vars` live config: `RATE_LIMIT_OFF=1` (Mike says when the
5-fresh/hr/IP limit goes back on; it stays mandatory for any real deploy)
and `DEV_ALLOW_LOCALHOST=1` (any localhost port passes CORS in dev; a
deployed worker honors `ALLOWED_ORIGINS` alone — currently
`https://mikemake.com`). Bounce the worker after editing `.dev.vars`.
Transient Anthropic 529 windows can kill runs mid-stream; retry.

**Interview demo runner:** `bash
/Users/michaeldeal/-Repos/prototype/blawx.proj/demo-up.sh` in a Terminal
(not via Claude — it dies with the session). Worker :8787 + built frontend
:5280 behind a crash watchdog. Demo URL `http://localhost:5280`.
`VITE_BLAWX_API` is baked at build time (`.env.local`) — rebuild blawx2 if
the target changes. FLUX cold-boot (~40 s, sometimes `failed`) makes novel
non-FA terms flaky in a demo: warm the model with a throwaway term first,
lean on cached terms.

**Known color caveats — most sets render near-single-color.** Two causes:
(1) the Haiku paint overlay drops out (failure/rejected repaint → uniform
fallback, cached as-is, silent by design); (2) the bigger structural gap —
voxel color = front cell by column projection, so accents on thin
un-voxeled features vanish (`apple`: clean 3-color paint stored as 420 red
+ 1 brown). Three vetoable fix directions are logged in the findings
report below. The seed4 shelf predates the color system;
`api/scripts/color-library.ts --confirm-spend` (~$0.06) + reseed is ready
pending Mike's go-ahead (it recolors the front silhouette only, so it
shares the projection loss).

**Read "Output quality — findings report (2026-07-19)" below before
touching generation quality** — it supersedes all earlier quality notes
(originals archived at `../blawx2-AGENTS-archive-2026-07-19.md`). Geometry
pipeline (Phases 1–4) settled — canonical exemplars below, journey in
`docs/voxel-history.md`. Phase 6 front-end complete through Stage 5 —
as-built log in `docs/build-log.md`. **Mike drives this thread with
Fable's top-tier reasoning** — this doc records the facts; the approach is
Fable's call.

## Output quality — findings report (2026-07-19)

Why generated sets often don't look like their search term. Supersedes the
2026-07-18 structural audit and its correction block (both archived
verbatim in `../blawx2-AGENTS-archive-2026-07-19.md`). Method: rendered
every cached grid (front-ortho + iso contact sheet, $0, local KV only) and
traced each failure class back through the code — the render eyeball found
what structural metrics could not. Structure numbers remain re-runnable
via `cd ../api && npx tsx scripts/audit-cache.ts` (caveat: its provenance
labels misclassify `grid.size === 8` entries as live).

### Root causes, ranked by evidence

1. **Cache contamination (was the worst offender; FIXED locally
   2026-07-19).** Five KV entries — `flower`, `acorn`, `skyscraper`,
   `ghost`, `human-body` — were 8³ grids from the retired prototype's
   `baseline-llm` "failure reference" set, seeded by `api/scripts/seed.ts`
   with hardcoded fake metrics (`components:1, floatingCount:0`,
   unmeasured). Quarter-scale junk no current code path produced,
   permanent until deleted. **Deleted from local KV 2026-07-19**; they
   regenerate live on next search. `seed.ts` still exists — do not run it
   against any KV that matters. Detection: `grid.size === 8`.

2. **FA term→icon semantic traps.** The 7,509-term lookup is FA's
   alias/search metadata — "typing this should surface this icon in a
   font picker," not "this icon depicts this noun." In the cache:
   `grapes` was built from **wine-bottle**. Also live in the index:
   `castle → chess-rook`, `skyscraper → building`, `crab → cancer`
   (zodiac), `elephant → republican` (GOP logo). `castle` is the
   canonical example that semantic failure is invisible to every stored
   metric: wrong object, yet `components:1`, grounded, not degraded.

3. **FA glyph fragmentation at 16×16 — 48% of the index.** 965/1,997
   icon masks go multi-component after the downsample (glyph stripes,
   gaps, outlines survive as disconnected chunks); 3,603/7,509 lookup
   terms resolve to such an icon; 88 icons have <60 filled cells.
   Because the front mask is authoritative and `repairFrontProtecting`
   guarantees every front cell voxels, a fragmented mask **guarantees** a
   multi-piece degraded set before any model call. Cached examples:
   `candy-cane` (5 pieces), `rainbow` (4), `bowl` (2 — the icon's
   floating garnish).

4. **The live FLUX route ships uncurated — 4 of 5 real FLUX entries are
   degraded** (`peanut`, `squid`, `submarine`, `pants`; `banana` clean).
   The offline path that built the library had hand-authored
   subject+view per noun, 4 candidates per noun, 512² previews, a human
   pick, and dropped its misses (`ladder`, `flower`). Live `flux.ts` has
   a generic `"a {noun}, side view"` prompt, one shot (second seed only
   on API failure), `MIN_FILLED_CELLS = 20` (a readable 16³ front needs
   ~100+ cells), no readability check, and discards the PNG + mask — so
   failures can't even be diagnosed afterward.

5. **The recognizable view is never rendered.** By construction the
   grid's straight-on front projection equals the source mask cell-exact
   (verified: `helicopter`, `star`). The app only shows 30° iso (camera
   along +(1,1,1) — the mirrored back view), where depth smears into the
   silhouette: `bowl`/`star`/`helicopter` read fine front-on and as
   unrecognizable masses in iso. Invisible to float/component metrics.
   Contributor: Sonnet's stair-stepped per-part depth reads as rubble at
   45°, where the library's smooth flat/inflate profiles don't — the
   probe6-vs-library structural parity hid this perceptual gap.

6. **Amplifier: no quality gate + permanent cache.** Nothing rejects,
   retries, or labels a bad output (`x-degraded` is computed but unread
   by the UI); degraded results cache forever by design.

### Why benchmarks looked good but live doesn't

`seed4-16char-mixed` and `probe6-16char-sonnetdepth` validated
**depth-under-curation**: hand-picked fronts (per-noun source hardcoded in
`seed-library.ts`), human candidate selection on FLUX, misses dropped from
the library, Mike's-eyeball QA gate on everything. The live product runs
the same depth pipeline over an uncurated front funnel with no gate.
Nothing regressed — human curation was doing the quality work, and it's
exactly the part that didn't ship. probe6 only ever proved "Sonnet can add
depth to a known-good silhouette"; that still holds (`tractor`, `banana`
come out fine when the front is clean).

### Decisions (Mike, 2026-07-19)

- **FA vetted whitelist: approved.** Replace the raw alias table with a
  vetted subset. Mechanical pass (drop fragmenting/sparse icons) is $0;
  an optional one-time vision pass over surviving term↔icon pairs (~$2)
  needs its own sign-off.
- **Iso stays.** 30° (variants OK, but isometric). The front-on hero
  moment is off the table for now — remedies for cause 5 must work
  within an isometric presentation (e.g. smoother depth, angle variants).
- **Per-term budget may stretch** past $0.01–0.02 when it buys visibly
  better results (candidates, judge calls, retries). Cache-once
  economics make this a one-time cost per term.
- **Production is auto-pick only.** No human selection in the public
  live path. Midjourney-style "generate k, user picks one" is a **pinned
  fallback** to revisit if auto-judging falls short; human picking
  remains fine for R&D and offline seeding.
- **Probe7 greenlit — the "no-mask" hypothesis.** The silhouette-sourcing
  apparatus exists because 2024-era LLM voxel authoring failed at 8³ in
  the old repo; nobody had tested whether current Sonnet with the probe6
  exemplar/validator machinery can author ALL THREE views from the noun
  alone. If it can, the sourcing problem (traps, fragmentation, FLUX
  flakiness) dissolves. Run: `runs/probe7-16char-nomask/` — 10 nouns
  spanning the failure classes (comparables duck/fox/table; trap terms
  grapes/castle/crab; FLUX-degraded submarine/peanut; thin-feature
  helicopter; skyscraper). Executed via subscription subagents ($0,
  Sonnet 5 with adaptive thinking — NOT the thinking-disabled runtime
  profile; a positive result needs a thinking-disabled A/B before it
  reshapes the Worker).

  **Probe7 VERDICT (run 2026-07-19, same session): full authorship
  works.** All 10 converted at ~production call profile (1 shot + 1
  feedback retry); structure: **9/10 clean** (1 component, grounded;
  only `crab` degraded, 2 comps via a claw disconnecting across depth) vs
  56% degraded on real live-FA and 80% on real live-FLUX. Semantics
  (Fable eyeball, contact sheet): clear wins over the current cache on
  every trap/FLUX term — `castle` is an actual 3-tower castle (vs chess
  rook), `grapes` a hanging cluster (vs wine bottle), `submarine` reads
  as hull+sail+periscope (vs box + floating cube), `helicopter`/`peanut`
  beat their degraded cached versions; parity on `table`/`duck` vs the
  curated library; `fox` slightly below the curated FA fox; `skyscraper`
  reads more ziggurat than skyscraper (recognizable, grounded, clean).
  Caveats logged for the productionization decision: (1) **9/10 first
  drafts made the same top-view z-mirror error** (top drawn back-to-front
  inverted), burning the single retry on a mechanical fix — and one retry
  (`skyscraper`) re-introduced it and was fixed by the Worker-equivalent
  topZ flip; a 16³ exemplar or a sharper top-view convention line in the
  prompt should reclaim the retry for quality; (2) adaptive thinking was
  on (subscription route) — needs the thinking-disabled A/B at the real
  cost profile (~2 Sonnet calls, est. $0.03–0.05/term with authored
  front) before wiring into the Worker; (3) iso stair-step lumpiness is
  unchanged from probe6 — full authorship fixes *what the object is*,
  not the depth-texture aesthetics (that remains cause-5 work under the
  iso-stays decision).

  **Probe8 (prompt v2, run 2026-07-19): the z-mirror is fixed; 10/10
  clean structure.** Root cause confirmed: probe7's dog exemplar had a
  front-back **symmetric** top view — it carried zero signal about the
  back-to-front row convention, so the model had to guess. Prompt v2 =
  new `DOG_Z` exemplar (head hugs the front half of the depth, tail the
  back half, so the top view itself demonstrates the convention;
  `scripts/exemplars.ts`, validated zero-loss) + explicit back/front row
  anchoring in the top-view line (`scripts/make-probe8-prompts.ts`).
  Same 10 nouns, same call profile (subscription subagents, $0,
  adaptive thinking — A/A vs probe7). Results: depth-convention errors
  on first drafts **9/10 → 3/10** (2 true mirrors: skyscraper, grapes;
  1 centered offset: castle). **4/10 first drafts fully clean** (duck,
  fox, submarine, peanut needed no retry at all, vs ~1/10 in probe7);
  the other 3 retries were spent on real quality fixes (table footprint,
  crab and helicopter hollow front cells) — the retry is substantially
  reclaimed for quality. Structure: **10/10 single component, grounded,
  zero reprojection loss** (except crab front loss 1.75%, cosmetic) —
  probe7's one degrader (crab, disconnected claw) is now clean.
  Semantics (Fable eyeball on the iso renders): parity-or-better vs
  probe7 — castle is a real 2-tower castle with battlements and a gate,
  helicopter reads rotor slab + cabin + tail + skids, table and fox are
  notably clean, peanut properly two-lobed, submarine hull + sail +
  periscope; skyscraper still reads ziggurat; iso stair-step lumpiness
  unchanged (cause-5 work). Residual: skyscraper's final top view still
  trips the advisory slab-footprint heuristic (box-shaped object —
  arguably a false positive for towers). Artifacts:
  `runs/probe8-16char-nomask/` (`responses-call1/` holds first drafts
  for the convention-error tally; viewer run `probe8-16char-nomask`).
  Prompt v2 is the candidate production prompt.

  **Probe9 (thinking-disabled A/B, run 2026-07-19, live API, $0.12
  actual): FALSIFIED — thinking is load-bearing for full authorship.**
  Same prompt v2, same 10 nouns, called at the exact runtime profile
  (`claude-sonnet-5`, `thinking: {type: "disabled"}`, `max_tokens`
  2048 — mirroring `../api/src/index.ts`), single-shot + 1 feedback
  retry. Result: **0/10 mechanically clean after the retry** (probe8:
  10/10 clean lifts). The dominant failure is basic: rows that aren't
  16 characters (e.g. table's front rows are literally 15 chars) — the
  model can't hold the row-width constraint without thinking, and
  retries reintroduce the same class. Lifted anyway for the contact
  sheet: massive reprojection losses (up to 0.9; probe8 was 0.0
  everywhere) and up to 26 malformed rows per response. Run:
  `runs/probe9-16char-nothink/` (prompts copied verbatim from probe8;
  runner script lived in the session scratchpad, not the repo — call
  params are recorded in `run.json`). 20 calls, 35.8k in / 4.5k out,
  ~$0.12 at Sonnet 5 intro pricing. Implication: the authored-front
  route must run with thinking ON, so its real cost profile is
  adaptive-thinking Sonnet calls, not the thinking-off profile the
  current Worker pipeline was tuned against.

  **Probe10 (adaptive-thinking API A/B, run 2026-07-20, live API,
  $1.61 actual): quality reproduces, cost does not.** Same prompt v2,
  direct API, `claude-sonnet-5` + `thinking: {type: "adaptive"}` at
  default effort, `max_tokens` 8192. Two findings. (1) **Quality:** the
  3 nouns that completed within the cap (table, grapes, skyscraper) are
  probe8-grade — zero-loss lifts, single component, grounded. Adaptive
  thinking over the API reproduces the subscription results when it has
  room. (2) **Cost/latency kills the naive wiring:** at default effort,
  thinking consumed the entire 8192-token output budget on **8/10 first
  calls and 7/10 retries** (empty answers — "front mask missing"), and
  even the successes spent 2.6k–6.2k output tokens per call. Measured
  per-term cost: $0.05 (skyscraper, 1 call) to $0.13 (table/grapes,
  2 calls); the truncated nouns burned $0.19/term producing nothing.
  Extrapolated full-budget default-effort cost: ~$0.2–0.4/term —
   10–20× the $0.01–0.02 target and well past the stretched budget.
  Run: `runs/probe10-16char-adaptive/` (per-call tokens in
  `usage.json`; runner in session scratchpad, params in `run.json`).
  20 calls, 102k in / 141k out, $1.61 at intro pricing — double the
  sign-off estimate; cumulative session API spend $1.73. The obvious
  untested lever: `output_config.effort` ("low"/"medium") to cap
  thinking spend — Sonnet 5 respects effort strictly, and probe8's
  subscription subagents produced the same answers with far less
  visible deliberation.

  **Probe11 (effort-capped adaptive, run 2026-07-20, live API, $1.59
  actual across both arms): FALSIFIED — the effort lever is dead for
  this task.** Same prompt v2. Arm 1, `effort: "low"` on all 10 nouns
  ($0.75): **3/10 clean** (duck, castle, crab). The revealing pattern
  is bimodal thinking spend — the 3 successes came from calls that
  *ignored* the low setting and thought 6–7.5k tokens anyway, while
  every call that actually stayed cheap (227–900 output tokens)
  produced probe9-class garbage (malformed rows, z-mirrors, bounds
  mismatches), and 2 calls still hit the 8k cap. Arm 2,
  `effort: "medium"` on the 7 low-failures ($0.84): **2/7 recovered**
  (submarine, peanut); 5/7 first calls hit the 8k cap outright.
  Best-of pipeline (low, then medium): **5/10 clean** at ~$0.16/term
  all-in — strictly worse than probe10's default effort on quality and
  no cheaper. Net finding across probes 9–11: this task needs ~5k+
  thinking tokens for clean output; capping via effort (or the 8k
  max_tokens budget) produces failures, not cheaper successes. Live
  full authorship on the direct API costs **~$0.10–0.20/term at
  quality** — roughly 10× the $0.01–0.02 target — and there is no
  remaining parameter lever to close that gap. Runs:
  `runs/probe11-16char-effortlow/`, `runs/probe11-16char-effortmed/`
  (per-call tokens in each `usage.json`; z-mirrored finals collapse to
  zero-voxel hulls on the contact sheet — expected, the side/top depth
  cells don't intersect). Cumulative session API spend: $3.32.

## Spend guardrail (load-bearing)

**No direct Anthropic API calls during R&D.** All model interactions
during Phases 1–4 go through Mike's Claude subscription — this Claude
Code session or fresh chats on claude.ai. Do NOT:

- Add `ANTHROPIC_API_KEY` to `.env` / `.dev.vars`
- Import `@anthropic-ai/sdk` or `fetch('https://api.anthropic.com/…')`
  from harness code
- Run dev servers that proxy to Anthropic on request (this includes
  `netlify dev` / `wrangler dev` if they'd hit the model)
- Wire the harness's generator or scorer to any live API

The harness is a **human-in-loop scaffold**. It stages prompts and
renders outputs; the model response comes from Mike's active Claude
session, pasted into a results file the harness reads. Cost is tracked
as *hypothetical* per-token math (what the call would cost at API
prices) — nothing is actually billed.

**Same rule applies to Phase 5 v1 (cache-only ships from the seed4
library — no live-gen wiring yet).** The v2 live-gen work will change
this, but only with an explicit round of sign-off first, and cost
targets from Phase 1–4 (below) carry forward.

Target per unique term when shipped: **$0.01–0.02**, ≤ ~10 s per
cache-miss.

## Stack

Vite + React + TypeScript strict (incl. `noUnusedLocals`,
`noUnusedParameters`). Tailwind is fine. No UI kits, no charting
libraries. Reasonable devDep adds are fine — flag deps only if the
runtime footprint is non-trivial.

## Substrate to reuse from the sibling repo

The prior prototype at `../blawx/` is not authoritative for the
generation pipeline, but a substantial portion of the v1 skin +
booklet + serving substrate is directly reusable — port with an upsize
from 8³ to 16³:

**Rendering (LEGO skin at 16³):**
- `../blawx/src/render/iso.ts` — true 30° iso projection,
  `x' = (x - z) · cos30° · 22`, `y' = (x + z) · sin30° · 22 - y · 22`.
  Must match `src/bench/isoRender.ts` constants for geometric alignment.
- `../blawx/src/render/Brick.tsx`, `Scene.tsx`, `palette.ts` — 7-color
  indexed brick renderer with palette assignment. Locked to 8³ in the
  old repo; needs upsize.

**Voxel processing:**
- `../blawx/src/voxel/pack.ts` — brick packing (currently 1×1 plates;
  ratchet to 1×2 / 2×2 / 2×4 in later tiers).
- `../blawx/src/voxel/steps.ts` — step decomposition for the booklet.
- `../blawx/src/voxel/{analyze,projections,transform,types,loadVox}.ts`
  — voxel utilities.

**Booklet UI:**
- `../blawx/src/booklet/{Booklet,StepPage,InventoryPage,TitlePage,
  FinalPage,Gallery,Workbench,Comparison}.tsx` — full booklet UI at
  8³. Port + upsize.

**Cache + noun input:**
- `../blawx/src/api/{generateClient,mockCache,slug}.ts` — cache client
  + slug normalization. Wire against the `../api/` Worker route
  (`g:<slug>` key, infinite TTL, 5 fresh/hr/IP;
  `ANTHROPIC_API_KEY` already wired as a Wrangler secret for v2).
- `../blawx/src/search/SearchLanding.tsx` — noun input landing.

## Prior attempts — look, don't import

Frozen snapshots of prior generation attempts live in
`../blawx/src/voxel/generated/baseline-*` (baseline-llm, -point-e,
-shape, -shapenet, -objaverse, -stabletext2brick, and variants). Look
at them as **failure references** — they show where organics fail and
how (silhouette collapse, coin-extrusion, wrong body plan). Do NOT read
the code, prompts, or design notes that produced them.

## Judged examples

None as a labeled dataset. The `baseline-*` snapshots above are the
visual reference set for "this is what bad looks like." The Phase 1–4
canonical exemplars below are the visual reference set for "this is
what shippable looks like at 16³."

## Run metadata (required)

Every `runs/<id>/` directory intended to appear in the contact-sheet
viewer **must** contain a `run.json` with at least `id`, `label`,
`date` (ISO `YYYY-MM-DD`), and `pipeline`. The viewer sorts, groups,
and filters on these fields — a missing manifest shows up as a
metadata-less row (dash date, sink to the bottom on date sort) and
breaks group-family filtering. Applies to gen batches and source-image
runs too, not just benchmark rounds — anything that lands in `runs/`.
`sheet-selftest`-style script sanity checks with no JSON at the top
level of the run dir are fine to omit, since the viewer never picks
them up.

Any script or workflow that creates a new `runs/<id>/` directory
should write `run.json` in the same pass. See existing manifests for
tone (label is a short human name; pipeline is a one-sentence
description of the process, not a novel).

## Phase 1–4: geometry pipeline (settled)

**Canonical geometry:** `runs/probe6-16char-sonnetdepth/` — seed4
verbatim front mask (FA icon or FLUX.1 schnell PNG) + Sonnet-designed
side/top conditioned on front, deterministic retry loop. 16³ char
encoding. 2-call typical (single-shot + 1 deterministic retry); 3-call
when a z-mirrored top view fires. Sonnet list-price ≈$0.012 (2-call) to
$0.018 (3-call) per term — inside the $0.01–0.02 target. Executed under
the R&D subscription route → $0 actual.

**Canonical library:** `runs/seed4-16char-mixed/` — 28/30 nouns seeded
at $0-heuristic depth (`flat` / `inflate` / `prone` profiles per noun).
Misses: `ladder`, `flower` (features thinner than one grid cell in
schnell output). This is the library the v1 toy ships against.

**Settled decisions:**

- **Front-mask sourcing** (hardcoded per-noun in
  `scripts/seed-library.ts`): Font Awesome 6 solid (vendored via
  `@fortawesome/fontawesome-free`, CC BY 4.0) OR gen1 FLUX.1 schnell
  PNG (`runs/gen1-16char-flux/raw/*.png`, one-time ~$0.003/img via
  Replicate). No live image API in library seeding.
- **Depth authoring**, options in order: (a) deterministic profile
  (`flat` / `inflate` / `prone`) — free, no failure modes, the seed4
  route; (b) Sonnet-designed conditioned on verbatim front, 2–3 call
  runtime — the `probe6` route, higher structural quality (best delta:
  `table`, `rocket ship`), motion parity or better on animals. The
  probe6 route is the runtime shape v2 will call live; v1 ships
  cache-only over both.
- **Model tier at runtime**: Fable off the table (assumed
  unaffordable per-request); Sonnet 2–3 call is the shipping tier;
  Haiku broken; Opus marginal.
- **Retired approaches** (kept in code as history, not to be revisited
  without an explicit vetoable hypothesis): `round(N)` and `round2` depth
  profiles; the sheet route (single orthographic model sheet → 3-view
  hull, `gen2-16char-sheets`); render-side shading experiment;
  Haiku/Sonnet blind-name as an R&D quality gate (verified to invert
  quality ordering).

**Working QA gate:** Fable eyeball against the contact-sheet viewer
(`npm run dev`). Mike's viewer verdict is the instrument that counts.

**Reusable infrastructure (all $0):**
- `scripts/lib/silhouette.ts` — front-mask acquisition (SVG or
  luminance-downsample from PNG) + depth profiles.
- `scripts/retry-feedback.ts` — deterministic validator with
  `--trust-front`, `--max-depth=N`, top-slab advisory. No model calls.
- `scripts/seed-library.ts` — noun-keyed offline library pipeline.
- `scripts/convert-response.ts` — parses Sonnet responses into voxel
  JSON; records `meta.masks` so runs render mask thumbnails in the
  viewer.
- `src/bench/*` — neutral iso renderer, hull lift, encoding parsers,
  hypothetical cost math.

**Known deterministic fixes** (status as of the v2 Worker port,
2026-07-09):
- **z-flip orientation search** — ✅ WIRED in the Worker
  (`../api/src/orientation.ts`): the 8-orientation flip search +
  front-protecting repair ported from `scripts/gen-sheets.ts` now runs
  on every live-gen response before the hull lift. (The offline
  `alignBboxes` full-depth-stretch reconciliation was never ported —
  the flip search replaces it.)
- **Top-slab advisory per-category exemption** — still open. The
  advisory false-positives on genuinely rectangular objects (fires on
  `table`, which is correct as drawn). In the Worker it can trigger an
  unnecessary (but harmless) second model call on box-shaped nouns; an
  exemption list is a production nicety, not a blocker.

**Journey behind these facts:** `docs/voxel-history.md` — probe-by-probe
log of what was tried and settled.

## Phase 5: pipeline v1 (active)

Target: **user types a noun → LEGO booklet appears.** v1 ships
cache-only against the seed4 library; **v2 goal is live generation on
cache miss — the magic moment: type any noun, watch it get built.**
Naming the v2 destination now because it shapes v1 caching decisions
(KV key shape `g:<slug>` and slug normalization must be
forward-compatible with live-gen misses, not just library lookups).

Most of the minimum-tier substrate already exists in `../blawx/src/` at
8³ — see "Substrate to reuse" above. Phase 5 minimum is mostly a **port
+ upsize from 8³ to 16³**, not a build from scratch. blawx2's `src/`
today only holds the benchmark harness (`bench/`, `App.tsx`).

**Build status (steps 1–5, all ✅ code-complete + verified offline/$0):**
LEGO skin at 16³ → minimum instructions view → front-end → cache seeding +
KV read-path → v2 Worker miss-path port. Step-by-step as-built log:
`docs/build-log.md` (Phase 5).

**Load-bearing facts from step 5 (the v2 Worker miss-path — what open-search
flips live):**
- **Worker miss path** (`../api/src/{generate,probe6,orientation,faIndex,
  masks,hull,color,exemplar}.ts`): probe6 Sonnet route, retry-feedback
  validator (trust-front, depth cap 6, top-slab) as a pure function, one
  feedback retry → max 2 model calls, trusted front replaces the model's
  front before lift, z-flip 8-orientation search + front-protecting repair,
  strict hull lift, NOUN_COLOR (lightGray fallback). No FA match → 404
  `code:'no-source'`.
- **FA front-mask index**: `scripts/build-fa-index.ts` (`npm run fa-index`)
  writes `../api/src/fa-index.json` — 1997 icons as grounded 16×16 masks +
  7,509-term lookup, bundled into the Worker (104 KB gz), zero runtime
  rasterization.
- **Model config**: `claude-sonnet-5`, maxTokens 2048, 30 s/call timeout,
  `thinking:{type:'disabled'}` set **explicitly** (Sonnet 5 defaults to
  adaptive thinking, which would blow the tuned 2–3-call cost/latency
  profile — revisit as a live-test A/B knob).
- **Verified offline ($0)**: 32/32 Worker tests, `tsc` clean, end-to-end
  duck replay reproduces the offline conversion exactly (360/360 voxels,
  2 calls, not degraded). No Anthropic call has ever been made.

**Palette decision for v1 (2026-07-06), superseded 2026-07-12:** single
hand-authored color per noun. The color system (next-bets item 2, below)
replaced this with a model-painted front overlay; the `NOUN_COLOR` tables
(client seed4 adapter + Worker `color.ts`) survive as the fallback when
the overlay call fails or is absent. As-built: `docs/build-log.md`
("Color system").

**Skipped for v1 minimum (do NOT port unless promoted):**
- `../blawx/src/voxel/{projections,transform,analyze}.ts` — only used
  by deferred booklet files.
- `../blawx/src/voxel/{loadVox,sampleDuck,sampleTree,sampleHouse}.ts`
  — `.vox` file loader + hand-authored 8³ demo data.
- `../blawx/src/booklet/{Comparison,Gallery,Workbench}.tsx` +
  `comparisonCosts.ts` — cost-comparison / gallery / hand-editing UI
  that's evaluation infra, not the shipped booklet.

**Ratchet up after v1 ships (in order of ambition):**

- **Middle-tier instructions:** ✅ LANDED 2026-07-13 (Lever A — see item 3
  below), refined same day per Mike's feedback. `pack.ts` greedy packer over
  the real LEGO System catalog (`1×{1,2,3,4,6,8}`, `2×{2,3,4,6,8}` + rotations),
  color-bounded, running bond via per-layer axis parity. Candidate order is
  **commonality-ranked** (`FOOTPRINT_PREFERENCE`, 2×4 workhorse), NOT largest-
  area — so 2×6/2×8 stay legal but rarely fire (intentional). `Brick.w/d` +
  `BrickFootprint` widened `1|2` → `number`. **Render: 1 voxel = 1 brick** —
  default `BrickStyle` is now `'brick'` (height ratio 1.0 + studs) in
  `Brick.tsx`/`Scene.tsx`, replacing the old ambiguous 0.8 `'plate'` default;
  `'plate'`/`'cube'` kept for later use. `pack.test.ts` (8 invariant tests, incl.
  8×2→two 2×4 and no-brick-larger-than-2×4-on-clean-region) + one earlier
  `steps.test.ts` fixture fix; 50/50 pass, `tsc` clean, verified in-browser on
  the idle yellow `duck` (tall brick walls, 2×4 running bond, no console errors).
- **v2: live generation on cache miss (the magic moment).** Wire the
  probe6 route (Sonnet + validator + retry) into the `../api/` Worker.
  Front-source live: FA icon lookup first, FLUX schnell on miss.
  Retire the "no-live-API" rule for the shipped surface only. Requires
  the z-flip fix noted above.
- **Ambitious instructions:** exploded assembly diagram, sub-assemblies.

**Standing constraints inherited from Phases 1–4:**
- Cost target ≤ $0.01–0.02 / unique term, ≤ ~10 s per cache-miss.
- Never depend on Fable-tier at runtime.
- Cache seeding remains $0 via subscription subagents; live-gen R&D
  requires per-run sign-off under the spend guardrail.

**Remaining rungs** (the open-search work is rung (a) — see the Phase 6
"Next action" block below for the canonical, detailed entry point):
- **(a) Live end-to-end smoke test** — ✅ landed 2026-07-12 (helicopter +
  tractor, first billable calls; see Phase 6 Next action item 1).
- **(b) Frontend miss-path UX** — ✅ delivered by Stage 3b (streamed build
  log + distinct `no-source`/rate-limit/upstream failure copy). The copy
  paths are typed but not yet exercised in-browser (replay always succeeds);
  they get exercised for real when (a) goes live.
- **(c) FLUX-schnell front sourcing on FA-index miss** — ✅ LANDED LOCALLY
  2026-07-14. Non-FA terms now build instead of returning `no-source`.
  As-built in `../api/`: `src/silhouette.ts` (pure PNG→16×16 mask, ported
  from `scripts/lib/silhouette.ts`, `Uint8Array` not `Buffer`, `fast-png`
  decode normalized to RGBA), `src/flux.ts` (`fluxFrontMask` — Replicate
  `black-forest-labs/flux-schnell`, `Prefer: wait` + poll, generic silhouette
  prompt), wired at `generate.ts` behind a new `callFlux` param that
  `index.ts` builds only when `REPLICATE_API_TOKEN` is set (unset = old
  `no-source` behavior, fully back-compat). Tests: 2 new silhouette unit
  tests vs. real FLUX fixtures, 53/53 pass, tsc clean. **Verified live
  ($0.02×2 under the sign-off):** `peanut` → 233 voxels (degraded — thin-
  feature artifact, still renders), `submarine` → clean + colored. Both
  cached. **Cold-start caveat:** the first call after the flux-schnell model
  goes idle can take ~40s to boot; the initial live run failed on a cold
  model, every warm call succeeded. Poll deadline bumped to 150s to absorb
  it, but the reliable demo mitigation is to **fire one throwaway term to
  warm the model right before screensharing**. Degraded-on-thin-features is
  the known Lever B limitation, not a FLUX bug.
- **(d) Production ship** — ✅ GREENLIT 2026-07-14. Create remote KV
  (`wrangler kv namespace create CACHE`/`RL`), `wrangler secret put
  ANTHROPIC_API_KEY`, `npm run deploy`, `seed4.ts` (no `--local`, $0) to
  remote KV, point blawx2's build at the Worker URL via `VITE_BLAWX_API`.
  **Frontend host: mikemake.com subpath** (via the subpath-deploy skill;
  `ALLOWED_ORIGINS` already lists `https://mikemake.com`). **Gates:**
  `wrangler login` (not currently authenticated) + a fresh sign-off for the
  first live Anthropic spend on a public URL. Prod `vars`: `RATE_LIMIT_OFF`
  unset (per-IP limit ON), `CACHE_ONLY` unset (live-gen on).
  **Abuse posture (Mike 2026-07-14): per-IP limit only for launch** — the
  5-fresh/hr/IP limit is the sole guard; a determined IP-rotating abuser can
  run up the bill. **Deferred roadmap item: a global daily spend ceiling** (a
  KV day-counter that reverts to cache-only past $N/day) — add before the
  demo sees real traffic volume. Rung (c) and (d) are independent; fastest
  path to a showable demo is (d) FA-live first, then layer (c) FLUX.

**Cost-model constraint (still load-bearing):** the deployed Worker has
no subscription route — every live gen bills `ANTHROPIC_API_KEY` directly
(~$0.014–0.020/term, ≤2 Sonnet calls + 1 Haiku color-overlay call). Every
result caches to KV, so each
term is paid once ever. `CACHE_ONLY=1` keeps the surface $0 by construction
until the live test is signed off.

## Phase 6: front-end overhaul (active)

Brief (2026-07-10): overhaul the shipped front-end into a single
mobile-first surface styled faithfully after **vintage LEGO instruction
manuals** — modernist, minimalist, Bauhaus/Swedish. Everything in the
app derives from that reference. Desktop is a later pass once mobile is
right.

**Reference:** the Figma Make mockup at `../mobile-landing` (single-file
`src/app/App.tsx`; the local checkout was stale — fast-forwarded to
origin `0864672` on 2026-07-10). Take its **structure**, reject its
execution:
- KEEP — mobile-first; a persistent isometric-brick stage as the
  constant motif across idle / loading / result; an intro
  fall-into-place; a status log during the (non-instant) build; the
  "name your set + pick from a few options" generation UX.
- REJECT — its brick renderer (gradient faces, ellipse studs, no
  outlines): use ours (`render/Scene.tsx`, black outlines). Its smooth
  float/bounce easing. The name "BrickGen". The three outward "links" in
  the done state. The copy "p. 01" and "16 × 16 × 16 · booklet included".

**Name:** "Blawx" (not BrickGen). Logo/wordmark in our own block style.

**Locked decisions (2026-07-10):**
- Establish the design language as code (Stage 0) before layout.
- The idle stage shows a **random real pre-cached set** from the library
  (not an abstract build) — it advertises what the app makes.
- The done state collapses into **one vertical scroll**, no outward
  navigation: persistent iso model (hero) → our `Booklet` (whose first
  page is already the parts inventory → step pages). One scroll covers
  the mockup's three links (3D model, parts list, booklet) in the view
  you are already on.
- "Build another set" lands at the **end of the scroll** (the natural
  finish point) — try this before anything cleverer.

**Architecture shift:** from two screens (`SearchLanding` → `?q=` route →
`BookletView`) to **one morphing surface** (idle → loading → result)
with the iso stage always present. `?q=<noun>` stays as a deep-link that
lands directly in the result.

**Stages (each independently vetoable):**

0. **Design language as code.** ✅ Done. `src/design/tokens.css`
   (palette derived from the real brick colors in `render/palette.ts`,
   type scale, rule weights, stud-based spacing, sharp corners) +
   `src/design/motion.ts` (stop-motion principles + timing constants).
   Governs everything downstream. UI chrome is unified onto the brick
   palette (token `--accent` and the render palette move together, so UI
   and bricks stay locked). **Current canonical accent = authentic LEGO
   yellow `#FFCC00`** with black text — switched from brick red `#C8102E`
   in the Stage 2 refinement pass (see `docs/build-log.md`).
1. **Front surface.** ✅ Done. Single morphing surface: idle iso stage (random
   pre-cached set) → "Name your brick set" → ≤7 randomized pre-cached
   picks (replaces today's full numbered library list) → loading. Our
   renderer throughout. Drops the retired copy.
2. **Unified result scroll.** ✅ Done (2026-07-10). Persistent iso hero →
   `Booklet` (inventory → steps → final). Kill the three links. "Build
   another set" at
   end-of-scroll. NO cards / drop-shadows — the ported `pages.css` uses
   shadowed `.page` cards; replace them. Arrange the steps flush
   vertically, separated by a brick-weight (1px) rule matching the brick
   stroke, so the scroll reads as one manual, not a stack of cards.
   Entry points: `src/booklet/{Booklet,StepPage,InventoryPage,TitlePage,
   FinalPage}.tsx` + `pages.css` (restyle away from cards, onto the
   design tokens); `src/App.tsx`'s `BookletView` (swap the old result for
   the new hero-plus-scroll); reuse the iso-hero + grid→bricks pattern
   from `src/surface/Surface.tsx`. Also fold in the stroke-vs-scale fix
   noted below now that brick size becomes intentional per step.
3. **One morphing surface + streamed honest miss-path log.** ✅ Landed
   2026-07-10, all $0 via duck replay. 3a = the persistent shell
   (`src/shell/{Shell,shell.css}`) so the masthead + iso stage never unmount
   across idle → loading → result (only below-the-seam content swaps); 3b =
   the streamed SSE build log (`src/build/`) + the front brick layer
   assembling on the stage during the model wait. Honest step mapping, the
   SSE frame contract, and the $0 replay harness: `docs/build-log.md`.
4. **Stop-motion animation pass.** ✅ Landed 2026-07-12. `AnimatedStage`
   (legoMovie profile) wired into the persistent shell; the stage assembles
   its set on each change (idle re-roll / front-mask / resolve). The
   front-mask + build-resolve assembles were verified in-browser 2026-07-12
   via the REPLAY Worker miss path ($0): streamed log, front-layer assemble
   during the model wait, resolve assemble into the result scroll, zero
   console errors. As-built: `docs/build-log.md`.

5. **Landing warmth + wordmark home.** ✅ Landed 2026-07-14 (demo-prep pass).
   The idle surface was reading as a cold form: a numbered step ("1 / Name
   your brick set") over a 2-col swatch grid of parts-legend picks. Softened
   to a plain "Name your set" + a row of ≤5 outlined suggestion pills, and
   the primary CTA became a yellow pill — the same pill at both ends of the
   flow ("Generate set" / "Build another set"). New `--radius-pill` token is
   the *only* rounding in the app; the manual interior stays strictly square,
   so the rounding reads as a decision, not a default. Type: mono is now
   reserved for the live build log (terminal output is the point there) and
   never appears in the booklet — a real LEGO manual sets part counts and set
   numbers in the same grotesque as everything else. The masthead gained a
   "LEGO generator" tagline (replaced by the set number once a build
   resolves), and the **wordmark is a button that returns to idle** and
   re-rolls the stage's random set.

**As-built log for Stages 0–4** (persistent-shell refactor, result-scroll
restyle, streamed-log internals, stop-motion wiring, per-stage in-browser
verification) is moved to `docs/build-log.md` (Phase 6). Nothing there is
required to start the next action — it's archaeology, and the load-bearing
bits are summarized in the stage lines above.

**Next action — the Worker-reshape decision (Mike's call; the probe
series is complete).** The facts, all landed 2026-07-19/20: prompt v2
authors clean sets (probe8: 10/10, subscription, $0); thinking is
load-bearing (probe9: 0/10 without it); quality reproduces on the
direct API but needs ~5k+ thinking tokens (probe10); no effort setting
buys quality cheaper (probe11) — so **live full authorship costs
~$0.10–0.20/term, ~10× target, with no parameter lever left.** Options,
each vetoable, no recommendation implied:
- **A — pay for it live.** Authored front as the live cache-miss route
  at ~$0.10–0.20/term, leaning on cache-once economics (the "budget may
  stretch" decision — though this is a 10× stretch, not 2×). FA/FLUX
  demoted or dropped; simplest pipeline, best live quality.
- **B — authored fronts offline, cache live.** Keep the live Worker
  thinking-off and cheap (or cache-only); generate authored-front sets
  via the $0 subscription route (probe8 harness) for the library and
  the recommended ~30–50-term curated pre-seed. Live novel terms keep
  FA/FLUX (with the approved whitelist) or return "not yet".
- **C — hybrid.** B's offline authored library + A's paid authored
  route only for cache-miss terms, possibly gated (rate limit already
  exists: 5 fresh/hr/IP caps worst-case spend at ~$0.50–1.00/hr/IP).
Whichever lands, the FA whitelist decision (approved) and the cause-5
iso-lumpiness work are unaffected. Probe grids: contact-sheet viewer
(`npm run dev`, runs `probe8-16char-nomask` / `probe9-16char-nothink` /
`probe10-16char-adaptive` / `probe11-16char-effortlow` /
`probe11-16char-effortmed`).

Demo runner (2026-07-14, still current): **`blawx.proj/demo-up.sh`**
(outside both git repos) — Worker `:8787` + built frontend `:5280` with a
health-check watchdog (recovers a SIGKILL'd workerd in ~9s). Run it in a
Terminal, leave the window open; demo URL `http://localhost:5280`. The old
`:5179` dev server was killed (port clutter).

FLUX (rung c) landed locally (see (c) bullet); non-FA terms source a
silhouette (~$0.02/term, cached) — but see findings-report cause 4: the
live FLUX route is the weakest producer. flux-schnell cold-boots (~40s,
sometimes `failed`) so live/novel terms are flaky in a demo — lean on
cached terms, and the **curated pre-seed** (bake ~30-50 good terms into KV
ahead of time) is the recommended demo fix, still un-chosen by Mike.
Color: novel terms get a deterministic bright fallback (not grey) when the
paint overlay drops out (`color.ts`).

Remaining, when Mike wants it (both deprioritized vs. the local demo):
- **rung (d) production deploy** as a mikemake.com subpath — full step list
  in the (d) bullet above. Immediate blocker: `wrangler login` not
  authenticated; needs one live-spend sign-off for a public URL. The `../api`
  FLUX + token work already done is deploy-ready (secret becomes
  `wrangler secret put REPLICATE_API_TOKEN`).
- **Curated pre-seed** (~30–50 known-good terms baked into KV ahead of time,
  ~$0.50–1) — the recommended fix for the flux cold-boot flakiness above, and
  the seed you'd want in remote KV anyway. Still un-chosen by Mike.

Still-open (not blocking the deploy): the color-projection gap (live gen
works end-to-end — `star`/`apple` confirmed 2026-07-13 — but accent colors
mostly don't survive to the rendered grid). Full mechanism + three vetoable
directions below.

**Load-bearing finding (2026-07-13): accent colors mostly don't survive to
the rendered grid.** The color model works, but column-projection
(`voxel color = front cell [15-y][x]`) drops any accent color over a
silhouette region the geometry didn't voxel-fill — and accents are exactly
the thin details (beak, stem, wheels) that don't get voxels. Net: objects
render near-single-color even when the `paint` frame looked multi-color
(`apple`: 3-color paint → 420 red + 1 brown stored). Full mechanism + the
other single-color cause (color-call dropout) are in the Entry point "Known
color caveats" block. Three vetoable directions, no recommendation implied:
  - **Make accent geometry survive** — ensure thin identifying features get
    voxels so their front colors have a column to land on.
  - **Change the color mapping** — color by 3D part/region instead of flat
    column projection, decoupling accent colors from voxel presence.
  - **Accept body-dominant** — lean into single-strong-color LEGO objects
    and drop the accent ambition (cheapest; the color system already
    trends here in practice).

Housekeeping items still standing:

1. ~~Bounce the Worker~~ — done (re-bounced 2026-07-13): killed the old
   REPLAY-instance `wrangler dev`, restarted detached
   (`nohup npx wrangler dev > /tmp/blawx-api-dev.log 2>&1 &` from `../api`).
   Confirmed live config via `GET :8787/api/generate?q=horse` → `x-cache:
   hit`, no `REPLAY` binding at boot.
2. **Fresh FA-matched terms** (typed at the local Vite port) bill ~$0.017 (≤2 Sonnet + 1 Haiku)
   under the standing <$5 allowance and cache on completion. Non-FA terms
   (`pig`, `submarine`) return `no-source` 404 ("no starting outline yet")
   — no fallback until FLUX rung (c) is built. Transient Anthropic 529s can
   error a run mid-stream (observed then cleared 2026-07-13); retry.
3. **Vetoable, ready when signed off: the library backfill** —
   `cd ../api && npx tsx scripts/color-library.ts` prints the plan
   (29 terms ≈ $0.06) and exits; `--confirm-spend` runs it, then
   `npx tsx scripts/seed4.ts --local` re-seeds KV so the library +
   idle stage go colored too. Until then they stay single-color, as do
   the pre-color `helicopter`/`tractor` cache entries (redo = KV delete).

The bricks/instructions items below are a *proposed* order (derives from
Mike's stated constraints) still open to veto. Each is an independently
vetoable bet; intended sequence —
1. **Open search / live-gen (Phase 5 rung a) — ✅ LANDED locally 2026-07-12.**
   First billable calls ever: `helicopter` (degraded — 2 components, 148
   floating; the rotor disconnects across the thin mast, the known
   thin-feature failure class) and `tractor` (clean — 1 component, grounded,
   silhouette reads well). Both ≤2 Sonnet calls, ~10 s wall each, cached to
   local KV (degraded results cache too, by design — redo needs
   `npx wrangler kv key delete "g:helicopter" --binding CACHE --local`).
   Full round log: `docs/build-log.md` (Phase 5 rung a). Facts that remain
   load-bearing:
   - **Coverage is bounded by the FA index** (~7,509 terms; no match →
     `no-source` 404). Term→icon mapping has traps: `crab` → the Cancer
     zodiac glyph, `elephant` → the GOP logo. FLUX-schnell front-sourcing
     (rung c) widens coverage: separate Replicate key, separate sign-off.
   - `thinking: disabled` vs adaptive-low is an untested A/B knob (first
     runs used disabled, the tuned profile).
   - The **deployed** Worker (rung d) still needs remote KV + secret + a
     fresh sign-off before any public surface can spend.
2. **Color — ✅ LANDED 2026-07-12** (Mike confirmed the bet; monotone gate
   satisfied by the helicopter/tractor round). Model-painted front overlay:
   a second, independent Haiku call repaints the trusted front mask
   (validated cell-for-cell, deterministic), voxels inherit their front
   cell's color, and a mid-wait `paint` SSE frame repaints the assembling
   front layer in place. Palette +3 (orange/brown/tan). Geometry prompt
   untouched; any color failure falls back to the old single-color path.
   Verified at $0 via replay (Worker 51/51, client 49/49, in-browser duck
   with orange beak). As-built + backfill gate: `docs/build-log.md`.
   Minor re-touch expected once brick types change (3).
3. **Heterogeneous brick types** — real sets combine brick shapes, not the
   current homogenous voxels. Split into two levers (2026-07-13):
   - **Lever A — richer brick *vocabulary* over the same voxel field ✅ LANDED
     2026-07-13.** Footprint variety (real System catalog) + running bond, in
     `pack.ts`. $0, no pipeline/model change, no render change. Makes the build
     read as "assembled from real bricks" and feeds smarter step inference (4).
     Its ceiling: the *silhouette* stays blocky — A does not defeat the
     Minecraft read on its own (that's Lever B). Details in the "Middle-tier
     instructions" bullet above.
     - **Deferred sub-bet (vetoable): plate/brick height mix.** Real plates are
       ⅓ a brick's height, but the voxel grid is uniform unit-height layers, and
       "tall brick *with* studs" isn't a render style yet (`'cube'` has no
       studs). Touches render semantics + the byte-identical-static-pages
       constraint for marginal realism. Not worth rabbit-holing into A; greenlight
       separately if wanted.
     - **Height model (locked 2026-07-13, Mike): 1 voxel = 1 brick.** Every
       voxel renders as a full-height studded brick, so a 2×4 reads
       unambiguously as *the* flagship brick (not an ambiguous mid-height slab).
       Chosen over "1 voxel = 1 plate" because the latter (a brick = 3 stacked
       plates — real LEGO: stud 8mm, plate 3.2mm, brick 9.6mm) would need ~3×
       vertical grid resolution or it squashes every model. Plates/tiles become
       a deliberate later accent, not the base unit. Reference facts:
       memory `reference_lego_common_parts` + https://brickarchitect.com/parts/most-common.
     - **Vocabulary is commonality-ranked, not largest-area (Mike's feedback
       2026-07-13):** the packer prefers the most common real footprints
       (2×4 workhorse, then 2×2, 2×3, 1×4, 1×2, 1×1, …). 2×6/2×8/1×6/1×8 stay
       legal but rarely fire under greedy — intentional. Deterministic greedy
       can't sprinkle occasional big bricks for variety without stochasticity;
       Mike is fine with that for now ("some 2×8 okay but not a big deal").
   - **Lever B — non-cubic geometry AND richer piece-height types (the real
     Minecraft-killer, the committed arc; Mike confirmed 2026-07-13 he'll want
     this in a future version).** Two entangled expansions, both pipeline-scale
     ("not a packing tweak"): (1) non-cubic parts — slopes/wedges, cheese
     slopes, round bricks/cylinders/cones, curved slopes, arches — change the
     *silhouette*, needing a geometry representation beyond occupancy (per-cell
     part type + orientation), inference of where they go (surface-normal /
     staircase detection on the voxel hull, or ask the model), and a renderer
     per part type; (2) mixed piece heights — real plates + bricks + tiles,
     which means "1 voxel = 1 plate" with ~3× vertical resolution so a brick is
     3 plates. Entangles with the color-projection gap. Not started; scope as
     its own arc. **Upstream of** instruction UX.
   - **Buildability / inventory settings (new feature idea, Mike 2026-07-13):**
     a settings menu where the user declares which brick types they own (or
     don't), so the generated set is buildable from their actual collection.
     Default = the full/wide piece vocabulary; the control *narrows* it. Slots
     cleanly onto the packer's footprint-preference list (filter the allowed
     set) and, once Lever B lands, onto the piece-type catalog too. AI-native
     angle: "make me something I can actually build tonight from what's in the
     bin." Backlog, not scheduled.
4. **Instruction-manual UX** — smarter step inference (max step count,
   thoughtful ordering / what comes first), better manual display. Rides on
   (3)'s new decomposition, so it follows brick types, not precedes them.
- **Phase 5 rung (d)** — production ship (remote KV, deploy, seed4 remote); can
  ship cache-only first, independent of live-gen. Orthogonal to 1–4.

**Spend gate (updated 2026-07-12):** everything through Stage 4 was built and
verified at $0. The first live calls (helicopter, tractor, ≲$0.04) ran under
Mike's sign-off, and he granted a **standing allowance for spend below
$5/session**. The local Worker is live (see Entry point); larger spend shapes
(batch seeding, sweeps, deploy-side spend, Replicate) still need their own
sign-off.
