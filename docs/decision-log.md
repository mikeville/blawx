# Decision log

Append-only record of what was tried on blawx2 and what settled or killed
it. Moved out of `AGENTS.md` on 2026-07-31 so that file could stay an
operating doc; **nothing here was rewritten** — the sections below are the
originals, in the order they were written.

Because they are verbatim, their headings are as-written: "active" means
active *at the time*, and status claims are frozen at their date. For what
is true now, read `AGENTS.md`.

Read this when you want to know *why* a decision stands, or before
proposing something that looks untried.

Companion archives: `docs/build-log.md` (as-built implementation detail,
Phases 5–6), `docs/voxel-history.md` (probe-by-probe geometry journey,
Phases 1–4), `../blawx2-AGENTS-archive-2026-07-19.md` (the pre-2026-07-19
quality notes the first section below supersedes).

---

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

  **Probe12 (conditioned-depth route priced at the API, run 2026-07-20,
  $1.02 actual): the "middle route" is NOT in the middle — it's the
  worst measured configuration.** The probe6 route (seed4 front given
  verbatim, Sonnet designs side/top; prompt upgraded to depth-draw-v3 =
  probe6 wording + probe8's v2 top-view fix + DOG_Z,
  `scripts/make-probe12-prompts.ts`), direct API, adaptive thinking,
  default effort, 8k output cap, 6 nouns. Result: **0/6 clean; every
  single first call blew the 8k cap on thinking** (10/12 calls total),
  ~$0.17/term truncated, and — the latency number the UX question was
  asking — **85–100 seconds per call, ~3 minutes per term wall-clock.**
  Giving the model the front does not reduce API thinking spend; if
  anything it thinks more (verifying the given mask). Contrast: the
  identical route on the subscription/Claude Code harness (probe6) was
  clean in 1–3 calls. Load-bearing implication: the runaway is a
  property of the raw-API adaptive-thinking profile on this task class,
  not of which sub-task the model is given. All raw-API variants
  measured (full authorship, effort-capped, conditioned-depth) land at
  $0.10–0.20/term truncated-or-worse and 1–3 min/term. One untested
  prompt-side lever, vetoable: an anti-overthinking **system prompt**
  on the API call ("thinking adds latency; respond directly when…"),
  which the probes never sent (subagents had Claude Code's system
  prompt; raw API had none) — hypothesis: it tames thinking toward
  probe8-subagent levels; est. ~$0.5–1 to test. Run:
  `runs/probe12-16char-depthapi/` (per-call tokens + wall-clock ms in
  `usage.json`). Cumulative session API spend: $4.34.

  **Probe13 (Opus 4.8 thinking-off, run 2026-07-20, $0.29 actual):
  FALSIFIED — capability does not substitute for deliberation.** The
  hypothesis was that Opus-tier raw capability could hold grid
  discipline without thinking, landing at ~$0.03/term and ~10s (the
  cost/latency numbers came out exactly as projected: $0.026–0.032/term,
  8–14s wall-clock per term). Quality did not: **1/10 clean after
  retry** (skyscraper), same failure classes as Sonnet thinking-off
  (probe9) — wrong row counts, 15-char rows, cross-view width/height
  mismatches; 4/10 finals collapse to zero-voxel hulls. Firm law for
  this task, now confirmed at two model tiers: **no-thinking fails
  regardless of capability tier; thinking-on costs $0.10–0.20/term and
  1–3 min regardless of configuration.** Remaining untested levers, in
  order of promise: (a) anti-overthinking system prompt with thinking
  ON (the only known cheap-thinking configuration is the Claude Code
  harness, which wraps the task in a large system prompt — est. $0.5–1
  to test on Sonnet 5); (b) non-Anthropic providers via the same
  portable probe8 packet (needs Mike's keys). Run:
  `runs/probe13-16char-opusnothink/` (tokens + ms in `usage.json`).
  Cumulative session API spend: $4.63.

  **Probe14 (grok-4.5 cross-vendor, run 2026-07-20, ~$4.30 actual —
  see corrupted-run note): full-authorship quality is NOT
  model-general; the depth convention is the cross-vendor wall.**
  probe8's prompt v2 packet, byte-identical, against xAI grok-4.5
  ($2/M in, $6/M out — cheaper than Sonnet 5) with default reasoning.
  Result: **1/10 clean first drafts (peanut), 6/10 clean after retry**
  (castle, duck, grapes, peanut, skyscraper, submarine — all
  zero-loss lifts). The 4 failures (crab degraded to 86 voxels; fox,
  helicopter, table collapse to empty strict hulls) are ALL the
  z-mirror depth-convention disagreement — the exact error class the
  v2 top-view anchoring eliminated on Sonnet — and grok fails to fix
  it even when the retry feedback names the disagreement
  deterministically. Reasoning spend: avg ~12.8k tokens/call (2.5× the
  ~5k Sonnet threshold from probes 9–11), so the thinking requirement
  is task-intrinsic, but reasoning volume doesn't buy convention
  discipline. Also slow: 3–9 min/call, 97 min wall-clock for the run.
  Net: Sonnet 5 stays the production route; grok-4.5 is not a viable
  fallback at any price. Clean run cost $1.62. **Corrupted-run note:**
  the first attempt ran as two accidental concurrent processes racing
  on the same run dir (~$2.7 spent, outputs quarantined in
  `runs/probe14-16char-grok45/corrupted-race/`, unusable for the A/B);
  the scored run is a clean single-process rerun. Run:
  `runs/probe14-16char-grok45/` (tokens + ms in `usage.json`; xAI
  spend on Mike's XAI_API_KEY, not the Anthropic-key ledger).
  Remaining untested levers unchanged: (a) anti-overthinking system
  prompt with thinking ON (est. $0.5–1 on Sonnet 5); (b) other
  non-Anthropic providers (Gemini/GPT keys needed) — though probe14
  lowers the prior on (b).

  **Probe15 (anti-overthinking system prompt, run 2026-07-20, $1.62
  actual — over the $0.5–1 estimate; Mike signed off the run):
  FALSIFIED — lever (a) is dead; the prompt-side series is exhausted.**
  probe10's exact profile (claude-sonnet-5, adaptive thinking, default
  effort, max_tokens 8192, streamed) with ONE change: a system prompt
  asking for bounded single-pass deliberation ("think only as much as
  the task needs… one careful pass plus a quick dimension check";
  verbatim in `runs/probe15-16char-sysprompt/sysprompt.md`). Effect on
  thinking spend: **none.** 18/20 calls burned the entire 8192-token
  output budget on omitted-display thinking and emitted zero visible
  text (`stopReason: max_tokens`, `textChars: 0`), ~90 s/call — the
  same runaway as probe10, if anything worse: **1/10 nouns clean**
  (table, both calls completed, final validates OK, zero-loss lift) vs
  probe10's 3/10 completing within the cap. skyscraper's retry got 169
  chars out before the cap; the other 8 nouns produced nothing on
  either call. Run: `runs/probe15-16char-sysprompt/` (per-call tokens,
  thinking/text char split, wall-clock in `usage.json`; runner
  `scripts/run-probe15-sysprompt.ts`). 20 calls, 35.7k in / 155.3k
  out. Net across probes 9–15: **on the raw API there is no known
  configuration — parameter or prompt — that gets clean full
  authorship below ~$0.10–0.20/term and ~1.5–3 min/term.** The
  measured-but-untested refinement: raise max_tokens to ~16k
  (streaming) so thinking has room and calls complete instead of
  truncating — probe10's extrapolation prices that at ~$0.2–0.4/term
  at default effort; it would firm up the real per-term price but
  cannot plausibly get under ~$0.10.

  **Session decisions (Mike, 2026-07-20)** — new constraints for the
  Worker-reshape call, superseding the older $0.01–0.02 target for the
  live-miss route: (1) **per-generation budget raised to ≤$0.20**,
  gated by the per-IP rate limit, with a **BYOK prompt** (user enters
  their own Anthropic key) past the cap — browser-direct calls via
  Anthropic's CORS header discussed as the custody-free mechanics,
  Worker still validates + caches results; (2) **nearest-neighbor
  cache display approved as a direction** — on a miss, show the
  semantically closest cached set while the real one builds (embedding
  match, e.g. Workers AI bge-small bundled like fa-index; similarity
  floor below which nothing is shown); (3) **pre-seed library plan
  needs discussion before building** — selection criterion shifts from
  "most likely terms" to "coverage of noun-space so every query has a
  decent neighbor" (e.g. farthest-point sampling over ~200 candidate
  nouns); (4) color work explicitly deferred to a later session.


