# blawx2

Read `PLAN.md` for the project plan.

## Entry point

**Open search / live-gen (Phase 5 rung a) went LIVE locally 2026-07-12** —
the first billable Anthropic calls were made under Mike's sign-off
(`helicopter` + `tractor`, ~2–4 Sonnet calls total, ≲$0.04). The local
wrangler dev Worker on :8787 is **left live** (REPLAY commented out in
`../api/.dev.vars`): any novel term typed at :5174 now bills
`ANTHROPIC_API_KEY` (~$0.015/term, 5 fresh/hr/IP, cached forever after).
Mike granted a **standing allowance for spend below $5/session** (2026-07-12)
— above that, or for new spend shapes (batch seeding, A/B sweeps, Replicate),
re-confirm per run. Restore `REPLAY=1` in `.dev.vars` for $0-by-construction.
The Phase 6 front-end overhaul is complete through Stage 4; details in the
Phase 6 block below. **Mike drives this thread with Fable's top-tier
reasoning** — this doc records the facts; the approach is Fable's call.

Geometry pipeline (Phases 1–4) is settled; canonical exemplars and settled
decisions are recorded in "Phase 1–4: geometry pipeline" below, with the
round-by-round journey in `docs/voxel-history.md`.

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

**Remaining rungs** (the open-search work is rung (a) — see the Phase 6
"Next action" block below for the canonical, detailed entry point):
- **(a) Live end-to-end smoke test** — ✅ landed 2026-07-12 (helicopter +
  tractor, first billable calls; see Phase 6 Next action item 1).
- **(b) Frontend miss-path UX** — ✅ delivered by Stage 3b (streamed build
  log + distinct `no-source`/rate-limit/upstream failure copy). The copy
  paths are typed but not yet exercised in-browser (replay always succeeds);
  they get exercised for real when (a) goes live.
- **(c) FLUX-schnell front sourcing on FA-index miss** — extends coverage
  past the FA index. Needs Replicate (~$0.003/img, separate key, separate
  sign-off) + a Worker-side image→mask downsample (the luminance path in
  `silhouette.ts` is portable; no resvg needed for PNGs). Optional; not
  required for the first live test.
- **(d) Production ship** — create remote KV, deploy, seed4 remote, point
  blawx2's build at it. Independent of live-gen: can ship cache-only first.

**Cost-model constraint (still load-bearing):** the deployed Worker has
no subscription route — every live gen bills `ANTHROPIC_API_KEY` directly
(~$0.012–0.018/term, 2–3 Sonnet calls). Every result caches to KV, so each
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

**As-built log for Stages 0–4** (persistent-shell refactor, result-scroll
restyle, streamed-log internals, stop-motion wiring, per-stage in-browser
verification) is moved to `docs/build-log.md` (Phase 6). Nothing there is
required to start the next action — it's archaeology, and the load-bearing
bits are summarized in the stage lines above.

**Next action — open search is live locally (2026-07-12); Mike's move is to
play with it** (type any term at :5174 — each novel FA-matched term bills
~$0.015 under the standing <$5 allowance) **and veto/confirm the next bet:
color (item 2), now unblocked** — he can feel fresh monotone terms today.
The bricks/instructions items after it are a *proposed* order (derives from
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
2. **Color** — strategic per-set color so results read as the named thing.
   Cheap render-layer change, high payoff. **Deliberately gated** behind Mike
   experiencing a fresh, uncached term in *monotone* first (he wants to feel
   the no-color version). Minor re-touch expected once brick types change (3).
3. **Heterogeneous brick types** — real sets combine brick shapes, not the
   current homogenous voxels. Deeper geometry/pipeline arc (bigger weight class
   than 1–2; scope as its own committed arc). **Upstream of** instruction UX.
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
