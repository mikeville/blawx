# blawx2

Read `PLAN.md` for the project plan.

## Entry point

**Active work: Phase 6 (front-end overhaul)** — see Phase 6 section
below. The generation pipeline (Phases 1–5) is code-complete; Phase 5's
remaining rungs (live smoke test, production ship) stay open and are
independent of the overhaul. Geometry pipeline (Phases 1–4) is settled;
canonical exemplars and settled decisions are recorded in "Phase 1–4:
geometry pipeline" below, with the round-by-round journey in
`docs/voxel-history.md`.

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

**Ordering (minimum first, iterating up):**

1. **LEGO skin at 16³.** ✅ Done (2026-07-06, commit `9324dae`).
   Verbatim port of `../blawx/src/render/{iso,palette,Brick,Scene}.ts`
   + `voxel/types.ts` into `src/render/` and `src/voxel/`. All four
   render files are grid-size-agnostic (iso.ts uses per-voxel UNIT=22,
   Scene.tsx auto-fits viewBox to `computeExtents(bricks)`) — no
   upsize needed. Iso constants confirmed identical to
   `src/bench/isoRender.ts`.
2. **Minimum instructions view.** Port `../blawx/src/voxel/{pack,steps}
   .ts` + `../blawx/src/booklet/*` at 16³.
   - **Step 2a — voxel port** ✅ Done (2026-07-06, commit `1aea577`).
     `pack.ts` made grid-size-independent (loop bounds derived from
     filled cells rather than importing `GRID_SIZE`); `steps.ts` is a
     clean copy. Test glob widened to `src/voxel/*.test.ts`. 10 new
     tests pass (40/40 total).
   - **Step 2b — booklet port** ✅ Done (2026-07-07, commit `0ad3022`).
     Verbatim port of `../blawx/src/booklet/{Booklet,StepPage,
     TitlePage,InventoryPage,FinalPage}.tsx` + a scoped `pages.css`
     slice (lines 1–201, up to `.page--step .scene svg`; excludes the
     `.app-shell`/Comparison CSS below it) into `src/booklet/`. All
     five files turned out grid-size-agnostic already — no 8³→16³
     layout changes were needed, confirmed by inline review before
     commit. `PointsCell.tsx` was **not** ported: it's only consumed
     by `Comparison.tsx`, which is explicitly out-of-scope eval infra
     (see "Skipped for v1 minimum" below) — porting it would've been
     wasted work with no consumer in the shipped booklet. Typecheck
     clean, 40/40 tests pass (no new tests added — these are pure UI
     components with no unit-testable logic).
   - **Step 2c — seed4 adapter + wire-up** ✅ Done (2026-07-07).
     `src/voxel/seed4.ts` exports `seed4ToGrid(json)` + a
     `NOUN_COLOR` table covering all 29 nouns in
     `runs/seed4-16char-mixed/` (fallback `lightGray`).
     `src/api/slug.ts` ported verbatim (slug + `setNumberFor`).
     `App.tsx` gains a `?q=<noun>` route that loads the seed4 JSON via
     `import.meta.glob('../runs/seed4-16char-mixed/*.json')`, runs it
     through the adapter → `buildSteps` → `Booklet`. The existing
     benchmark contact sheet stays as the default view (no `?q=`).
     Smoke test: `?q=cat` renders a black 16³ cat, set #9262, 36 build
     steps, 123-brick inventory. Typecheck clean, 40/40 tests pass.
     Slug normalization matches the sibling repo, so KV keys stay
     forward-compatible with v2 live-gen misses.