---

## Pre-seed library plan (framing approved 2026-07-20)

Mike signed off on the framing + hypotheses below; each H is still
individually vetoable at build time.

**Two jobs, opposite selection pressures.** A pre-seeded term is either
(a) a **direct hit** — instant result; value scales with query
probability mass — or (b) a **neighbor stand-in** — covers the
generation wait via the approved NN-cache display; value scales with
coverage of noun-space. The structural fact that resolves the tension:
**the cache self-populates along the real query distribution** (every
live miss becomes a permanent hit), so head-selection errors
self-correct with traffic while coverage holes only fill if someone
queries into one and waits. Pre-seeding's durable job is (b); (a) only
bootstraps day one. Also load-bearing: **the UI shapes the
distribution** — suggestion chips / autocomplete over cached terms
convert would-be misses into hits, so selection and presentation are
one system.

**Hypotheses:**

- **H1 — candidate pool.** Google Quick, Draw! categories (345 nouns
  with proven mass demand-to-depict) ∪ THINGS dataset (1,854
  psychology-normed concrete nameable objects) ∪ children's
  first-words/picture-book lists, deduped, filtered to 16³-buildable
  classes → ~400–600 candidates. No deeper user research needed beyond
  enumerating failure classes (proper nouns/IP, abstract nouns, verbs,
  multi-word phrases — those need a policy, not seeds).
