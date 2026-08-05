# blawx2

Type a noun → get a LEGO-style 16³ build and an instruction booklet.

This file is the **operating doc**: current state, decisions in force,
conventions, and what to do next. It is deliberately kept short. The
record of what was tried and what killed it lives in
`docs/decision-log.md` — read that before proposing something that looks
untried.

---

## Status (2026-07-31)

| | |
|---|---|
| **Front-end** | Complete through Stage 5 (mobile-first LEGO-manual surface, persistent iso stage, streamed build log, stop-motion pass). |
| **Geometry pipeline** | Settled. 16³ char encoding, deterministic validator + one feedback retry, strict hull lift. |
| **Live generation** | ON locally (Worker at `../api`, bills the API key). Not deployed. |
| **Seed library** | seed4 (29 terms) + **Tier-1: 50/50 authored, all structurally clean** as of 2026-07-31. |
| **Blocked on** | Mike's eyeball gate on the Tier-1 contact sheet; four open calls listed below. |

**Next action — run the approved Tier-1 regen round** (Mike, 2026-08-05;
plan at the end of the pre-seed library thread below). Mike's eyeball
gate on the 50-set contact sheet is still pending in parallel
(`npm run dev`, contact-sheet viewer, **blind** toggle) and can add or
remove flags from the regen list at any point.

**Open calls — Mike's, no recommendation implied.** Each is stated in full
further down.

1. **Worker-reshape: A, B, or C** — how live cache-misses get built.
2. **The (library size, display gate) operating point** — unblocks
   FPS-tail seeding beyond Tier 1.
3. **Color direction** — one of three, all vetoable.
4. **Deploy** — rung (d), needs `wrangler login` + a live-spend sign-off.

---

## Decisions in force

Standing constraints. Violating one needs an explicit vetoable hypothesis,
not a judgment call.

**Product**

- **Iso stays.** 30° isometric presentation (variants OK). The front-on
  hero moment is off the table; remedies for iso-lumpiness must work
  within an isometric view.
- **Production is auto-pick only.** No human selection on the public path.
  "Generate k, user picks" is a pinned fallback, not the plan. Human
  picking stays fine for R&D and offline seeding.
- **1 voxel = 1 brick** (locked 2026-07-13). Every voxel renders as a
  full-height studded brick, so a 2×4 reads as *the* flagship brick.
  Plates/tiles are a deliberate later accent, never the base unit.
- **Packer vocabulary is commonality-ranked, not largest-area.** 2×4
  workhorse, then 2×2, 2×3, 1×4, 1×2, 1×1. 2×6/2×8 stay legal but rarely
  fire — intentional.
- **Nearest-neighbor cache display: approved.** On a miss, show the
  semantically closest cached set while the real one builds, above a
  similarity floor.

**Generation**

- **Prompt v2 is the production prompt.** Full authorship from the noun
  alone (no source mask), `DOG_Z` exemplar, explicit top-view row
  anchoring. `scripts/exemplars.ts`, `scripts/make-probe8-prompts.ts`.
- **Thinking is load-bearing.** Full authorship needs ~5k+ thinking
  tokens. Thinking-off fails at every model tier tested (Sonnet 0/10,
  Opus 1/10). There is no parameter or prompt lever that buys clean
  output cheaper — the whole series is in the decision log.
- **Sonnet 5 is the route.** grok-4.5 fails the depth convention 4/10
  even at ~13k reasoning tokens/call; cross-vendor is not the lever.
- **Live full authorship costs ~$0.10–0.20/term and ~1.5–3 min/term.**
  That price is measured and firm; it is the input to open call 1.
- **The $0 route is subscription subagents** (this harness), which produce
  probe8-grade output at zero API cost. All offline seeding runs here.
- **Per-generation budget ≤ $0.20**, gated by the per-IP rate limit, with
  a BYOK prompt past the cap (user supplies their own key; Worker still
  validates + caches).
- **Only the deterministic validator blocks.** All judgment-grade
  evaluation happens in hindsight on already-served results, feeding a
  background improve-and-replace loop. No model judge gates anything.
- **FA vetted whitelist: approved** (mechanical drop of fragmenting and
  sparse icons, $0). The optional vision pass over surviving pairs (~$2)
  needs its own sign-off.

