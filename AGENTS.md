# blawx2

Read `PLAN.md` for the project plan.

## Entry point

**Active work: Phase 5 (pipeline v1)** — see Phase 5 section below.
Geometry pipeline (Phases 1–4) is settled; canonical exemplars and
settled decisions are recorded in "Phase 1–4: geometry pipeline" below,
with the round-by-round journey in `docs/voxel-history.md`.

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

**Known deterministic fixes not yet wired** (only matters if the
probe6 route is live-served in v2):
- **z-flip orientation search** for top-view z-mirror — precedent in
  `scripts/gen-sheets.ts`'s 8-way flip search. `alignBboxes` reconciles
  the z-mirror by stretching to full-depth extrusion (bad); an
  8-orientation search picking min reprojection loss is the right fix.
- **Top-slab advisory per-category exemption** — the advisory
  false-positives on genuinely rectangular objects (fires on `table`,
  which is correct as drawn). Advisory-only today, so nothing breaks,
  but production would want an exemption list.

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
3. **Frontend.** Port `../blawx/src/search/SearchLanding.tsx`.
   Pick-from-set for v1 (or free-text over the library with a
   "not-in-library, try X/Y/Z" branch on miss). Result page.
   Routing decided (2026-07-07): public noun input takes `/`; the
   benchmark contact sheet is temporary and can be dropped from the
   bundle when SearchLanding lands (no `/bench` fallback needed —
   R&D can spin it back up locally from git if ever wanted).
4. **Cache seeding.** Batch the seed4 outputs into KV via the
   `../api/` Worker. Ship.

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

**Next action:** Step 3 — port `../blawx/src/search/SearchLanding.tsx`
to take `/`. Bench contact sheet is temporary — drop it when the
landing page lands (git preserves it). The `?q=<noun>` wire-up from 2c
is a stopgap; the landing page owns the term-entry flow going forward.