- **H2 — selection.** Tier 1 head (~50–80 top-demand terms, including
  whatever the demo chips will show) + farthest-point sampling over
  the candidate cloud **seeded with Tier 1 already placed**, computed
  in the production embedding space (bge-small — coverage geometry
  must match the space the NN display searches). Stopping rule: sample
  until every candidate sits within the NN-display similarity floor of
  some seed — the same number serves as display cutoff and stopping
  criterion, so library size = the measured covering number at that
  radius (~200 is a prediction to check, not an input). Tune the floor
  by eyeballing pairs: embedding distance is semantic, not visual
  (castle→palace is a good stand-in; castle→chess is not).
- **H3 — presentation.** Chips + autocomplete move enough query mass
  to hits that head-selection precision barely matters.
- **H4 — iteration.** Log live misses; the empirical distribution
  drives all growth after v1. Pre-seed v1 is a bootstrap, not a
  monument.

**Coverage validation:** hold out plausible queries (e.g. unselected
Quick Draw categories) and check they land within the floor — tests
coverage against queries, not against the pool sampled from.

**Economics:** seeding runs on the probe8 subscription-subagent
profile ($0 API); library size is bounded by per-set QA eyeball time,
not dollars.

**Elicitation experiment (run 2026-07-20, 20 subscription subagents,
$0):** 20 personas (professionals skimming a demo, social-link
visitors, kids/parents, hobbyists, edge-testers) each asked cold for
their first 3 search-box queries in order + 1 mischievous query. Raw
verbatim results: `../elicit1-results-2026-07-20.json` (kept outside
the repo). Findings:

- **Query FORM is the headline, not vocabulary — almost nobody types a
  bare noun.** Of 60 first queries: 15 are personal/possessive ("my
  cat", "my name", "my boss", "my dog rex", a company logo), ~14 are
  franchise/proper nouns (millennium falcon ×3, minecraft creeper ×2,
  death star, lightsaber, eiffel tower ×2, "1969 camaro ss"), 3 are
  noun+scene phrases ("a fox reading a book"), and most in-scope nouns
  arrive wrapped in articles ("a house", "a dinosaur"). **New pipeline
  requirement surfaced:** a normalization layer (lowercase, strip
  articles/possessives, extract head noun) in front of both exact
  cache lookup and NN matching — it converts a large fraction of these
  to pool hits ("my dog rex" → dog).
- **The bare-noun head that remains matches the H1 pool:** cat ×5,
  house ×4, dog ×4, dragon, dinosaur, birthday cake, fire truck,
  rocket ship, chair, rose, coffee cup, lighthouse — recurring across
  unrelated personas.
- **Specialist long-tail validates the NN-coverage job:** "monstera
  deliciosa", "morel mushroom", "duck confit", "ls3 crate engine" want
  a decent neighbor (plant/mushroom/food/engine), not a seed.
- **Failure classes, now with concrete examples needing policy calls:**
  personalization ("my name", "my logo" — un-seedable); IP/franchise
  (brick-culture priming makes these a top class); functional/motion
  demands (6/20 mischief queries are "fully functional X with moving
  parts"); scale/count demands ("exactly 1 million bricks");
  scatology/profanity (5/20 mischief); injection strings (`<script>`,
  SQL) — needs standard input hygiene, not policy.
- **Caveats:** synthetic (Sonnet role-play), n=20; repeats like
  dragon / eiffel tower / death star may reflect model priors as much
  as human ones. Directional prior only, until live miss logs (H4)
  exist.

**Covering numbers measured (2026-07-20, $0 — local bge-small via
transformers.js, same model Workers AI serves as
`@cf/baai/bge-small-en-v1.5`).** Artifacts: `data/seed-pool/`
(vendored source lists, `candidates.json`, `tier1.txt`, `holdout.txt`,
`seed-list.json`, `covering-report.md` — the full pair tables live
there), `scripts/lib/normalize.ts` (the query normalizer, pure +
Worker-portable; applied identically to pool terms and live queries),
`scripts/seed-pool.ts` (`npm run seed-pool`; embeddings cached
locally, gitignored). Findings:

- **Pool (H1):** Quick Draw 345 ∪ THINGS 1,854 ∪ ~110 authored
  first-words → 1,916 deduped terms; Sonnet-subagent buildability
  filter (16³ seed-worthiness criteria, spot-reviewed) kept **1,316**
  — not the predicted ~400–600. Deliberate: the filter drops junk
  *classes* (thin/material/flat/bodypart/blob…); FPS handles
  redundancy, so over-inclusion in the sampling domain is harmless.
- **Covering numbers (H2), Tier-1 = 79 head terms placed first:**
  **113 seeds @ floor 0.55, 228 @ 0.60, 449 @ 0.65, 729 @ 0.70,
  979 @ 0.75.** The "~200 library" prediction corresponds to floor
  0.60.
- **The floor and the display gate cannot be the same number.**
  Eyeballed pairs: ≥~0.75 sims are defensible stand-ins
  (pickup truck→truck .850, leopard→lion .787, teacup→coffee cup
  .750); the 0.60–0.70 band is a coin flip (knife→sword .712 good;
  microwave→radar .722, cow→dog .748, laptop→airplane .650 bad);
  ≤0.60 is junk-prone (toga→fish .552). But covering the pool at
  floor 0.75 takes 979 seeds — the whole pool. Decoupled trade
  (gate-coverage table in the report): a **228-seed library gives
  only 33% of remaining queries a ≥0.70 neighbor** (15% at ≥0.75); a
  449-seed library gives 58% at ≥0.70. So the real knob-set is
  (library size, display gate, show-nothing rate), not one floor.
- **Holdout (19 out-of-pool queries vs the full seed list):** the
  long tail lands well — koi fish→fish .737, race car→car .797,
  t rex→dinosaur .803, morel mushroom→mushroom .745; the miss class
  is exotic-specific terms (monstera deliciosa→margarita .592).
- **Lexical-artifact caveat, survives ANY gate:** bge-small on bare
  words has substring noise — cleat→cleaver **.823**, fork→forklift
  .725, bat→battery .701 — above sims of genuinely good pairs. A
  "a photo of a X" embedding template was tested and **falsified**:
  it compresses the whole range upward and bad pairs rise *more*
  (cleat/cleaver .923 > leopard/lion .872). Known residual: the NN
  display will occasionally show a confidently-wrong lexical
  neighbor regardless of gate choice.
- **Model-swap A/B (bge-base + bge-large, run 2026-07-20, $0):
  FALSIFIED as an artifact fix.** Each space fixes some artifact
  pairs and mints new ones — base drops cleat→cleaver to .693 (below
  its good band) but produces rattle→rattlesnake .789,
  dartboard→washboard .699, machine gun→staple gun .741. The
  substring-noise class is intrinsic to this model family on
  bare-word inputs, not a capacity problem. **bge-small stays the
  production space** (smallest, matches the planned Workers AI
  binding, no demonstrated quality win from larger). bge-base
  covering numbers (own similarity scale — NOT comparable to
  bge-small's): 79 @ 0.55, 114 @ 0.60, 293 @ 0.65, 652 @ 0.70,
  957 @ 0.75; full report `covering-report-bge-base.md`. Any space
  can be re-measured via `SEED_POOL_MODEL=Xenova/<model> npm run
  seed-pool` (suffixed outputs, side-by-side).

**Tier-1 seeding — all 50 sets authored (b1 2026-07-21, b2–b5
2026-07-31, $0 subscription subagents).** Harness as planned: prompt
v2 verbatim (`scripts/make-tier1-seed-prompts.ts`, `DOG_Z` exemplar,
noun only), one subagent per term, single-shot + 1 deterministic
retry (`retry-feedback.ts --max-depth=6`), strict hull lift via
`convert-response.ts`. Artifacts: `runs/tier1-16char-b{1..5}/` (10
terms each, `prompts/`, `responses-call1/`, `responses/`, `run.json`,
per-term result JSON). Final state: **50/50 sets, every one
`comps=1 ground=true`, 0 malformed rows, reprojection loss 0.00 on
all three views.** Contact sheets rendered with
`scripts/render-qa-sheet.ts <out.html> <runDir…>` (self-contained,
iso + front-ortho per card, ⚠ on structural flags).

Findings from the round:

- **Prompt v2 never states the top-view row convention** (`z = 15 -

---

## Self-improvement loop (H-J / H-BT, run 2026-07-20, $0 API)

Direction (Mike, brainstorm 2026-07-20): make the system self-improving
without slowing the serve path. Eval placement decision: **the only
blocking gate stays the deterministic validator**; all judgment-grade
evaluation happens in hindsight, on already-served results, feeding a
background improve-and-replace loop (cache ratchet → demand-driven
growth → exemplar flywheel). Every loop is contingent on an automated
quality signal, so that was the first bet.

**H-J — "a Sonnet judge reproduces the eyeball verdicts" — result:
falsified as a hard gate, supported as a regeneration ranker.** Method
and full numbers: `runs/judge1-cache-eval/RESULTS.md`. All 43 cached
sets rendered (`scripts/render-cache.ts`, new) and eyeball-labeled
(16 bad / 7 marginal / 20 good); two single-vote Sonnet judge designs
via subscription subagents. Conditioned rubric: **77% binary agreement,
tau 0.61** — under the ~90% gate bar. Forced-choice identification: 81%
(89% on good sets). Composite (deterministic structure ∪ judge) catches
**14/16 bad including both semantic traps** at the cost of 11
false-bads — cheap wrongness (a false-bad wastes a $0 subscription
re-gen), so the composite is fit for **ranking/queueing background
regeneration now**, not for blocking anything. Known accuracy levers,
untested: 3-vote panels, magnitude-threshold on the components signal
(raw `comps !== 1` false-flags cosmetic 1-voxel fragments on
cat/lighthouse/sailboat/snail), better renders (spider's front-ortho
renders near-blank; robot reads as ghost). The run directory doubles as
the **judge benchmark**: future judge designs must beat 77%/0.61 on it
before being trusted with gating; new human verdicts should be appended
to `ground-truth.json` so the benchmark grows with use.

**H-BT — deterministic backtest harness — landed.**
`scripts/backtest-cache.ts` replays every cached grid through the
deterministic layer (analyze → pack → steps → iso render) and diffs
structural fingerprints against the committed
`scripts/backtest-baseline.json` (43 terms, verified zero-diff on
write). Any future geometry/packing/render change gets a free
regression check over real data: `npx tsx scripts/backtest-cache.ts`
(exit 2 on behavior diff; input-grid hashes distinguish code diffs from
cache churn — re-run `--write` to adopt intended changes).

**Provenance gap (blocks full-pipeline backtesting):** cache entries
store only `{grid, metrics}` — the front mask, FLUX PNG, and raw model
responses are discarded at generation time. The Worker should persist
those per entry (KV side-keys or metadata) so misses can be diagnosed
and model-layer changes replayed against historical inputs. Roadmap
item for the Worker-reshape; costs nothing per entry beyond storage.

**H-D — background improver — RAN 2026-07-20 (same session, $0 API):
the flywheel raises quality; it does not churn.** Full write-up:
`runs/improve1-cache-swap/RESULTS.md`. All 25 composite-flagged terms
got 2 full-authorship challengers each (probe8 prompt v2, subscription
subagents; `runs/improve1-16char-a`/`-b`); a blind 9-voter Sonnet
panel ranked shuffled challenger-vs-incumbent trios (Borda, 3
votes/term); structure guard + ties-keep-incumbent; Fable eyeball on
all winners before the swap. Outcome: **20/25 replaced in local KV**
(provenance-tagged, verbatim incumbent backups in the run dir), 5
kept. Safety held: duck's canonical set won its panel; the airborne
peanut challenger was vote-winner but structure-blocked. Both
semantic traps fixed (castle, grapes); candy-cane/rainbow no longer
fragments. Residuals: fish + mushroom never flagged (judge1 blind
spots), peanut still bad, bowl weakest accept, candy-cane now blue
(paint overlay not re-run — color session item). Methodology drift
worth knowing: gen subagents wrote projection code instead of
freehand masks (48/50 first-draft-clean — an agents-with-tools
property, not a prompt gain; also a candidate Worker miss-path
architecture: author-via-code + deterministic validation).

**Vetoable next bets, in dependency order:** (1) judge2 — 3-vote
panel + fragment-magnitude structure signal, A/B against the judge1
benchmark (target >77%/0.61; it gates nothing until it wins there);
(2) re-run the improver on the residuals (fish, mushroom, peanut,
bowl) once judge2 lands; (3) wire `x-degraded`+judge verdict into a
`provisional` flag the UI can show; (4) color session: re-run the
paint overlay on the 20 replaced sets (candy-cane first).

---

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

---

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

---

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

---

## Backlog detail as of 2026-07-14 (demo runner, color, bricks, housekeeping)

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