**Working QA gate:** Mike's verdict against the contact-sheet viewer.
That is the instrument that counts — model judges rank, they don't gate.

---

## Open call 1 — the Worker reshape

The probe series is complete; this is a choice, not a research question.
Under the ≤$0.20/gen decision, option A/C is affordable by fiat and
**latency is the binding constraint**.

- **A — pay for it live.** Authored front as the live cache-miss route at
  ~$0.10–0.20/term, leaning on cache-once economics. FA/FLUX demoted or
  dropped. Simplest pipeline, best live quality.
- **B — authored offline, cache live.** Keep the live Worker thinking-off
  and cheap (or cache-only); generate authored-front sets via the $0
  subscription route for the library. Live novel terms keep FA/FLUX or
  return "not yet".
- **C — hybrid.** B's offline library + A's paid route for cache misses,
  gated by the existing 5-fresh/hr/IP limit (worst case ~$0.50–1.00/hr/IP).

Option B's core — offline authored library + cheap live path — is common
to all three, which is why seeding proceeded without this call being made.
It binds when deploy is next. The FA whitelist and the iso-lumpiness work
are unaffected either way.

---

## Open call 2 — the (library size, display gate) operating point

Measured 2026-07-20 in the production embedding space (bge-small via
transformers.js, the model Workers AI serves as
`@cf/baai/bge-small-en-v1.5`). Artifacts in `data/seed-pool/`; re-runnable
via `npm run seed-pool`.

- **Pool:** Quick Draw 345 ∪ THINGS 1,854 ∪ ~110 authored first-words →
  1,916 deduped → **1,316** after a buildability filter.
- **Covering numbers**, Tier-1's 79 head terms placed first: **113 seeds
  @ floor 0.55, 228 @ 0.60, 449 @ 0.65, 729 @ 0.70, 979 @ 0.75.**
- **The floor and the display gate cannot be the same number.** ≥~0.75 is
  a defensible stand-in (pickup truck→truck .850, leopard→lion .787);
  0.60–0.70 is a coin flip (knife→sword .712 good, cow→dog .748 bad);
  ≤0.60 is junk-prone. But covering the pool at 0.75 takes 979 seeds.
- **The real trade:** a 228-seed library gives only **33%** of remaining
  queries a ≥0.70 neighbor (15% at ≥0.75); 449 seeds gives 58% at ≥0.70.
  So the knob-set is (library size, display gate, show-nothing rate).
- **Lexical-artifact caveat, survives any gate:** bge-small on bare words
  has substring noise — cleat→cleaver **.823**, fork→forklift .725. An
  "a photo of a X" template was tested and made it worse. Larger models
  (bge-base, bge-large) each fix some artifacts and mint new ones — the
  class is intrinsic to the family. **bge-small stays.** Expect the NN
  display to occasionally show a confidently-wrong neighbor.

Picking a point here unblocks FPS-tail seeding beyond Tier 1.

---

## Open call 3 — color

**Load-bearing finding (2026-07-13): accent colors mostly don't survive to
the rendered grid.** Voxel color = front cell by column projection, so any
accent over a silhouette region the geometry didn't voxel-fill vanishes —
and accents are exactly the thin details (beak, stem, wheels) that don't
get voxels. `apple`: clean 3-color paint stored as 420 red + 1 brown. The
second cause is plain dropout — a failed or rejected repaint falls back to
uniform and caches as-is, silently by design.

Three directions, no recommendation implied:

- **Make accent geometry survive** — ensure thin identifying features get
  voxels so their front colors have a column to land on.
- **Change the mapping** — color by 3D part/region instead of column
  projection, decoupling accent color from voxel presence.
- **Accept body-dominant** — lean into single-strong-color objects and
  drop the accent ambition. Cheapest; the system already trends here.

Ready when signed off: `cd ../api && npx tsx scripts/color-library.ts`
prints the plan (29 terms ≈ $0.06) and exits; `--confirm-spend` runs it,
then `npx tsx scripts/seed4.ts --local` re-seeds KV. Until then the
library and idle stage stay single-color. Colour was explicitly deferred
by Mike on 2026-07-20.

---

## Open call 4 — deploy (Phase 5 rung d)

