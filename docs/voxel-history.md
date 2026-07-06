# Voxel geometry — R&D history

Chronological log of the probes that led to the settled 16³ pipeline.
AGENTS.md carries the settled facts and canonical exemplars; this file
is the journey behind those facts. Per-run manifests and outputs live
in `runs/<id>/`.

## Phase 1a — Benchmark harness (2026-07-03)

Neutral iso renderer, contact-sheet viewer, 30-noun list, hypothetical
per-token cost math. `src/bench/*` + `runs/README.md` workflow. No
model calls.

## Phase 1b — Grid × encoding sweep, sweep1 (2026-07-04)

6 cells (8/16/32 × char/rle) × 12 nouns, Haiku 4.5 subagent fan-out.
Mike's audit of blind-name verdicts: **0/72 recognizable across all six
cells** (Haiku adjudicator's hits and closes were shape-vocabulary
noise). Cells settled as emission-viable: `8-char`, `16-char`.
Emission-unreliable: `8-rle`, `32-*`. Localization: 2D masks themselves
were unrecognizable at Haiku tier — the sweep axes weren't the binding
constraint.

## Relift1 (2026-07-04)

Deterministic repair — interior flood fill + per-shared-axis bbox
alignment + 2-of-3 vote lift (`src/bench/maskOps.ts`). Bbox misalignment
was the dominant mechanical failure; alignment cut mean max-reprojection
loss 5–10×. `robot`, `chair`, `tree`, `sailboat` recovered readable
structure from the same Haiku outputs. `vote` retired (blobs toward box
union). Established: deterministic repair (fill + bbox alignment) is
free quality; recognizability remains mask-bound.

## Probe1 — Model tier (2026-07-04)

Hardened prompt + 8×8 dog worked example. 6 nouns × Haiku/Sonnet/Fable.
Haiku still broken. Sonnet & Fable mechanically clean. Fable delivered
the first organics with correct body plans (fox as real quadruped);
Sonnet coarser but usable. Established: the worked example transfers
the body plan (Phase 4 exemplar hypothesis, cheap early confirm).

## Probe2 — Exemplar transfer, single-shot (2026-07-04)

Plan-matched exemplars (dog/sparrow/carp). Agents told "no tools" →
single-shot emission, the production shape.
- Fable: **5 hits + 1 close of 6.** Bird and fish both flipped to hit.
  Caricature/exemplar hypothesis confirmed end-to-end at Fable.
- Sonnet single-shot: **mechanically broken** (truncated masks, hollow
  outlines). Probe1's "Sonnet: zero malformed rows" was an artifact of
  the self-verify loop, not intrinsic. Control run confirmed.

## Probe3 — Opus single-shot (2026-07-04)

Opus 4.8 marginal — 0 hits + 3 close of 6. Between Sonnet and Fable,
closer to unreliable.

## Probe4 — Sonnet 2-call runtime (2026-07-04)

`scripts/retry-feedback.ts`: deterministic validator (row count/width,
cross-view consistency, declared vs actual bounds, enclosed-hole
detection). Retry with call-1 context. **Mechanical emission is a
solved problem at Sonnet tier for ~2× tokens (~$0.01/term).** Drawing
quality partial: bird plausible, fish dropped the forked tail.

## Probe5 — Library-as-exemplar + shape-advice loop (2026-07-04)

Full-res 16×16 exemplars from Fable's probe2 outputs. Haiku
blind-name → shape-advice retry. Net 1/3 through the full ~4-call loop.
Diagnosed: Sonnet emits near-rectangular top-view footprints;
front-profile shape advice can't fix a footprint problem. Motivated
a deterministic footprint check (which became the top-slab advisory in
`retry-feedback.ts` later).

## Icon1 — Font Awesome downsample (2026-07-04)

`scripts/icon-lift.ts`: FA solid SVG → 480px raster → ink-bbox-fit 16×16
front mask → deterministic depth-4 extrusion. **Strongest per-dollar
results in the project.** Instantly recognizable fish (forked tail,
open mouth, eye hole), mug (handle hole + saucer), crow, dog, horse.
**The binding constraint (2D silhouette quality) can be SOURCED, not
generated.**

## Mike's decisions (2026-07-04)

Laddered acquisition approved: icon set → text-to-2D image model → LLM
mask drawing. Image-API spend OK for cheapest flat-silhouette models.
Fable off the runtime table (assumed unaffordable per-request).
Standing: depth is NOT meant to stay flat extrusion — the "3D-native"
character of real isometric sprites is the bar.

## Icon2 / icon3 — Depth ladder (2026-07-04)

- **icon2 (deterministic inflate)** — winner on animals. Dog reads as
  isometric sprite (2-deep legs, fat body, stepped ears); fish stays
  thin and keeps features.
- **icon3 (Sonnet designs side/top conditioned on verbatim front)** —
  capable but unreliable at n=2. New failure mode (second profile drawn
  as side view) motivated `--trust-front` and `--max-depth` flags in
  `retry-feedback.ts` (added later).
- Verdict at the time: deterministic inflation + per-category profile
  table for Phase 2. Fable-tier three-view design for library seeds.
  icon3 route retired.

## Seed1 — 18/30 seeded (2026-07-04)

`scripts/seed-library.ts` with FA icons + per-category profile
(`flat` / `inflate` / `prone` / `round`). Round(10) failed on all
five nouns (concentric staircase ledges). ~6 hits + 5 close of 18 by
Fable eyeball.

## QA-gate calibration (2026-07-04)