3. **Frontend.** ✅ Done (2026-07-08). Two commits:
   - `chore(bundle): drop benchmark contact sheet …` — App.tsx stripped
     of bench imports; `src/app.css` deleted. `src/bench/*` kept intact
     for offline scripts (seed-library, convert-response, relift, etc.).
     Restore point in the commit message.
   - `feat(landing): vintage-manual SearchLanding at / (Phase 5, step 3)`
     — `src/search/{SearchLanding.tsx, search.css}` + `src/index.css`
     global reset (light color-scheme, paper body bg). Free-text input
     over the seed4 library + numbered two-column library index of the
     28 available nouns (`misses.json` and `run.json` filtered out).
     Miss → placeholder "no cached build" page (v2 live-gen slot).
     Client-side routing via `history.pushState` + popstate listener;
     no router dep. Wordmark: "blawx" (working mark).
   - **Aesthetic direction (this pass):** warm-paper landing (#fdfcf8,
     #1a1a1a ink, one LEGO red #da291c) styled after vintage LEGO
     instruction manuals — sharp corners, hairline rules, big flat sans
     numerals, monospaced metadata. Intentionally throwaway styles;
     design-system refactor comes later.
   - **Not ported from sibling:** rounded pill "chip" suggestions
     (2010s web pattern, off-brand for the manual aesthetic) — replaced
     with a two-column numbered list that reads like a manual's parts
     index. `mockCache.ts` port was unnecessary — landing takes the
     noun list as a prop from `App.tsx`, which already builds it from
     the seed4 glob for `?q=` routing.
4. **Cache seeding + KV read-path.** ✅ Done locally (2026-07-08),
   pending production deploy.
   - **Seed script:** `../api/scripts/seed4.ts` (new; `npm run seed4`,
     `-- --local` for miniflare). Reads `runs/seed4-16char-mixed/*.json`
     and imports blawx2's **own** `slug()` + `seed4ToGrid()` so keys
     (`g:<slug>`) and grid shape are byte-identical to the SPA and
     forward-compatible with v2 misses. Keys on the **filename stem**
     (what the frontend routes by), warns on noun/filename drift.
     Excludes `misses`, `run` → 28 grids. Cache entry is `{ grid }` only
     (metrics/degraded omitted — unused on the hit path). `$0` — pure
     JSON→KV, no Anthropic. (The old `seed.ts` still seeds the sibling
     `../blawx` 8³ set; left intact.)
   - **Worker `CACHE_ONLY` flag** (`../api/src/index.ts`): a miss returns
     `404 {code:'miss'}` **before** rate-limit/Anthropic, so v1 ships
     `$0` by construction. Set in blawx2's local `.dev.vars`; left unset
     in committed `wrangler.toml` so the shared sibling keeps live-gen.
     Flip off when v2 live-gen lands.
   - **Frontend read-path** (pulled forward from v2): `App.tsx` no longer
     bundles grids. `src/api/generateClient.ts` fetches
     `GET /api/generate?q=` from the Worker (`VITE_BLAWX_API`, set in
     gitignored `.env.local` → `http://localhost:8787`). The landing's
     library index now derives names from a **non-eager** glob (names
     only; grids come from KV). Miss/error → placeholder page.
   - **Verified (local):** 28 grids in miniflare KV; `curl` hits return
     16³ grids w/ `x-cache: hit` + CORS; `q=octagon` → 404 `code:miss`
     (no Anthropic); browser `?q=cat` renders set #9262 / 123 bricks /
     36 steps (identical to the step-2c glob render); `?q=octagon` →
     "no cached build" placeholder. Typecheck clean.
   - **Not done — production:** remote KV namespaces don't exist yet
     (`wrangler.toml` ids are `local-placeholder-*`). Prod ship needs
     `wrangler kv namespace create CACHE/RL` → paste ids → `deploy` →
     `npm run seed4` (remote) → set blawx2's build `VITE_BLAWX_API` +
     `CACHE_ONLY=1`. Requires a Cloudflare-account session.
5. **v2 live generation — Worker port.** ✅ Code done + committed
   (2026-07-09; api `668b7ef`, blawx2 `4ffb3b8`). NOT live-tested — no
   Anthropic call has ever been made; `CACHE_ONLY` still on everywhere.
   - `../api` is now a **git repo**: baseline `e069edb` (pre-existing
     Worker as of step 4) then the port commit. Repo-hygiene note from
     the v2 handoff is resolved.
   - **FA front-mask index** (solves the no-`fs` edge-runtime shift):
     blawx2 `scripts/build-fa-index.ts` (`npm run fa-index`) rasterizes
     all FA6 Free solid icons through the existing `silhouette.ts`
     pipeline and writes `../api/src/fa-index.json` — 1997/2001 icons
     as grounded 16×16 masks (256-char strings) + 7,509-term lookup
     from FA names/aliases/search terms. 736 KB raw / 104 KB gz,
     bundled into the Worker; zero runtime rasterization. Drift
     self-check: all 14 FA-sourced seed4 nouns byte-identical to the
     shipped v1 masks.
   - **Worker miss path** (`../api/src/{generate,probe6,orientation,
     faIndex,masks,hull,color,exemplar}.ts`): probe6 prompt ported
     byte-identically (verified against
     `runs/probe6-16char-sonnetdepth/prompts/duck.md`); retry-feedback
     validator as a pure function (trust-front, depth cap 6, top-slab);
     one feedback retry → max 2 model calls; trusted front replaces the
     model's front before lift; z-flip 8-orientation search +
     front-protecting repair; strict hull lift; NOUN_COLOR with
     lightGray fallback. Stale `prompt/parser/transform.ts` deleted.
     No FA match → 404 `code:'no-source'` (frontend still shows the
     generic placeholder — see remaining rungs).
   - **Model config:** `claude-sonnet-5`, maxTokens 2048, 30 s/call
     timeout, and `thinking: {type:'disabled'}` set **explicitly** —
     Sonnet 5 runs adaptive thinking by default when the field is
     omitted, which would silently blow the 2–3-call cost/latency
     profile the pipeline was tuned against. Revisit as an A/B knob at
     the live-test round.
   - **Verified offline ($0):** 32/32 tests (model call injected +
     mocked), `tsc --noEmit` clean, and an end-to-end replay of the
     recorded duck call-1/call-2 responses through the Worker pipeline
     reproduces the offline conversion exactly (360/360 voxels,
     2 calls, not degraded).

**Palette decision for v1 (2026-07-06):** single hand-authored color
per noun (option chosen over region-based auto-segmentation and
all-lightGray). Table lives in the seed4 adapter (Step 2c); one entry
per noun in `runs/seed4-16char-mixed/`. Missing entries fall back to
lightGray. Model-picked / region-based palette is a v2+ knob.

**Skipped for v1 minimum (do NOT port unless promoted):**
- `../blawx/src/voxel/{projections,transform,analyze}.ts` — only used
  by deferred booklet files.
- `../blawx/src/voxel/{loadVox,sampleDuck,sampleTree,sampleHouse}.ts`
  — `.vox` file loader + hand-authored 8³ demo data.
- `../blawx/src/booklet/{Comparison,Gallery,Workbench}.tsx` +
  `comparisonCosts.ts` — cost-comparison / gallery / hand-editing UI
  that's evaluation infra, not the shipped booklet.

**Ratchet up after v1 ships (in order of ambition):**

- **Middle-tier instructions:** greedy brick-packer that recognizes
  1×1 / 1×2 / 2×2 / 2×4 runs before rendering. Makes the step list
  feel like an actual LEGO manual. Note: `Brick.footprint` is
  currently typed `w: 1|2, d: 1|2` — widen when this ratchet lands.
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

**Next action:** Step 5 (v2 Worker port) done + committed (api
`668b7ef`, blawx2 `4ffb3b8`); details in step 5 above. All verification
was offline/$0; `CACHE_ONLY` is still on and no Anthropic call has ever
been made.

Remaining rungs (recorded, no order decided — each is a separate bet
Mike can pick or veto):
- **(a) Live end-to-end smoke test** — the first billable Anthropic
  call. Per-run sign-off boundary under the spend guardrail: ~$0.02–0.04
  for 1–2 novel terms at the settled 2-call Sonnet tier (list price;
  intro pricing is roughly a third off through 2026-08). Also the moment
  to A/B `thinking: disabled` vs adaptive-low.
- **(b) Frontend miss-path UX** — the "watch it build" moment: loading
  state while the Worker generates (~10 s), distinct message for 404
  `code:'no-source'` vs generation failure. Currently every miss shows
  the static "no cached build" placeholder. $0.
- **(c) FLUX-schnell front sourcing on FA-index miss** — the second
  front-source rung from the settled decision. Needs Replicate
  (~$0.003/img, separate key, separate sign-off) and a Worker-side
  image→mask downsample (the luminance path in `silhouette.ts` is
  portable; no resvg needed for PNGs).
- **(d) Production ship** — create remote KV, deploy, seed4 remote,
  point blawx2's build at it (see step 4's "Not done — production").
  Independent of live-gen: can ship cache-only first.