Greenlit 2026-07-14, not executed. Steps: create remote KV
(`wrangler kv namespace create CACHE`/`RL`), `wrangler secret put
ANTHROPIC_API_KEY` (+ `REPLICATE_API_TOKEN`), `npm run deploy`, run
`seed4.ts` (no `--local`, $0) against remote KV, point blawx2's build at
the Worker URL via `VITE_BLAWX_API`. Frontend host: **mikemake.com
subpath** (`ALLOWED_ORIGINS` already lists it). Prod vars:
`RATE_LIMIT_OFF` unset, `CACHE_ONLY` unset.

**Blockers:** `wrangler login` is not authenticated, and the first live
spend on a public URL needs a fresh sign-off.

**Abuse posture (Mike, 2026-07-14): per-IP limit only for launch.** A
determined IP-rotating abuser can run up the bill. Deferred roadmap item:
a global daily spend ceiling (KV day-counter reverting to cache-only past
$N/day) — add before the demo sees real traffic.

---

## Active thread — the pre-seed library

**Why seeding exists.** A pre-seeded term does one of two jobs: **direct
hit** (instant result; value scales with query probability mass) or
**neighbor stand-in** (covers the generation wait via the NN display;
value scales with coverage of noun-space). The cache self-populates along
the real query distribution — every live miss becomes a permanent hit — so
head-selection errors self-correct with traffic while coverage holes only
fill if someone queries into one and waits. **Pre-seeding's durable job is
coverage;** the head only bootstraps day one. The UI is part of this:
suggestion chips and autocomplete over cached terms convert would-be
misses into hits, so selection and presentation are one system.

**Tier-1 seeding — all 50 sets authored** (b1 2026-07-21, b2–b5
2026-07-31, $0 subscription subagents). Prompt v2 verbatim, one subagent
per term, single-shot + 1 deterministic retry
(`retry-feedback.ts --max-depth=6`), strict hull lift. Artifacts:
`runs/tier1-16char-b{1..5}/` (10 terms each). Final state: **50/50 sets,
every one `comps=1 ground=true`, 0 malformed rows, reprojection loss 0.00
on all three views.** Contact sheets via
`scripts/render-qa-sheet.ts <out.html> <runDir…>`.

Findings from the round:

- **Prompt v2 never states the top-view row convention** (`z = 15 - row`,
  so bounds `z:0-5` fills top rows 10–15). Three of thirty sets
  mis-anchored it; turtle burned its retry and lifted to zero voxels.
  Stating the convention in the b4/b5 briefs eliminated the class: 0/20.
- **The `fillRatio ≥ 0.9` slab check fires on genuinely box-shaped
  objects.** Truck spent both attempts on it and still "failed"; the lift
  was fine. It is advisory in practice, treated as an error by the script.
- **Retry consumption:** 9/30 needed the retry (b1 0/10, b2 4/8, b3 3/10
  + turtle failed, b4 2/10, b5 3/10). Dominant cause: enclosed holes in
  the front mask.
- **Mechanical validity ≠ hull validity.** Rabbit passed the validator and
  still lifted to 3 components. Adding a `convert-response.ts` self-check
  to the briefs caught two such cases in-agent.
- **Provenance caveat:** the rabbit repair and the flower set were
  projected from an authored voxel solid, not hand-authored masks.
  Structurally sound, different generator from the other 48.

Repairs outside the single-retry protocol: **rabbit** (3 components → 1,
471 vox) and **turtle** (0 → 474 vox).

**Hindsight judgment pass (2026-08-05, `runs/tier1-blindpanel/`).** All
50 sets rendered through the production iso renderer, judged by a
2-voter blind free-naming panel ($0 Sonnet subagents) plus a
target-aware Fable eyeball. Verdicts: **15 clean / 22 marginal / 13
flagged** (flags: banana, bee, camera, coffee-cup, crown, dog, dolphin,
hamburger, monkey, motorcycle, pizza, shark, teddy-bear). Blind
free-naming is a stress ranker, not a bar — 6/100 strict hits, but the
number is not comparable to judge1's 81% forced-choice. The strongest
bad-signal found: **cross-voter wrong-consensus** (both voters converge
on the same wrong object — rose→key, pumpkin→battery, truck→table),
which structure checks can never catch. Failure classes, with members
and evidence: (A) full-depth front-mask extrusions reading as slabs —
median column depth is the discriminating stat, the fillRatio check
misses all of them; (B) species collapse on gray quadrupeds — identity
survives only via one exaggerated silhouette feature (rabbit's ears,
dinosaur's neck); (C) flat/radial objects posed wrong for iso (pizza on
its tip, sun lying flat); (D) vehicle wheels carved as notches reading
as furniture legs; (E) wrong-gestalt mimicry on structurally clean
sets. Five vetoable improvement hypotheses for the next batch (depth
plan in brief + median-depth advisory; named-caricature rule; explicit
pose rationale; wheels-as-proud-masses; keep the 2-voter panel as the
per-batch regen ranker) are stated falsifiably in
`runs/tier1-blindpanel/RESULTS.md`.