Full 2×2 (Haiku/Sonnet × free-naming/multiple-choice) over the same
18 seed1 PNGs, plus a known-good control (icon2, the project's best
eyeballed run). Control scored 0.25 (dog → "llama", mug → "throne").
**The instrument inverts quality ordering — blind-naming below Fable
tier is unusable as an R&D gate.** Fable eyeball is the working gate.

## Text-to-2D scoping (2026-07-04)

FLUX.1 schnell picked as first test: $0.0027 (Together AI) or $0.003
(Replicate) per image, 6–30× cheaper than alternatives, fine-detail
weaknesses die at 16×16 downsample. Standing rule: no image-API spend
without per-run sign-off.

## Round-depth A/B, seed3 (2026-07-05)

`round2(lo,hi)` two-level variant added. Verdict: two-level
quantization doesn't rescue any of the five round nouns. Failure was
total depth, not level count — anything ≥6 deep turns a 16-wide
silhouette into a building. `round` / `round2` retired from the
profile table (kept in code as history); `flat(4)` is the acceptable
floor. `seed3-16char-fa` is the FA-only canonical run at that point:
18/30.

## Rung-2 pilot, gen1 (2026-07-05, ~$0.19 Replicate)

FLUX.1 schnell for the 12 icon-miss nouns + 4 weak-icon retries. 64
images, 13/16 nouns produced usable-to-strong fronts on the first
batch. Systematic failure mode: features thinner than one grid cell
(ladder rungs, flower stems). **Text-to-2D rung works.** Ops learning:
Replicate throttles at 60 predictions/min → added retry-with-backoff
and `--skip-existing` resume flag to `gen-silhouettes.ts`.

## Seed4 — 28/30 seeded (2026-07-05)

New canonical library run. FA icons + gen1 FLUX PNGs, Fable-picked
winners + profile per noun. Misses: `ladder`, `flower`. Front-edge
smoothness matters more than depth profile — tiered front edges (tree
canopy, mushroom cap) always extrude to staircase ledges.

## Rung-2b sheet probe, gen2 (2026-07-06, ~$0.10 Replicate)

Single "orthographic model sheet" FLUX prompt (FRONT / SIDE / TOP
left-to-right) → thirds split → 3-view hull. 32 sheets across 4
nouns × 2 prompt phrasings × 4 seeds.
- View diversity is the weak link (top slot never top-down).
- `hull3` (strict 3-view AND) dead on arrival.
- `hull2cap6` fox showed structural novelty (z-separated legs).
- **Mike's overriding eyeball verdict: sheet route RETIRED.** Even the
  cap6 fox reads as generic chunky quadruped; traded away the profile
  legibility that made seed4's fox at least nameable.

Standing conclusion: sourcing better fronts from schnell works;
sourcing depth from schnell does not beat free heuristics at 16³.

## Render-side shading experiment (2026-07-06)

`renderIsoSVG` gained `mode: 'shaded'` — wider face luminance, per-voxel
depth falloff, ground contact shadow. **Mike verdict: no help.** The
presentation hypothesis is falsified — geometry below a legibility
floor cannot be presented into goodness. Shaded mode stays in code as
a viewer toggle. Process note: bet was proposed as "the remaining
lever" instead of as a vetoable hypothesis — recorded so it isn't
repeated.

## Reframing (2026-07-06)

Mike observation: the Sonnet-designed rounds (`icon3-16char-
sonnetdepth`, `probe1-16char-sonnet[-bbox]`, `probe4-16char-sonnet`,
`probe5-16char-sonnet`) look better than every other non-Fable round.
What they share: side/top masks were **designed by a model**, not
extruded from a 2D source. Two-axis decomposition of the whole problem:
front-silhouette legibility (icons/FLUX excellent + ~free) vs volume
character (heuristics flat; model-designed 3D-native). seed4 optimized
the first axis and defaulted the second. Untested combination:
**sourced front + Sonnet-designed side/top conditioned on it** —
icon3's retired route, re-openable with the post-icon3 tooling
(`--trust-front`, `--max-depth`, top-slab advisory) that directly
targets icon3's observed failure modes.

## Probe6 — Conditioned-depth (2026-07-06, $0 subscription)

`runs/probe6-16char-sonnetdepth`. seed4 fronts held verbatim; Sonnet
designs side/top via `depth-draw-v2` prompt
(`scripts/make-probe6-prompts.ts`); deterministic retry loop; strict
lift.
- 6/6 reproduced the given front verbatim on call 1. Copying a sourced
  mask is a solved sub-task at Sonnet, unlike designing one.
- One deterministic retry fixed 4/6. `duck` and `mug` came back with a
  new failure mode: top view drawn **z-mirrored** (footprint on back
  rows, disagreeing with side view's z cells). One more targeted
  feedback round fixed both.
- The z-mirror is NOT repaired by bbox alignment — `alignBboxes`
  reconciled it by *stretching* to full-16-deep extrusions. If the
  route ships, the deterministic fix is a **z-flip orientation search**
  (precedent: `gen-sheets.ts`'s 8-way flip), not bbox.
- Fable eyeball vs seed4: structural wins are the story — `table` is
  the best A/B delta in the project (four legs separated in both x and
  z under an overhanging top); `rocket ship` gains separated landing
  fins. Animals improve modestly (tapered footprints, per-part depth)
  but staircases dictated by front edges remain.
- Cost at Sonnet list prices: ~$0.012/term (2-call) to ~$0.018 (3-call)
  — inside the $0.01–0.02 target.

## Mike's verdict on probe6 (2026-07-06)

Satisfied. Geometry pipeline is at a satisfying place. Zoom back out to
the full-pipeline v1 (Phase 5).