**Cost-model constraint (still load-bearing):** the deployed Worker has
no subscription route — every live gen bills `ANTHROPIC_API_KEY`
directly (~$0.012–0.018/term, 2–3 Sonnet calls). Every result caches to
KV, so each term is paid once ever. `CACHE_ONLY=1` keeps the surface $0
by construction until the live test is signed off.

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

0. **Design language as code.** ✅ In progress. `src/design/tokens.css`
   (palette derived from the real brick colors in `render/palette.ts`,
   type scale, rule weights, stud-based spacing, sharp corners) +
   `src/design/motion.ts` (stop-motion principles + timing constants).
   Governs everything downstream. Note: UI chrome is unified onto the
   brick palette — the canonical accent red is the brick red `#C8102E`,
   not the throwaway `#da291c` the first-pass landing used.
1. **Front surface.** Single morphing surface: idle iso stage (random
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
3. **One morphing surface + streamed honest miss-path log.** Two moves,
   sequenced: first make the surface actually persist (3a), then fill the
   wait with the honest log (3b). Do them together — the log is what gives
   the now-persistent stage a real transition to cover the swap, so the
   persistence reads as intentional instead of a glitchy hard-swap.
   (Decided 2026-07-10 with Mike: fold the persistence refactor into
   Stage 3 rather than shipping it as a standalone probe.)

   **3a — persist the shell (the one-page-app feel).** Problem Mike named:
   today `App.tsx` swaps `<Surface>` out for `<BookletView>` wholesale, so
   two entirely different DOM trees mount/unmount on submit — it reads as a
   hard page load even though it's client-side. The Phase 6 "one morphing
   surface with the iso stage always present" (above) was never actually
   built; we built two surfaces that merely share a renderer. Fix, with
   **no new UI** (constraint from Mike — global nav persisting is table
   stakes, don't add chrome):
   - Hoist the iso **stage** (and the `blawx` masthead) into a persistent
     shell element that never unmounts across idle → loading → result.
     Only the content *below* the stage swaps. The `?q=` deep-link still
     lands in the result, but inside the same shell.
   - Put a single **black horizontal rule between the stage and the
     content below it** (the "Name your brick set" area in idle; the
     booklet in result). This is the visible seam of the fixed-stage /
     swappable-content split, and a shared landmark present in *both* idle
     and result — the same 1px brick-weight rule already used between
     booklet sections. One line of CSS, not new UI.
   - Consequence to handle: the idle random set must visibly *become* the
     named set on submit. A hard brick-swap on a now-fixed stage just
     moves the "page load" feeling onto the stage itself — so this needs
     at least a minimal stepped stop-motion cut (ties to Stage 4). 3b's
     log is the cover: the front brick layer assembles on the stage during
     the model wait (real data — the front mask is known at t=0).

   **3b — streamed honest miss-path log** (the live-gen "watch it get
   built" moment), rendered in the below-the-rule zone during the wait.
   Today `generateClient.generate()` is one blocking GET — to show real
   stages the Worker must stream (SSE/chunked) real events. Honest step
   mapping (from `../api/src/{generate,index}.ts`):

   | Real op | Time | Log label |
   |---|---|---|
   | FA-index front lookup | instant | Matching a silhouette |
   | Sonnet call #1 (side/top depth) | ~3–6 s | Designing the build |
   | validator | instant | Checking the fit |
   | Sonnet call #2 (retry, *conditional*) | ~3–6 s | Correcting |
   | flip search | ms | Squaring it up |
   | repair + hull lift | ms | Solidifying |
   | client pack→steps | ms | Writing the booklet |

   Truth: ~all wall-clock is calls #1/#2 — the log dwells there and
   treats the rest as fast bookends. The front mask is known at t=0, so
   the **front brick layer** assembles during the model wait (real data,
   not filler). "Correcting" only shows when the retry actually fires.
   Honest, distinct failure states (never a spinner that dies):
   `no-source` 404 ("no starting outline for '{term}' yet"), `429` rate
   limit ("5 fresh builds/hr — cached sets free"), `x-degraded` (renders;
   mark experimental?), `502` upstream/parse ("couldn't finish — retry").

   **Spend gate (load-bearing):** build the entire streamed-log UX at
   **$0** by replaying the recorded duck call-1/call-2 responses through
   the Worker with an injected delay to simulate model latency. Only a
   final 1–2 novel-term smoke test bills Anthropic — that is Phase 5 rung
   (a), ~$0.02–0.04, a discrete per-run sign-off under the spend
   guardrail. No live call before that sign-off.
4. **Stop-motion animation pass.** Intro fall-into-place + ambient, on
   stepped/held timing (replacing the mockup's smooth float). Feasibility
   TBD: `Scene.tsx` renders a static SVG, so per-brick staged animation
   may need a render-side change. Lower priority (Mike's call).

**Next action:** Stages 0–1 landed + a refinement pass, all verified
in-browser at mobile width (2026-07-10). Stage 0: `src/design/
{tokens.css,motion.ts}` wired into `index.css`. Stage 1:
`src/surface/{Surface.tsx,surface.css}` — the single-surface front door
(idle iso stage renders a random set from a curated `HERO_SETS` pool via
a `../../runs/seed4-16char-mixed/*.json` glob → `seed4ToGrid` →
`allBricks(buildSteps())` → `Scene`; parts-legend picks with brick-colour
swatches, no pills). Replaces `SearchLanding` for the no-`q` route
(`SearchLanding.tsx` left on disk unreferenced); the `?q=` result still
renders the OLD `BookletView`.

Refinement pass (Mike review): warm off-whites neutralised
(`--paper #f4f4f4`, sunk/rule/ink ramp de-warmed); **primary accent
switched red → authentic LEGO yellow `#FFCC00`** with black text — token
`--accent` and render palette `COLORS.yellow` moved together so UI and
bricks stay locked (yellow bricks are brighter everywhere now); brick
stroke 1.5→0.65 and studs given a black cylindrical side + brick-colour
flat top (only the stud `path` side is `OUTLINE`; the top `ellipse` keeps
`topFill`) to match the set-6628 manual. One shared renderer, so these
propagate to the booklet too.

Stage 2 landed (2026-07-10), verified in-browser at mobile width against
the live cache-only Worker (`?q=cat` / `?q=duck`).

- **Result scroll** — `BookletView` (`App.tsx`) now renders one vertical
  scroll: persistent iso **hero** (finished model) → `Booklet`
  (inventory → steps → final). The three outward links are gone; "Build
  another set" is a single CTA at the end of `FinalPage` that resets to
  the idle surface (`App.tsx` `reset()` → clears `?q`, scrolls top).
  `BookletView` takes `term` + `onReset`; loading/miss/error are a
  token-styled `ResultMessage` (Stage 3 replaces the loading path with
  the streamed log).
- **No cards / no shadows** — `pages.css` fully rewritten off the old
  fixed 880×1100 scaled print-page cards onto the design tokens: each
  section is a flush block, mobile-first on `--surface-w`, separated
  from the previous by a single 1px black brick-weight rule
  (`border-top: var(--rule-hair) solid var(--ink)`), so the scroll reads
  as one manual. `TitlePage` repurposed as the hero (masthead + model +
  giant lowercase term headline + mono `N pieces · M steps`); `StepPage`
  callout de-boxed to inline brick+count chips; `FinalPage` gains the CTA.
- **Stroke-vs-scale fix folded in** — `render/Brick.tsx`: stroke is now
  `unit * STROKE_RATIO` (0.04) with `vectorEffect="non-scaling-stroke"`
  removed, so the outline **scales with the model**. On-screen stroke
  works out to ≈ `RATIO × renderPx / modelUnitsWide` — independent of the
  `unit` param — so the full 16³ hero gets a fine outline and single-brick
  previews a proportionally heavier one, both reading as the same manual
  line. `unit` is now purely a margin/proportion knob per call site.

**Next action:** Stage 3 (see the expanded Stage 3 above). Two moves in
one pass: **3a** — hoist the iso stage + `blawx` masthead into a
persistent shell so idle → loading → result stop hard-swapping DOM trees
(the one-page-app feel Mike wants), with a black horizontal rule as the
seam between the stage and the content below it, and **no new UI** beyond
that rule. **3b** — the streamed honest log fills the below-the-rule zone
during the model wait and gives the persistent stage its transition (front
brick layer assembling on real data). Entry points: `src/App.tsx` (the
`Surface`↔`BookletView` swap becomes a shell + swappable content),
`src/surface/Surface.tsx` + `src/booklet/Booklet.tsx` (both currently own
their own stage — factor the stage out so one instance persists),
`src/api/generateClient.ts` (blocking GET → streamed events),
`../api/src/{generate,index}.ts` (Worker must emit SSE/chunked).

**Spend gate (load-bearing):** build the entire streamed-log UX at **$0**
by replaying the recorded duck call-1/call-2 responses through the Worker
with injected latency. Only Phase 5 rung (a) — a final 1–2 novel-term
smoke test — bills Anthropic, under a discrete per-run sign-off. No live
call before that sign-off.