**Approved regen round (Mike, 2026-08-05) — not yet run:**

1. Amend the authoring brief template (prompt v2 + the b4/b5 additions;
   generator: `scripts/make-improve1-prompts.ts` or a tier1 variant) to
   require three pre-authoring declarations — exaggerated identity
   feature, pose + 30°-iso rationale, per-region depth plan — plus the
   wheels-as-proud-masses clause for vehicle terms.
2. Add a median-column-depth advisory (warn ≥ 12 on non-boxy terms) to
   the `convert-response.ts` self-check the briefs already use, so
   authoring agents catch their own slabs in-agent.
3. Regen the 13 flagged sets improve1-style: 2 challengers each ($0
   subscription subagents), blind 2-voter free-name panel scoring
   challenger vs incumbent, structure guard, ties keep incumbent. No
   swap into the library without Mike's eyeball on winners.
4. Re-score winners with the same panel; the wrong-consensus rate is
   the falsifier for each hypothesis. Write up as a new run dir
   (RESULTS.md) and update this thread.

If the hypotheses hold, the amended brief becomes the default for
FPS-tail batches once open call 2 picks an operating point.

**Query form matters more than vocabulary** (20-persona elicitation,
2026-07-20, synthetic, n=20 — directional only). Almost nobody types a
bare noun: of 60 first queries, 15 were personal/possessive ("my dog
rex"), ~14 franchise/proper nouns, 3 noun+scene phrases, and most in-scope
nouns arrived wrapped in articles. **This surfaced a pipeline
requirement:** a normalization layer (lowercase, strip
articles/possessives, extract head noun) in front of both exact lookup and
NN matching — `scripts/lib/normalize.ts`, pure and Worker-portable,
applied identically to pool terms and live queries. Failure classes
needing policy, not seeds: personalization, IP/franchise, functional
demands ("with moving parts"), scale demands, profanity, injection strings.

**Out of scope until their own sign-off:** regenerating the 29 seed4 terms
authored-front (vetoable separate pass), KV baking, color, and FPS-tail
seeds beyond Tier 1 (blocked on open call 2).

---

## Quality machinery

- **Judge (judge1, 2026-07-20): falsified as a gate, fit as a ranker.**
  A conditioned-rubric Sonnet judge hits 77% binary agreement / tau 0.61
  against eyeball labels — under the ~90% bar. The composite (structure ∪
  judge) catches 14/16 bad sets including both semantic traps, at 11
  false-bads — cheap wrongness, since a false-bad costs a $0 re-gen. Use
  it to **queue background regeneration**, never to block.
  `runs/judge1-cache-eval/` doubles as the judge benchmark: future designs
  must beat 77%/0.61 there, and new human verdicts append to
  `ground-truth.json`.
- **Background improver (improve1, 2026-07-20): the flywheel raises
  quality without churning.** All 25 flagged terms got 2 challengers each,
  ranked by a blind 9-voter panel with a structure guard and
  ties-keep-incumbent. **20/25 replaced**, 5 kept; both semantic traps
  fixed. Residuals: fish and mushroom were never flagged (judge blind
  spots), peanut still bad, bowl the weakest accept, candy-cane now blue
  (paint overlay not re-run). Full write-up in
  `runs/improve1-cache-swap/RESULTS.md`.
- **Deterministic backtest:** `npx tsx scripts/backtest-cache.ts` replays
  every cached grid through analyze → pack → steps → iso render and diffs
  structural fingerprints against `scripts/backtest-baseline.json`. Exit 2
  on behavior diff; `--write` adopts intended changes. Free regression
  check over real data for any geometry/packing/render change.
- **Provenance gap (blocks full-pipeline backtesting):** cache entries
  store only `{grid, metrics}` — front mask, FLUX PNG and raw model
  responses are discarded at generation time. The Worker should persist
  them (KV side-keys or metadata) so misses can be diagnosed and
  model-layer changes replayed. Roadmap item; costs nothing but storage.

**Vetoable next bets, in dependency order:** (1) judge2 — 3-vote panel +
fragment-magnitude structure signal, A/B against the judge1 benchmark;
(2) re-run the improver on the residuals once judge2 lands; (3) wire
`x-degraded` + judge verdict into a `provisional` flag the UI can show;
(4) color session — re-run the paint overlay on the 20 replaced sets.

---

## Running it

**Contact-sheet viewer / dev server:** `npm run dev`. Port 5173 is usually
taken by another prototype, so Vite shifts — read the URL it prints.

**Local Worker** (`../api`, `wrangler dev` on `:8787`): bills
`ANTHROPIC_API_KEY` for any novel term typed at the local Vite port
(~$0.017/term FA-matched: ≤2 Sonnet + 1 Haiku color; +~$0.02 Replicate
when FLUX sources the front). Every result caches to local KV forever.
Set `REPLAY=1` in `../api/.dev.vars` for $0-by-construction.

Live `.dev.vars` config: `RATE_LIMIT_OFF=1` (the 5-fresh/hr/IP limit stays
mandatory for any real deploy) and `DEV_ALLOW_LOCALHOST=1` (a deployed
worker honors `ALLOWED_ORIGINS` alone — currently `https://mikemake.com`).
**Bounce the worker after editing `.dev.vars`.** Transient Anthropic 529
windows can kill runs mid-stream; retry.

**Demo runner:** `bash ../demo-up.sh` in a real Terminal — not through
this harness, it dies with the session. Worker `:8787` + built frontend
`:5280` behind a crash watchdog. Demo URL `http://localhost:5280`.
`VITE_BLAWX_API` is baked at build time (`.env.local`), so rebuild blawx2
if the target changes.

**FLUX cold-boot caveat:** the first call after flux-schnell goes idle can
take ~40 s and sometimes fails outright, which makes novel non-FA terms
flaky in a demo. **Fire one throwaway term to warm the model right before
screensharing**, and lean on cached terms.

---

## Spend guardrail (load-bearing)

**R&D runs on the subscription, not the API.** Model interactions during
research go through Mike's Claude subscription — this session or fresh
chats. Do not add `ANTHROPIC_API_KEY` to harness code, import the SDK into
scripts, or wire a generator/scorer to a live API.

Mike granted a **standing allowance for spend below $5/session**
(2026-07-12). Above that, or for a new spend *shape* — batch seeding, A/B
sweeps, deploy-side spend, Replicate batches — re-confirm per run.
Approval for one run never extends to re-runs or variants.

The shipped surface is the exception: the deployed Worker has no
subscription route, so every live gen bills the key directly. Cache-once
economics mean each term is paid once ever. `CACHE_ONLY=1` keeps the
surface $0 by construction.

---

## Conventions

**Run metadata (required).** Every `runs/<id>/` directory intended for the
contact-sheet viewer must contain `run.json` with at least `id`, `label`,
`date` (ISO), and `pipeline`. The viewer sorts, groups and filters on
these — a missing manifest sinks to the bottom with a dash date and breaks
group filtering. Any script that creates a run dir writes the manifest in
the same pass. Label is a short human name; pipeline is one sentence.

**Stack.** Vite + React + TypeScript strict (incl. `noUnusedLocals`,
`noUnusedParameters`). Tailwind is fine. No UI kits, no charting
libraries. Reasonable devDep adds are fine.

**Prior attempts — look, don't import.** Frozen snapshots of earlier
generation attempts live in `../blawx/src/voxel/generated/baseline-*`.
They are **failure references** — they show where organics fail and how.
Do not read the code, prompts, or design notes that produced them.

**Judged examples.** None as a labeled dataset. The `baseline-*` snapshots
are the visual reference for "this is what bad looks like";
`runs/probe6-16char-sonnetdepth` and `runs/seed4-16char-mixed` are the
reference for "this is what shippable looks like at 16³".

---

## Code map

**This repo**

- `scripts/retry-feedback.ts` — deterministic validator (`--trust-front`,
  `--max-depth=N`, top-slab advisory). No model calls.
- `scripts/convert-response.ts` — parses model responses into voxel JSON;
  records `meta.masks` so runs render mask thumbnails in the viewer.
- `scripts/exemplars.ts`, `scripts/make-probe8-prompts.ts`,
  `scripts/make-tier1-seed-prompts.ts` — prompt v2 and batch generation.
- `scripts/render-qa-sheet.ts`, `scripts/_check-struct.ts`,
  `scripts/_qa_pngs.ts` — contact sheets and structural checks.
- `scripts/lib/silhouette.ts` — front-mask acquisition + depth profiles.
- `scripts/lib/normalize.ts` — the query normalizer (Worker-portable).
- `scripts/seed-pool.ts` — candidate pool, embeddings, FPS sampling.
- `scripts/build-fa-index.ts` (`npm run fa-index`) — writes
  `../api/src/fa-index.json`: 1,997 icons as grounded 16×16 masks + a
  7,509-term lookup, bundled into the Worker (104 KB gz).
- `src/bench/*` — neutral iso renderer, hull lift, encoding parsers.
- `src/design/` — tokens and motion constants; the design language as
  code. Canonical accent is LEGO yellow `#FFCC00` on black text;
  `--radius-pill` is the *only* rounding in the app.

**The Worker** (`../api/src/`): `generate.ts`, `probe6.ts`,
`orientation.ts` (8-orientation z-flip search + front-protecting repair),
`faIndex.ts`, `masks.ts`, `hull.ts`, `color.ts`, `flux.ts`,
`silhouette.ts`. Model config: `claude-sonnet-5`, maxTokens 2048, 30 s
timeout, `thinking:{type:'disabled'}` set **explicitly** (Sonnet 5
defaults to adaptive, which would blow the tuned cost/latency profile).

**Substrate ported from `../blawx/`** (8³ → 16³ upsize): `render/iso.ts`
(true 30° projection, `x' = (x - z)·cos30°·22`), `render/Brick.tsx`,
`Scene.tsx`, `palette.ts`; `voxel/pack.ts` (packer), `voxel/steps.ts`;
`booklet/*`; `api/{generateClient,mockCache,slug}.ts`;
`search/SearchLanding.tsx`.

---

## Backlog

Proposed order, each independently vetoable.

1. **Lever B — non-cubic geometry + mixed piece heights.** The real
   Minecraft-killer and the committed arc (Mike, 2026-07-13). Two
   entangled expansions, both pipeline-scale: slopes/wedges/round
   bricks/arches change the *silhouette*, needing a representation beyond
   occupancy (per-cell part type + orientation), inference of where parts
   go, and a renderer per type; mixed heights means "1 voxel = 1 plate"
   with ~3× vertical resolution. Entangles with the color-projection gap.
   Scope as its own arc. **Upstream of** instruction UX.
2. **Instruction-manual UX** — smarter step inference (max step count,
   ordering), better manual display. Rides on Lever B's decomposition.
3. **Buildability settings** — a menu where the user declares which brick
   types they own, narrowing the packer's vocabulary. "Make me something I
   can build tonight from what's in the bin." Slots onto the footprint
   preference list. Backlog, not scheduled.
4. **Top-slab advisory exemption** — the check false-positives on
   genuinely rectangular objects. In the Worker it can trigger a harmless
   extra call on box-shaped nouns. A production nicety, not a blocker.

---

## Where the history lives

- `docs/decision-log.md` — **what was tried and what killed it.** The
  2026-07-19 quality findings report (cache contamination, FA semantic
  traps, glyph fragmentation, the uncurated FLUX route, the never-rendered
  front view), the full probe series 7–15, the self-improvement loop
  write-ups, and the Phase 1–6 histories. Verbatim, chronological.
- `docs/build-log.md` — as-built implementation detail for Phases 5–6.
- `docs/voxel-history.md` — probe-by-probe geometry journey, Phases 1–4.
- `../blawx2-AGENTS-archive-2026-07-19.md` — the quality notes superseded
  by the 2026-07-19 findings report.

Nothing in those files is required to start the next action.
