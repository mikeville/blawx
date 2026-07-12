# blawx2 — build log (as-built archaeology)

This is the **historical** record: the step-by-step and stage-by-stage
as-built notes for Phase 5 (pipeline v1 + v2 Worker port) and Phase 6
(front-end overhaul). It was split out of `AGENTS.md` so a fresh session
loads only current state + constraints, not the whole journey.

**`AGENTS.md` is the operational doc** — current status, load-bearing
invariants, and the next action live there. Nothing in this file is needed
to start the next action; read it only when you need to know *how* a settled
piece was built or *why* a past decision went the way it did. For the
Phase 1–4 geometry journey, see `docs/voxel-history.md`.

---

## Phase 5: pipeline v1 + v2 Worker port — step-by-step

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

---

## Phase 6: front-end overhaul — stage-by-stage landed notes

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

**Stage 3a landed (2026-07-10)** — the persistent shell, verified
in-browser at mobile width (idle → SPA submit → reset, plus `?q=` deep
link) against the live cache-only Worker on :5174.

- **`src/shell/{Shell.tsx,shell.css}`** (new) — the persistent surface:
  `blawx` masthead + the iso **stage** (`Scene`) + the black seam rule +
  a swappable `children` content slot. `App` renders `<Shell>` in *every*
  state, so the masthead and stage `<svg>` never unmount across idle →
  loading → result — only the below-rule content reconciles. The stage
  morphs in place (idle random set → finished model) instead of two DOM
  trees swapping. The seam is one 1px black (`--ink`) rule via
  `border-top` on `.shell__content` — present in every state, the shared
  landmark; **no new UI** beyond it.
- **`App.tsx`** now owns the stage bricks + the fetch (folded in from the
  old `BookletView`). `stageBricks` holds the idle random set while idle
  and the finished model once a build resolves; it is *held* across the
  idle→loading transition so the stage never blanks (verified: a
  CORS-failed fetch left the idle model on the stage rather than clearing
  it). `reset()` bumps an `idleNonce` so returning to idle re-rolls the
  stage's random set (verified 768→254).
- **`src/surface/heroSets.ts`** (new) — shared hero pool + `sample` /
  `pickOne` / `loadBricksForNoun`, factored out of `Surface` so `App`
  (idle stage) and `Surface` (parts-legend picks) stop duplicating the
  glob/loader.
- **`Surface.tsx`** stripped to just the below-rule idle form (masthead +
  stage + idle-brick loading moved to Shell/App); `surface.css` trimmed to
  match. **`Booklet.tsx`** drops the `TitlePage` hero + the full-page
  `.result` framing and renders a lead block (term + counts) + inventory +
  steps + final directly inside the shell content; `pages.css` re-scoped
  (title-hero/masthead removed, lead block added, messages de-full-screened).
  **`TitlePage.tsx` deleted** (its masthead/stage now live in Shell; only
  consumer was Booklet).

**Stage 3b landed (2026-07-10)** — the streamed honest build log + the
front-layer assemble on the stage, verified in-browser at mobile width
against the **replayed** duck pipeline at **$0** (no Anthropic call ever
made). The full cycle confirmed: idle → submit an uncached term → the stage
shows the front silhouette as a one-deep brick wall while the log dwells on
"Designing the build" → on `done` the wall morphs into the finished 3D model
and the log gives way to the booklet (set number appears only on completion).
The persistent shell (3a) holds through the whole transition; no console
errors.

- **Transport = SSE.** The Worker's generation path streams `text/event-stream`
  frames; cache **hits stay plain JSON** (instant, no log). The client branches
  on `content-type`. Frame contract: `front {mask,color}` (the 256-char FA
  front mask, emitted at t=0) · `step {id,label}` (one per honest pipeline op) ·
  `done {grid,degraded,calls}` · `error {code,status}`.
- **`../api/src/generate.ts`** — threads an optional `OnProgress` callback
  (default no-op, so tests/offline are unaffected) through `generate` /
  `generateFromFront`, emitting `front` + one `step` per real op: match →
  design (call #1) → check → **correct only when the retry actually fires** →
  square → solidify. Honest: nearly all wall-clock is the model call(s), so the
  log dwells on design/correct and the rest flash as fast bookends.
- **`../api/src/index.ts`** — new `streamGeneration()` helper bridges the async
  pipeline to an SSE `TransformStream`; on success it stores the KV entry
  **before** `done` (so the next hit is instant), replay passes no `store` (must
  not pollute KV with duck-as-`<term>`). Distinct terminal frames per failure:
  no-source → 404-family, bad-model-output/upstream → 502. 429 rate-limit and
  cache-only 404 stay pre-stream JSON.
- **`../api/src/replay.ts`** (new) + **`test/replay.test.ts`** — the $0 harness.
  Embeds the frozen duck fixtures as string constants (the Worker can't
  `readFileSync` at the edge) and a `replayModelCall(delayMs)` that returns the
  recorded clean response after an injected delay → the real streaming pipeline
  runs offline, 1 call, no "Correcting". A drift test asserts the embed stays
  byte-identical to `test/fixtures/{duck-response,duck-masks}.txt`. Worker tests
  32 → 34.
- **`src/api/generateClient.ts`** — `generate(term, onEvent?)` now parses the SSE
  stream (frame reader + dispatch), resolving on `done`/`error`; falls back to
  JSON for hits/cache-only-miss/rate-limit. `GenerateResult` gained `miss.code`
  (`miss` | `no-source`) and `error.kind` (`rate-limit` | `upstream` | `network`
  | `config` | `bad-response`) for distinct copy.
- **`src/build/{BuildLog.tsx,build.css}`** (new) — the log in the below-rule
  zone: "BUILDING `<term>`" header, one row per streamed step, seated steps get
  a yellow stud marker + faint text, the active (running) step gets a dark
  marker that blinks on the stop-motion beat + bold ink. No spinner.
- **`src/voxel/frontLayer.ts`** (new) — `frontMaskToBricks(mask, color)` turns
  the front event's 256-char mask into a one-voxel-deep brick layer at the front
  plane (z=0), using the hull's front convention (`front[size-1-y][x]`) so it
  aligns with the finished model that replaces it. Verified visually: renders as
  a correct upright silhouette, not flipped.
- **`src/App.tsx`** — threads `onEvent` into `generate`: `front` → assemble the
  front layer on the persistent stage; `step` → append to `logSteps`. Loading
  renders `<BuildLog>`; failures render distinct `failureText(...)` copy.

**$0 replay dev toggle (local `../api/.dev.vars`, gitignored):** `CACHE_ONLY`
is commented out and `REPLAY=1` + `REPLAY_DELAY_MS=3500` are set, so any
uncached `?q=` streams the duck fixtures with 3.5 s of fake model latency — the
way to see the 3b log locally. `REPLAY` short-circuits the miss path **before**
rate-limit + Anthropic, so it's $0 by construction. **To return to cache-only
v1:** uncomment `CACHE_ONLY=1` and remove/zero `REPLAY`. (This is the *shared*
Worker's dev config — it also gates the sibling `../blawx` locally.)

**Not done in 3b (recorded, not blockers):**
- **Failure states verified by code/types only, not in-browser** — replay always
  succeeds (clean duck), so the `no-source` / `429` / `upstream` / `x-degraded`
  copy paths weren't exercised live. The mapping is typed + unit-adjacent; a live
  or forced-error pass would confirm the rendered strings.
- **Front layer is static, not staggered.** It appears all-at-once when the
  `front` event lands. The per-brick stop-motion *assemble* (bricks seating one
  at a time) is Stage 4 animation, not built here.

**Stage 4 landed (2026-07-12)** — stop-motion assembly wired out of the
`?dev` harness into the shipped shell, at **$0**. The persistent stage now
renders `<AnimatedStage>` (was static `<Scene>`) with the **legoMovie**
profile (Mike's pick from the harness; `DEFAULT_PROFILES.legoMovie`,
front-to-back arc-drop). `Scene` already took an optional `transformFor`, so
no render-side rework was needed — the feasibility question from the old Next
action is answered.

- **`src/shell/Shell.tsx`** — swaps the static `<Scene>` for `<AnimatedStage
  bricks profile=legoMovie trigger unit=24 margin=16>`; takes a new
  `stageTrigger` prop. Resting framing unchanged (same Scene, same unit/margin).
- **`src/App.tsx`** — new `stageTrigger` counter, bumped alongside each of the
  three `setStageBricks` moments (idle re-roll · front-mask on the model wait ·
  finished model on resolve) so a set change replays the assembly from frame 0
  rather than rendering frozen at the prior animation's last frame.
- **Verified in-browser (idle path, $0, no Worker):** `animatedStageMounted`,
  116 per-brick `<g>` wrappers, transforms caught at legoMovie **frame 0**
  (`translate(…,-100)` + `opacity 0` = the arc-start pose); a Back-reset
  re-rolled a fresh set and it fell into place, fully landed and unclipped at
  margin 16. rAF pauses in a backgrounded headless tab (froze one probe mid-
  flight) — a harness artifact, not a product bug: `useStopMotion` derives the
  frame from wall-clock, so a trigger fired while hidden jumps to the settled
  pose on resume; reduced-motion collapses to an instant identity cut.
- **Not driven locally:** the **front-mask assemble** and the **build-resolve
  assemble** need the Worker (`VITE_BLAWX_API` unreachable in dev →
  "couldn't reach the builder"). Same trigger mechanism as the verified idle
  path. To confirm live at $0: run the `../api` replay Worker
  (`REPLAY=1` in `../api/.dev.vars`, short-circuits before Anthropic) and submit
  an uncached `?q=`.

## Phase 5 rung (a): open search / live-gen — landed 2026-07-12

**$0 prep (all verified before any spend):** Worker suite green (34/34,
`tsc` clean); replay miss-path smoked via curl (SSE frames: `front` →
honest `step`s → `done`, duck fixture, 1 call) and then **in-browser** —
typed an uncached term at :5174 and watched the full miss UX live for the
first time: streamed build log, front-layer stop-motion assemble during the
model wait, resolve assemble into the result scroll, zero console errors.
That closed Stage 4's "front-mask + build-resolve assembles not driven
locally" caveat before going live.

**Term selection:** probed candidates against the FA index first. Traps
found: `crab` → the Cancer zodiac glyph (♋, not a crab), `elephant` → the
GOP party logo, `scooter` → the motorcycle icon. Picked `helicopter` +
`tractor` (novel, FA-matched, depth-interesting). `windmill`, `submarine`,
`whale`, `owl`, `tank`, `dinosaur` are FA misses → `no-source` 404.

**The flip:** commented `REPLAY=1` out of `../api/.dev.vars` (comment block
documents the billing consequence), restarted wrangler dev detached
(`/tmp/blawx-api-dev.log`) so the loaded config is known, confirmed cache
hits still serve from the persisted miniflare KV.

**First billable calls ever (signed off; standing allowance <$5/session):**
- `helicopter` — resolved ~10 s. **Degraded**: 521 voxels, 2 components,
  148 floating — the rotor disconnects from the fuselage across the
  one-cell mast, the known thin-feature failure class (ladder/flower).
  Cached with `x-degraded: 1` (by design; redo requires a KV delete).
- `tractor` — resolved ~10 s. **Clean**: 525 voxels, 1 component, grounded;
  222 pieces · 53 steps; the silhouette reads (cab, sloping hood, wheels).
- Both ≤2 Sonnet calls (`thinking: disabled`, the tuned profile); total
  spend ≲$0.04 at list price.

**State left behind:** the local Worker on :8787 is **live** — a novel term
typed at :5174 bills `ANTHROPIC_API_KEY` (~$0.015/term, 5 fresh/hr/IP,
cached forever). Restore `REPLAY=1` for $0-by-construction. Deployed/remote
(rung d) untouched: no remote KV, no secret set, needs its own sign-off.

## Color system (next-bets item 2) — landed 2026-07-12

**Design.** Semantic color is a **painted-front overlay**: a 16×16 repaint
of the trusted FA front mask, one color letter per `#` cell, and every
voxel inherits the color of its front cell (`rows[15-y][x]` — the same
front-row↔y convention the hull lift uses). Regions that differ in x/y
(trunk vs canopy, beak vs body) color correctly for free; depth columns
stay uniform, which is right at 16³. The geometry prompt (probe6) is
settled/validated and was **not touched** — the overlay comes from a
second, independent model call that races the geometry call:

- **Model:** `ANTHROPIC_COLOR_MODEL` env override, default
  `claude-haiku-4-5`, maxTokens 1024, 15 s timeout, no `thinking` field
  (Haiku only thinks when explicitly enabled). ~$0.002/term, so a fresh
  colored term is **~$0.017 total (≤2 Sonnet + 1 Haiku)** — still inside
  the $0.01–0.02 target.
- **Validator (deterministic):** `parseOverlay` requires exactly 16×16 and
  cell-for-cell agreement with the trusted front — every filled cell a
  legend letter, every empty cell a `.`. Any violation → null → the grid
  ships with the old single-color `NOUN_COLOR` fallback. **Color can never
  fail, delay, or degrade a generation** — no retry, no extra latency
  (awaited only after the geometry pipeline finishes).
- **Legend (client/Worker hand-copy, keep in sync):** R red, O orange,
  Y yellow, G green, B blue, N brown, T tan, W white, L lightGray, K black.

**Palette extension.** `Color` union +3 in both repos: orange `#FF8200`,
brown `#7E4A26`, tan `#E4CD9E` (tan joins the light-colors set for
side-face darkening). Inventory order and `frontLayer`'s name validation
updated; UI chrome untouched (`--accent` stays brick yellow). Surface's
swatch map carries the three as raw-hex type-completeness entries —
`colorFor()` can't return them today; promote to tokens if they ever
become UI colors.

**The paint beat.** New SSE frame `paint {overlay}` fires the moment the
overlay validates — mid-wait, while the front layer is still assembling.
The client rebuilds the stage bricks from the overlay **without bumping
`stageTrigger`**: `useStopMotion` keys start frames off brick coordinates,
so a same-geometry/new-colors swap repaints in place mid-assembly instead
of restarting from frame 0. The build gets visibly painted while the model
designs the depth. Frame contract change is backward-compatible (unknown
SSE events were already ignored).

**Files.** Worker: `src/colorOverlay.ts` (prompt/validator/propagation) +
threading through `generate.ts` (optional `callColor` param), `index.ts`
(second `callAnthropic`, replay wiring, write-after-close hardening on the
SSE frame helper), `replay.ts` (`DUCK_COLOR_RESPONSE` hand-derived fixture
+ `replayColorCall`). Client: `src/voxel/colorOverlay.ts` (legend, overlay
→ bricks, grid recolor), `seed4ToGrid(json, overlay?)`, `heroSets` glob for
optional `runs/seed4-16char-mixed/colors/*.txt`, `generateClient` +
`App.tsx` paint handling.

**Verified ($0, REPLAY):** Worker 51/51 + client 49/49 tests, `tsc` clean
both; curl of the SSE stream shows `front → paint → done` with orange beak
voxels at exactly (x∈{0,1}, y=10); in-browser at :5174 — front layer
assembles, **repaints in place** (yellow + orange beak/foot) during
"Designing the build", resolve assembles the colored duck, booklet
inventory tallies yellow/orange separately, zero console errors.

**Library backfill — staged, NOT run (batch spend gate).**
`../api/scripts/color-library.ts` colors the 29 seed nouns via the same
Haiku call and writes `runs/seed4-16char-mixed/colors/<stem>.txt`; both
the bundled idle stage and `../api/scripts/seed4.ts` (KV re-seed) consume
those files automatically once present. Without `--confirm-spend` it
prints the plan and exits: **29 terms → ≤58 Haiku calls ≈ $0.06**. Until
it runs, library sets and the idle stage stay single-color; `helicopter`/
`tractor` KV entries also predate color (redo = KV delete + re-type).

**State left behind:** `../api/.dev.vars` is restored to the live config
(`REPLAY` commented out), but the wrangler process on :8787 is still the
REPLAY instance from verification (12 s injected delay) — it needs one
restart to load the live config; the harness could not restart a
billable-path server without a fresh per-session confirmation.
