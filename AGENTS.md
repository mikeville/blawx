# blawx2

Read `PLAN.md` for the project plan.

## Entry point

Phase 0's code-survey items (Q1 renderer contract, Q3 infrastructure)
are answered inline below — see "Substrate to reuse." Q2/Q4/Q5 are also
answered inline. **Start at Phase 1a** (benchmark harness). Stop and
report before any API calls so the spend guardrail below can be honored
per run.

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
session, pasted into a results file the harness reads. Phase 1b sweeps
run one noun × one model at a time. Cost is tracked as *hypothetical*
per-token math (what the call would cost at API prices) — nothing is
actually billed.

This holds through Phases 1–4. The shipped public toy will call
`../api/` (already has `ANTHROPIC_API_KEY` wired as a Wrangler secret),
but that's a post-R&D concern.

Target per unique term when shipped: **$0.01–0.02**, ≤ ~10 s per
cache-miss.

## Stack

Vite + React + TypeScript strict (incl. `noUnusedLocals`,
`noUnusedParameters`). Tailwind is fine. No UI kits, no charting
libraries. Near-zero dependencies — flag any add.

## Substrate to reuse from the sibling repo

The prior prototype at `../blawx/` is not authoritative for the new
generation pipeline, but two of its pieces are directly reusable:

- **Iso projection math** — `../blawx/src/render/iso.ts`. True 30° iso,
  `x' = (x - z) · cos30° · 22`, `y' = (x + z) · sin30° · 22 - y · 22`.
  The neutral eval renderer in Phase 1a should share these constants so
  eval and LEGO views are geometrically aligned.
- **KV cache + Worker route + rate limit** — `../api/`. Key `g:<slug>`,
  infinite TTL; `slug.ts` normalization; 5 fresh/hr/IP.
  `ANTHROPIC_API_KEY` already wired as a Wrangler secret. Phase 2 onward
  can plug into this rather than rebuild it.

The prior LEGO renderer is locked to 8³ with a 7-color indexed palette
(`../blawx/src/voxel/types.ts`, `../blawx/src/render/palette.ts`). The
plan explicitly runs the benchmark at 8³/16³/32³ in the neutral eval
renderer only; the LEGO skin stays 8³ until form quality is proven.

## Prior attempts — look, don't import

Frozen snapshots of prior generation attempts live in
`../blawx/src/voxel/generated/baseline-*` (baseline-llm, -point-e,
-shape, -shapenet, -objaverse, -stabletext2brick, and variants). Look
at them as **failure references** — they show where organics fail and
how (silhouette collapse, coin-extrusion, wrong body plan). Do NOT read
the code, prompts, or design notes that produced them. Arrive at a
working generator from PLAN.md, not from patching what didn't work.

## Cost frame

Target per unique term (from PLAN.md verification): **$0.01–0.02**,
≤ ~10 s per cache-miss. Prior data points from the sibling repo:
Hunyuan-style neural voxelization ran ~$0.08/term (too expensive for a
public toy); prior in-chat Claude self-loop was $0 against a chat quota
but would land near $0.003–0.01/term at Haiku 4.5 API prices. The
runtime model is a **variable** in the Phase 1b sweep, not a settled
choice.

## Judged examples

None as a labeled dataset. The `baseline-*` snapshots above are the
visual reference set — treat them as "this is what bad looks like."

## Run metadata (required)

Every `runs/<id>/` directory intended to appear in the contact-sheet
viewer **must** contain a `run.json` with at least `id`, `label`,
`date` (ISO `YYYY-MM-DD`), and `pipeline`. The viewer sorts, groups,
and filters on these fields — a missing manifest shows up as a
metadata-less row (dash date, sink to the bottom on date sort) and
breaks group-family filtering. Applies to gen batches and source-image
runs too, not just benchmark rounds — anything that lands in `runs/`.
`sheet-selftest`-style script sanity checks with no JSON at the
top level of the run dir are fine to omit, since the viewer never
picks them up.

Any script or workflow that creates a new `runs/<id>/` directory
should write `run.json` in the same pass. See existing manifests for
tone (label is a short human name; pipeline is a one-sentence
description of the process, not a novel).

## Status

**Phase 1a benchmark harness: built and verified (2026-07-03).**

- `src/bench/isoRender.ts` — neutral eval renderer (monotone SVG,
  true-30° projection sharing `iso.ts` constants, hidden-face culling,
  painter's algorithm; optional flat-color variant). ~130 lines, no deps.
- `src/bench/nouns.ts` — fixed 30-noun list (10 structural / 12 organic /
  8 hard incl. multi-word + abstract).
- `src/bench/types.ts` — result interchange format + validating parser
  (out-of-range/duplicate voxels dropped and *counted* as a signal).
- `src/bench/cost.ts` — hypothetical per-token cost math (list prices,
  no live calls anywhere in the harness).
- `src/App.tsx` — contact-sheet viewer over `runs/*/*.json`: blind mode,
  per-run mean blind-name score, opaque-filename PNG export for scoring.
- `runs/README.md` — the human-in-loop run/paste/score workflow.
- `runs/baseline-llm/` — prior-attempt outputs imported as failure
  reference (voxel data only, via `scripts/import-baselines.ts`);
  `runs/fixtures/` — hand-made geometry validating the renderer.
- Tests: `npm test` (tsx --test, 8 passing). Build + lint clean.

**Phase 1b sweep harness: built (2026-07-04).** Mask encodings + tolerant
parsers (`src/bench/encodings.ts` — malformed rows repaired and counted),
strict three-view hull lift with per-view reprojection loss
(`src/bench/hull.ts`), prompt packet generator (`scripts/make-prompts.ts`)
and paste converter (`scripts/convert-response.ts`). Packet generated:
72 prompts across `runs/sweep1-{8,16,32}-{char,rle}/prompts/` (12-noun
stratified subset; `--all` regenerates for 30). Workflow in
`runs/README.md` § Sweep workflow. 19 tests passing. Hypothetical cost
of the full 72-paste sweep: ~$0.13 at Haiku 4.5 prices, ~$0.63 at Opus
prices — $0 actual (subscription pastes).

**Phase 1b sweep1 executed (2026-07-04, Haiku 4.5 subagent fan-out).**
All 72 responses at `runs/sweep1-*/responses/<noun>.txt`, all 72
converted hulls at `runs/sweep1-*/<noun>.json`. Contact sheet at
`npm run dev` renders them. No blind scoring run.

**Execution method:** Claude Code Haiku 4.5 subagents (subscription,
no `ANTHROPIC_API_KEY`). Manual pasting rejected on time grounds. The
Claude Code system prompt wraps the subagent — constant across all 6
cells, so it preserves grid×encoding ranking but leaves absolute scores
not directly comparable to a claude.ai chat. `conditions.model` =
`claude-haiku-4-5` in all 6 `run.json`.

**Findings.** Two independent axes: (1) diagnostic well-formedness —
whether the model produced parseable masks that lifted to a non-empty
hull, tracked mechanically by the harness; (2) recognizability —
whether the rendered hull looks like its noun to a human, only visible
by eyeballing the contact sheet or via blind scoring.

Diagnostic well-formedness (from `scripts/convert-response.ts` output):

- `sweep1-32-rle`: 4 hull collapses to zero voxels (fish, fox, love, tree)
- `sweep1-32-char`: heavy malformed-row counts (~70–98) across most nouns
- `sweep1-8-rle`: severe resolution loss (chair=6vx, fish=2vx)
- `sweep1-16-*` and `sweep1-8-char`: masks parse cleanly and hulls are
  non-empty (this is a mechanical claim about output structure, NOT
  about recognizability)

Recognizability (Mike, eyeballing the contact sheet): most hulls are
not recognizable as their target nouns, **including in the cells that
are diagnostic-healthy**.

Blind-name scoring (Haiku 4.5 vision subagent per run, Haiku
adjudicator, hit=1 / close=0.5 / miss=0):

```
run                 hit  close  miss  score
sweep1-8-char        1     3     8    0.208   ← best
sweep1-16-rle        1     2     9    0.167
sweep1-32-char       0     4     8    0.167
sweep1-32-rle        0     2    10    0.083
sweep1-16-char       0     1    11    0.042
sweep1-8-rle         0     0    12    0.000
```

Scoring PNGs at `runs/<run>/scoring/`, verdicts at
`runs/<run>/scores.json`. Rendered via
`scripts/render-scoring-pngs.ts` (uses `@resvg/resvg-js`, added as
devDep).

Structural-vs-organic pattern in the verdicts: every hit and every
close is on a structural noun (chair, house, mug, robot, tree). Every
organic (bird, fish, fox, octopus) is `miss` in all six cells. `love`,
`rocket ship`, `sailboat` also miss in all six.

**Mike's audit of the verdicts (2026-07-04):** the Haiku adjudicator's
hits and closes are all shape-vocabulary noise, not recognizability.
The judge accepted `mug="Cube"`, `robot="Platform"`,
`house="Pyramid"` as close because they share generic "boxy shape"
vocabulary. It called `sweep1-8-char/chair="Chair"` and
`sweep1-16-rle/house="box"` hits, but eyeballing those two hulls Mike
reads them as misses too — a boxy voxel blob getting called "box" is
the same failure mode as the closes. **Under Mike's audit the sweep is
effectively 0/72 across all six cells — no cell shows the pipeline
producing a recognizable hull of any target noun.** Raw `scores.json`
files preserved as-is for auditability; this note is the load-bearing
interpretation.

**Fable's diagnosis (2026-07-04, from reading raw responses + hull
meta in `sweep1-16-char`, the diagnostic-healthiest cell):** the 0/72
failure localizes **upstream of grid size and encoding** — the sweep's
two axes were never the binding constraint. Three stacked causes, in
order of severity:

1. **The 2D masks themselves are unrecognizable.** Haiku's masks are
   generic blobs/triangles (mug = two stacked rectangles, no handle;
   bird = notched triangle; fish = oval), and for some nouns it drew
   **hollow outlines instead of filled silhouettes** (fox: `#` border,
   empty interior) despite the prompt saying "silhouette" and showing a
   filled sphere example. Recognizability was lost before the lift ever
   ran.
2. **Cross-view misalignment, amplified by the strict lift.** Per-view
   reprojection losses in the healthy cell run up to 0.67 (chair:
   0.39/0.59/0.67 — its front mask was actually chair-like in 2D, but
   the top view placed the object in a different footprint, so the
   intersection ate the legs). The one-paragraph consistency rule in
   the prompt is not enough at Haiku tier.
3. **Row-width drift even in "clean" cells** (fox emitted 18-char rows
   on a 16 grid → 48 repaired rows), so "16-char parses cleanly" in the
   earlier findings overstated health — the tolerant parser was doing
   silent work.

Consequences for the plan: the caricature/icon hypothesis is
**untested, not falsified** — Haiku never produced masks good enough to
test whether the three-view-hull architecture preserves a good mask.
The sweep DID settle its designed question (8-rle and 32-anything are
emission-unreliable; 16-char/8-char are the viable envelopes). Blind
scoring of the six Haiku cells is dead — nothing recognizable to score,
and the Haiku adjudicator is separately too lenient (defer fixing the
judge until there's signal worth judging).

**Re-lift experiment executed (2026-07-04, $0, no model calls).**
`src/bench/maskOps.ts` (interior flood fill, per-shared-axis bbox
alignment, 2-of-3 vote lift sharing hull.ts projection code),
`npm run relift` → 9 variant dirs `runs/relift1-{16char,8char,16rle}-
{fill,bbox,vote}/`. Source sweep1 cells regenerated in place with
`meta.masks` added (voxel equality asserted, 36/36). Contact sheet now
renders per-view 2D mask thumbnails (toggle). 27 tests, build + lint
clean. Docs: `runs/README.md` § Re-lift experiments.

Relift1 findings (Fable, eyeballing rendered PNGs at
`runs/relift1-*/scoring/`):

- **Bbox misalignment was the dominant mechanical failure**, not
  hollow outlines: alignment cuts mean max-reprojection-loss 5–10×
  (16-char: 0.36 → 0.08), and flood fill found almost nothing to fill
  — though partly because outline-drawn masks (fox) have truncation
  gaps that leak the fill, so `filledCells` understates outline-ness.
- **`bbox` recovers real structure from the same Haiku outputs**:
  robot went from blob to a readable head+body+legs figure (best
  output of the project so far), chair recovered its legs, tree reads
  as trunk+stepped canopy, sailboat as a triangular sail. Still
  borderline — plausibly "close" under honest blind naming, not clean
  hits.
- **`vote` is a regression** — 2-of-3 blobs everything toward the box
  union (mean voxels ~3.4× strict); drop it as a candidate.
- **Organics unchanged**: fish/bird/octopus/fox masks were never
  animal-shaped, so no lift repair can rescue them. The mask content
  ceiling is binding, exactly as diagnosed.

Conclusion: deterministic repair (fill + bbox alignment) belongs in
the Phase 2 pipeline as a permanent stage — it's free quality. But
recognizability is still mask-bound, so the model/prompt is the next
lever.

**Model-tier probe executed (2026-07-04, probe1).** Hardened prompt
(`scripts/make-probe-prompts.ts`, conditions.prompt=`hardened-v2`):
solid-fill rule, declared `bounds` line, per-axis consistency rules,
and a worked 8×8 dog example (hand-authored, validated through the
real lift — renders as a clean quadruped, zero reprojection loss).
6 nouns (mug, chair, fox, bird, fish, rocket ship) × 3 tiers
(Haiku 4.5 / Sonnet 5 / Fable 5), Claude Code subagents as in sweep1,
$0 actual. `scripts/relift.ts` now takes run-dir args +
`--variants=`; probe dirs relifted with bbox. Results in
`runs/probe1-16char-{haiku,sonnet,fable}[-bbox]/`, PNGs under
`scoring/`.

Probe1 findings (Fable eyeball, harsh read):

- **Mechanical emission is a hard tier cliff.** Haiku under the
  hardened prompt is still broken (mean 33 malformed rows/noun, chair
  hull collapsed to zero, losses to 0.93) — prompt hardening does NOT
  fix Haiku; it is out as the mask-emitting model. Sonnet and Fable:
  12/12 nouns with zero malformed rows and zero reprojection loss.
- **Recognizability at Fable: architecture validated.** Chair, mug,
  rocket ship are clean unambiguous hits (cylinder mug with a real
  handle hole; finned rocket with nose cone). Fox is a genuine
  quadruped with ears/legs/tail — the first organic with a correct
  body plan in this project. Fish borderline-close, bird a miss
  (over-inflated blob). Roughly 3 hits + 2 close of 6 vs sweep1's
  0/72.
- **Sonnet: same mechanics, cruder caricature.** Chair hit; rocket
  and mug near-hits (boxier); fox again a clear quadruped; fish and
  bird miss. Usable floor, a tier below Fable on shape design.
- **The worked example transfers the body plan.** The dog exemplar
  turned fox into a quadruped at both tiers — direct, cheap
  confirmation of the Phase 4 exemplar hypothesis. Bird/fish (no
  matching exemplar in the prompt) are exactly the ones that stayed
  weak.
- **Cost does not gate the tier.** ~520 in / ~220 out tokens per term
  at 16³ char → ≈$0.005 (Sonnet), ≈$0.008 (Opus-class) hypothetical —
  all inside the $0.01–0.02 target. Caveat: probe agents ran
  self-verification loops inside the Claude Code wrapper; a
  single-call runtime would rely on our deterministic repairs
  (fill/bbox) instead, which is what they're for.

**Probe2 executed (2026-07-04): plan-matched exemplars, single-shot.**
Exemplar infrastructure: `scripts/exemplars.ts` (hand-authored 8×8
dog/sparrow/carp, each validated through the strict lift — zero
reprojection loss, declared bounds match lifted extents; re-check with
`npx tsx scripts/validate-exemplars.ts`, renders to
`runs/fixtures/exemplar-*.png`), `scripts/probe-prompt.ts` (prompt
builder extracted from make-probe-prompts.ts, byte-identical output
verified against the probe1 packet), `scripts/make-probe2-prompts.ts`.
Exemplars are deliberately labeled sparrow/carp — different nouns from
the probed bird/fish — so the probe tests body-plan *transfer* (like
dog→fox), not copying.

Method change vs probe1, deliberate: probe2 agents were told "do not
use any tools", so responses are **single-shot emissions** — the shape
of the production single-call runtime. Probe1 agents had run
tool-assisted self-verification loops; that difference turns out to be
load-bearing (control below). Runs: `runs/probe2-16char-{sonnet,fable}
[-bbox]`, control `runs/probe2ctl-16char-sonnet[-bbox]`.

Probe2 findings (Fable eyeball, harsh read):

- **Fable single-shot: both organics flip to hit.** Zero malformed
  rows, zero reprojection loss on all six masks. Bird is a real
  perched bird (head+beak, raised tail, two separate legs with feet);
  fish has a forked tail + dorsal fin. Both are mirrored and
  re-proportioned relative to the exemplars — genuine body-plan
  transfer, not upscaled copies. Cumulative at Fable across probe1+2:
  5 hits (chair, mug, rocket ship, bird, fish) + 1 close (fox) of 6.
  The caricature/exemplar hypothesis is confirmed end to end at Fable.
- **Sonnet single-shot: mechanically broken.** Truncated masks (8–10
  rows instead of 16), 16 malformed rows per noun, cross-view losses
  to 0.63; strict lifts are a wedge and a slab, and bbox repair yields
  striped slabs, not animals. **Control:** probe1's own fox/mug
  prompts (dog exemplar) re-run at Sonnet single-shot are equally
  broken — 48 malformed rows each, 15-wide rows, mug emitted as a
  hollow outline (the sweep1 failure), 8-voxel hull. So the collapse
  is single-shot Sonnet emission generally, NOT the new exemplars —
  and probe1's "Sonnet: zero malformed rows" was an artifact of the
  self-verification loop, valid only for a runtime that includes one.

**Probe3 executed (2026-07-04): Opus 4.8 single-shot, all 6 nouns**
(probe1 prompts for mug/chair/fox/rocket, plan-matched probe2 prompts
for bird/fish). `runs/probe3-16char-opus[-bbox]`. Findings:

- Mechanics: between the tiers, closer to unreliable. 4/6 nouns had
  malformed rows (bird's top mask drifted to 14–18-char rows; rocket's
  top mask was 10 rows and a duplicate of its front view; chair
  emitted a wrong-width first attempt then self-corrected mid-response
  with prose commentary, violating the output contract). Losses to
  0.56 strict; bbox repair recovers to mean max-loss 0.075.
- Recognizability after fill+bbox: chair close-to-hit, mug close
  (boxy, handle a bar not a loop), fish borderline; bird, fox, rocket
  miss (fox was drawn face-on and floating; bird's footprint was
  destroyed by the malformed top rows). Roughly 0 hits + 3 close of 6
  — below tool-assisted Sonnet, far below Fable.

**Tier picture for a single-call runtime** (the production shape —
one prompt, one response, deterministic fill/bbox repair, strict
lift): Haiku broken, Sonnet broken, Opus 4.8 marginal, Fable clean.
Emission discipline AND shape design both improve with tier, and only
the top tier currently delivers both without a self-check loop.
Phase 2 runtime options this leaves open: (a) Fable/top-tier single
call — works end to end, but check Mythos-tier API pricing against
the $0.01–0.02/term target before committing; (b) Sonnet or Opus +
one verify/fix round-trip (~2× tokens ≈ $0.01 at Sonnet prices) —
this is the shape probe1 accidentally validated; (c) prompt/encoding
changes that make mid-tier single-shot emission reliable (untested).
Hypothetical single-call cost from probe1 token counts: ≈$0.005
(Sonnet), ≈$0.008 (Opus-class) per term.

Mike's call on the runtime (2026-07-04): Fable API pricing is assumed
unaffordable at scale — route (a) is off the table for the public toy.
The open question was whether (b) survives the drawing-quality
evidence; probe4 below tests it.

**Probe4 executed (2026-07-04): Sonnet 2-call runtime (single-shot +
one deterministic-feedback retry), bird + fish, plan-matched
exemplars.** `scripts/retry-feedback.ts` is the deterministic
validator: view presence, row count/width/charset, cross-view
consistency (shared height/width/depth as filled-set comparisons),
declared-vs-actual bounds, enclosed-hole (hollow silhouette)
detection — no model calls, emits the exact feedback text the retry
call receives. Run layout: `runs/probe4-16char-sonnet/` with
`responses-call1/`, `feedback/`, final `responses/`. Subagent
conversations were resumed with the feedback message, so the retry
had call-1 context — the true production 2-call shape.

Probe4 findings:

- **The retry loop fixes mechanics completely, 2/2.** Call 1 was
  broken as expected (bird: 14-wide × 10-row masks; fish: 7-row
  masks plus a mid-response self-correction). After one feedback
  round-trip both nouns came back 16×16, zero malformed rows, zero
  reprojection loss, bounds agreeing — validator-clean with no
  tolerant-parser help. Mechanical emission is a SOLVED problem at
  Sonnet tier for ~2× tokens (~$0.01/term).
- **Drawing quality only partially follows.** Bird: right body plan
  (head with stepped beak, long body, two blocky legs) — close,
  maybe a weak hit; visibly cruder than Fable's. Fish: kept the
  carp exemplar's dorsal fin and oval body but DROPPED THE FORKED
  TAIL — the one feature that sells "fish"; renders as a finned
  loaf. Miss-to-borderline. n=1 per noun; variance unmeasured.

Where this leaves the tier question: mechanics are cheap to buy at
any tier (deterministic retry), but shape design remains the binding
constraint below Fable. The evidence pattern across probes 1–4 says
the exemplar carries the body plan and the model fumbles the details
— which points at the next affordable lever being a **heavier
exemplar prior** (larger library, closer body-plan match — when the
target noun IS the exemplar's noun the model mostly adapts rather
than invents), possibly plus Opus-instead-of-Sonnet for the emitting
call (~$0.016/term two-call, drawing quality between Sonnet and
Fable — untested with retry).

**Probe5 executed (2026-07-04): library-as-exemplar at Sonnet, full
production loop.** Full-resolution 16×16 exemplars taken from Fable's
own validated probe2 outputs (`scripts/make-probe5-prompts.ts` reads
meta.masks; prompt builder now sizes the worked example from the
exemplar), targets = neighboring nouns in the same body plan:
penguin/duck (bird exemplar), shark (fish exemplar). Runtime shape
exercised end to end: single-shot draw → deterministic mechanical
retry (`retry-feedback.ts`) → render → Haiku blind-name → if miss,
Haiku shape-advice → one shape retry → re-blind-name. Run dir
`runs/probe5-16char-sonnet/` (responses-call1/, responses-call2/,
feedback/ incl. *-shape.txt, final responses/).

Probe5 findings:

- **Mechanical retry is now 5/5 across probe4+5** (all call-1s broken,
  all fixed in one round-trip; the redesigns after shape feedback also
  stayed validator-clean, 3/3). Machinery is solid.
- **Full-res exemplars did not rescue Sonnet's drawing.** Blind reads
  after mechanical retry: duck→"deer", penguin→"duck",
  shark→"elephant". After the shape retry: penguin→"penguin" (HIT),
  duck→"turtle" (miss), shark→"llama" (miss). Net: 1/3 through the
  full ~4-call loop (~$0.02/term hypothetical).
- **Diagnosed pattern:** Sonnet emits near-rectangular top-view
  footprints (full-width slabs), and front-profile advice can't fix a
  footprint problem — the duck's advised "flat bill" became a
  staircase on a slab. A deterministic footprint check (top-mask fill
  ratio vs its bounding box → "narrow the top view to an oval")
  belongs in retry-feedback if the LLM route continues; the current
  vision-advice loop never noticed it.

**Icon-downsample experiment (icon1, 2026-07-04, $0, no model
calls).** `scripts/icon-lift.ts`: Font Awesome solid SVG → 480px
raster → ink-bbox-fit 16×16 front mask (coverage ≥0.35) → grounded →
deterministic depth-4 extrusion side/top → strict lift (0 loss by
construction). `runs/icon1-16char-fa/` (6 icons, masks/*.txt for 2D
eyeballing, sources/*.svg CC BY 4.0).

Icon1 findings (Fable eyeball): **the strongest per-dollar results in
the project.** fish (forked tail, open mouth, eye hole), mug (handle
hole + saucer), crow — instantly recognizable, at or above Fable's
drawn quality; dog and horse read as proper quadrupeds; chair medium
(FA's slatted back gets busy). Professionally drawn 2D silhouettes
survive 16×16 downsampling + thin extrusion easily. **The binding
constraint (2D silhouette quality) can be SOURCED, not generated.**

Where this leaves the architecture: front-silhouette acquisition is
the whole game, and there's now a quality ladder per noun — (1) icon
set lookup (free, excellent), (2) text-to-2D image model → same
downsample pipeline (cheap, untested, needs an image API; style
keywords like "flat solid silhouette icon, side view" go here —
Mike's earlier text-to-3D tests improved with exactly this kind of
prompt styling), (3) LLM-drawn masks (works clean only at Fable
tier; Sonnet ~1/3 even with library exemplar + full retry loop).
Depth/side/top is deterministic extrusion either way. Offline
library seeding from icon sets + Fable-quality generations stays the
economic core; per-request LLM drawing is the fallback of last
resort, not the engine.

**Mike's decisions (2026-07-04):** laddered approach approved. Image
model dependency OK (wants the cheapest option that can do flat
silhouettes — no photorealism needed). Icon-set licensing (CC BY 4.0
attribution) fine. Fable-on-subscription seeding during R&D fine;
possible paid brute-force seeding later needs a token-spend estimate
first. Standing constraint: Fable is assumed unaffordable per-request
in production — the runtime path must never depend on it.

**Depth is NOT meant to stay flat extrusion (Mike, 2026-07-04).** The
icon1 depth-4 slab extrusion is a near-term compromise, not the goal:
the project's bar is the "3D-native" character of real isometric
sprites (Fable's probe outputs show it — the bird's side view shapes
head 4-deep / body 6-deep / legs 2-deep; probe1's mug is a cylinder,
not an extruded rectangle). The open design question for sourced-front
routes is who authors the side/top masks: (a) deterministic
"inflation" (depth profile derived from front-mask local widths —
rounded, not flat, still $0), (b) a cheap LLM drawing side/top
CONDITIONED on the sourced front mask (a far easier task than
designing from scratch — untested), (c) Fable-tier full three-view
design for library seeds.

**Depth-ladder comparison executed (2026-07-04, $0).** Three depth
treatments over the same FA-sourced fronts:

- `runs/icon2-16char-inflate` — deterministic per-row inflation
  (`icon-lift.ts --depth=inflate`: d(r)=clamp(2·round(3·w(r)/16),2,6),
  side = centered run, top = per-column union of row runs; masks/*.txt
  now dumps all three views). All 6 icons, zero loss by construction.
- `runs/icon3-16char-sonnetdepth` — Sonnet draws side/top conditioned
  on the verbatim front (fish + dog), single-shot + deterministic
  retry. Both call-1s broken (dog drew a second profile as its side
  view — a new failure mode), both clean after one retry. Pipeline
  learning: retry-feedback's enclosed-hole check must EXEMPT sourced
  fronts (the fish's eye hole is intentional) — needs a trust-front
  mode before this becomes a real stage.

Verdict (Fable eyeball):

- **Inflation is the winner on animals.** The inflated dog is a real
  isometric sprite — 2-deep legs, fat body, stepped ears — clearly
  better than flat and at least as good as Sonnet's version, for $0
  and no failure modes. Inflated fish stays thin (mean 4.8) and keeps
  its features.
- **Sonnet depth-drawing is capable but unreliable and dominated:**
  its dog matched inflation (shaped cross-section like Fable's bird);
  its fish over-inflated to 10 deep, and the lens top mask carved the
  front's features into terraced rings — worse than flat. 2 calls for
  results no better than the free heuristic.
- **Width-proportional inflation is the wrong prior for man-made
  objects:** the mug/chair want round-in-top-view or flat treatment,
  not row-width depth (saucer became a 6-deep slab). A small
  per-category depth-profile table (animal-profile / round-object /
  flat-object) is the likely fix; flat remains an acceptable floor.

Depth question settled for Phase 2: **deterministic inflation with a
per-category profile table**, no model in the depth path. Fable-tier
three-view design remains the ceiling for seeded library entries.

**Phase 2 build steps 1–3 executed (2026-07-04, $0, subscription
subagents only).**

- `scripts/retry-feedback.ts` gained the planned checks:
  `--trust-front=<path>` (accepts a plain mask file or the masks/*.txt
  multi-view format; cell-for-cell verbatim comparison with the
  expected mask embedded in the feedback on mismatch; enclosed-hole
  check exempted for the front view only), `--max-depth=N` (side-mask
  depth extent > N → "redraw as a depth cross-section, not a second
  profile" — catches the icon3 dog failure), and an always-on top-slab
  advisory (top bbox fill ≥ 0.9, width ≥ 12, height ≥ 5 — the probe5
  footprint diagnosis). Verified byte-identical output on probe4/5
  call-1 responses when flags are absent.
- Icon-lift core refactored into `scripts/lib/silhouette.ts` (icon-lift
  is now a thin CLI; regeneration of icon1/icon2 verified
  byte-identical). Four depth profiles: `flat(d)` (parametrized
  extrusion), `inflate` (unchanged), `round(maxDepth)` (revolve
  approximation — per-column chord depth from a circle fit to the
  column extent, plus a reproject-repair pass that keeps the strict
  lift at zero loss), `prone(h)` (icon mask reinterpreted as the TOP
  view, h-row height on the ground — for top-view icons like spider).
- `scripts/seed-library.ts`: noun-keyed offline pipeline over the
  30-noun benchmark with a hardcoded noun → FA icon → profile table.
  `@fortawesome/fontawesome-free` added as devDep (FA 7.3.0 — note the
  hand-downloaded icon1 sources were 6.7.2, so crow/fish masks differ
  from icon2 by a couple of cells; cosmetic). Run:
  `runs/seed1-16char-fa/` — **18/30 nouns seeded**, zero loss
  everywhere, no threshold fallbacks. 12 misses in `misses.json`
  (table, sword, lighthouse, ladder, fox, flower, duck, mushroom,
  snail, penguin, octopus, palm tree) = the text-to-2D rung backlog.

**Seed1 verdict (Fable eyeball, contact sheet).** The per-category
profile idea is validated except for `round`:

- **Wins:** sailboat flat(2) (thin hull + triangular sails — instant),
  house flat(8) (door + roof — instant), car-side flat(6) (window
  holes read), spider prone(3) (radiating legs from above — instant,
  best organic in the project), robot flat(6), chair flat(4); bird /
  horse / cat / frog inflate at icon2 quality. Roughly 6 hits + 5
  close of 18 by eyeball.
- **round(10) failed on all five of its nouns** (mug, hat, tree,
  ice cream cone, rocket ship): the chord-quantized depth rings render
  as concentric staircase ledges and the maxDepth-10 mass reads as a
  stepped block — every one degraded vs its icon1 flat(4) counterpart
  (mug lost its "handle hole + saucer" read). Diagnosis: too many
  distinct depth levels (2,4,6,8,10) stacked over an already-stepped
  front silhouette; monotone iso shading turns each level change into
  a "stair". Likely fixes, untested: quantize round to at most two
  depth levels (e.g. {4,8} or {2,6}) and/or cap maxDepth at 6; flat(4)
  remains the acceptable floor for these nouns.
- The previous session's "depth question settled: inflation +
  per-category table" stands for animals/flat/prone; **round-object
  treatment is reopened** until the two-level variant is tried.

**QA-gate calibration (2026-07-04): one-shot LLM blind-naming of the
neutral monotone renders is not a usable library QA gate below
Fable tier.** Full 2×2 (model × task format) over the same 18 seed1
PNGs, plus a known-good control:

- Haiku free-naming: 0/18 (named the whole run
  stairs/castle/fortress — `scores.json`, kept canonical for
  comparability with sweep1's protocol).
- Sonnet free-naming: 3/18 (car, horse, house) but sailboat→"arrow",
  spider→"snowflake".
- Haiku multiple-choice over the 30-noun list: degenerate ("house"
  ×10; called the actual house "ladder").
- Sonnet multiple-choice: 2/18 with five false-positive "house"
  answers — format change doesn't rescue it.
- **Control:** Haiku free-naming on icon2-16char-inflate (the
  project's best-eyeballed run) scores 0.25 (dog→"llama",
  mug→"throne") — the instrument *inverts* the quality ordering, so
  low blind scores on icon-sourced runs are uninformative.
  All passes in `runs/seed1-16char-fa/scores-calibration.json`.
- Implication: the production QA gate needs render-side work
  (color/shading variant, ground shadow, maybe multiple angles or
  larger tiles) before any cheap-model naming pass means anything;
  format tweaks alone don't help. Fable-tier eyeball remains the
  working gate for R&D-time seeding.

**Text-to-2D rung scoped (2026-07-04, research only, no spend).**
Current API pricing for flat-silhouette generation, verified against
live pricing pages: FLUX.1 schnell is the clear first test —
$0.0027/image (Together AI, per-MP) or flat $0.003 (Replicate,
$3/1,000; fal.ai identical) — 6–30× cheaper than non-Flux options,
and its fine-detail weaknesses don't survive the 16×16 downsample.
Runner-up: gpt-image-1-mini at low quality ≈ $0.005/image
(token-priced; verify with one real call before batching) with native
transparent-background output. Wildcard: Recraft V4.1 Vector at
$0.08/image emits true SVG with icon/vector style presets — feeds the
existing SVG rasterizer directly; only worth it if schnell rasters
threshold poorly. Skip Imagen 4 Fast ($0.02 — deprecated, shuts down
2026-08-17). Cost picture for the 12-noun backlog at ~4 candidates
per noun: **≈ $0.15 total at schnell prices.** Standing rule: no
image-API spend without per-run sign-off.

**Round-depth A/B executed (2026-07-05, $0): round is retired.**
`round2(lo,hi)` two-level variant added to `scripts/lib/silhouette.ts`
(each column's chord snaps to whichever of lo/hi is closer);
`seed-library.ts` gained `--out` / `--round2=lo,hi` / `--only=round` /
`--date` flags. A/B runs over the five round nouns:
`runs/seed2-16char-fa-round26` (levels 2,6) and
`runs/seed2-16char-fa-round48` (levels 4,8), vs seed1's round(10).

Verdict (Fable eyeball): two-level quantization reduces ledge count
(tree/ice-cream drop from four terraces to one) but rescues nothing —
all five still read as stepped blocks. round2(4,8) is nearly
indistinguishable from round(10): these silhouettes are wide, so most
chords quantize to hi anyway. **Re-diagnosis: the failure was never
the number of depth levels — it's total depth on grid-filling
silhouettes.** Anything ≥6 deep turns a 16-wide silhouette into a
building, and punch-through features die (the mug's handle hole
becomes a shallow niche once the body is deeper than ~4). The
seed1-era hypothesis "quantize to two levels" is falsified; `round` /
`round2` stay in the code as evidence but are out of the profile
table.

**seed3-16char-fa (2026-07-05) is the new canonical library run.**
SEED_TABLE flips the five former round nouns to flat(4); 18/30
seeded, same 12 misses, zero loss. flat(4) confirmed as the right
treatment where the front silhouette is sound: mug fully recovers
(handle hole + saucer read — best of the four treatments tried). But
the A/B also isolates a second, separate failure mode: **tree, ice
cream cone, and rocket ship fail at the front-silhouette level, not
the depth level** — the FA glyph doesn't survive 16×16 downsampling
as a legible side-view silhouette (tree/ice-cream tiers render as
staircases at ANY depth; FA's rocket is drawn diagonally). Hat is
marginal. Open question for Mike: demote those 3–4 to misses, which
would put them on the text-to-2D rung backlog (12 → 15–16 nouns) and
shrink the icon-seeded set to 14–15 solid entries.

**Rung-2 pipeline built (2026-07-05, $0 so far — no API calls yet).**
Mike approved the FLUX.1 schnell pilot and deferred the QA-gate
render experiment (non-crucial; he still wants a higher floor/ceiling
for monotone rendering, which better fronts address directly).
`scripts/gen-silhouettes.ts`: Together AI (preferred,
~$0.0007/img at 512²) or Replicate ($0.003/img) auto-selected from
`TOGETHER_API_KEY` / `REPLICATE_API_TOKEN` (env or project-root
`.env`, now gitignored); 16-noun prompt table = 12 icon misses + 4
weak-icon retries (hat, tree, ice cream cone, rocket ship — prompts
target the FA-glyph failures: single canopy, one scoop, upright
rocket); 4 candidates/noun at seeds 1–4; downsample via new
`isInkDark` luminance predicate + `pixelsToFrontMask` (silhouette.ts
refactor, byte-identical for the SVG path); writes raw/, masks/,
previews/ (mask upscaled to 512²), gen.json. `--dry-run` verified:
64 images, ~$0.045 Together / ~$0.19 Replicate.

**Rung-2 pilot executed (2026-07-05, ~$0.19, Replicate, Mike-approved).**
64/64 images (16 nouns × 4 seeds) in `runs/gen1-16char-flux/`. Ops
learning: low-credit Replicate accounts throttle at 60
predictions/min (burst 5), which a concurrency-4 pool trips —
`gen-silhouettes.ts` gained 429 retry-with-backoff and a
`--skip-existing` resume flag (429s are free; the resume pass only
paid for the 36 missing images).

Pilot verdict (Fable eyeball of all 64 downsampled masks): **the
text-to-2D rung works — 13/16 nouns produced usable-to-strong
fronts on the first batch.** The systematic failure mode is
features thinner than one grid cell: ladder rungs and the flower
stem fragment into disconnected pieces; ice cream cone never got a
cone taper (all four candidates read as popsicles). Confirmation of
the mug lesson: punch-through holes are load-bearing for reads and
survive at flat(4) — the snail's shell spiral and the rocket's
window both read in iso.

**seed4-16char-mixed (2026-07-05) is the new canonical library run:
28/30 seeded** (misses: ladder, flower). `seed-library.ts` extended
with `png` sources (gen1 raw PNGs → `isInkDark` luminance downsample)
alongside `fa`; the table holds the Fable-picked winner + profile per
noun. Iso-render eyeball of the 13 gen-sourced nouns: strong — table
(best object in the project), fox, duck, sword, rocket ship, tree,
penguin, snail; decent — octopus, palm tree, lighthouse; marginal —
hat, mushroom (mushroom-c2's tiered cap extruded to stairs under
both inflate and flat; the rounder c4 at flat(4) was the best of
the three treatments tried). Monotone-ceiling learning, echoing the
round-depth verdict: front-edge smoothness matters more than depth
profile — tiered front edges (tree canopy, mushroom cap) always
extrude to staircase ledges.

**Rung-2b three-view sheet probe built (2026-07-06, $0 — no API
calls).** Mike's verdict on the gen-sourced iso renders: they read as
"flat icons extruded — a 2D thing that's just fatter," not 3D-native.
Diagnosis: the flatness is authored by the depth profiles (flat/inflate
sweep a constant-or-width-proportional cross-section straight back),
not by the schnell prompt — so the fix is sourcing real cross-sections,
not prompt styling. Separate per-view schnell prompts were rejected
before spending: two independent draws have no identity anchor (icon
training data makes "fox, front view" a head-only icon while the side
view is a full body — row-mapped depth from mismatched body plans is
garbage). Instead, Mike's single-image idea: one "orthographic model
sheet" prompt (FRONT / SIDE / TOP left-to-right), split into thirds,
each third downsampled 16×16, and lifted with the existing strict
visual hull — `liftHull` IS the 3-view AND-intersection, and
`alignBboxes` (built for the LLM-mask path) handles cross-view extent
reconciliation.

`scripts/gen-sheets.ts` (Sonnet-built, Fable-reviewed): 4 probe nouns
(duck, fox, mug, rocket ship; per-noun `displayThird` maps the
profile view to the pipeline front mask, the other of front/side
becomes the depth cross-section), 2 prompt phrasings A/B ("model
sheet" convention vs geometric description), 4 seeds → 32 sheets at
1344×576 (Together) / 21:9 (Replicate). Deterministic post-processing
per sheet: exact-thirds split; compliance checks recorded in gen.json
(gutter-band ink, per-third connected components, bbox aspect);
8-way flip orientation search minimizing summed reprojection loss
(recorded flips are best-fit compensation for the sheet's unknowable
view orientation, not semantically meaningful); front-protecting
repair pass (front mask is ground truth — zero front reprojection
loss asserted, side/top reprojected from the final voxel set); three
renders per candidate for eyeball A/B — `-hull3` (repaired 3-view
hull), `-hull2` (front ∩ cross-section only, top unconstrained),
`-flat4` (baseline). `--selftest` runs the whole path offline on an
adversarially inconsistent synthetic sheet (annulus hole in the top
view forces the repair path, x-asymmetric flange forces a non-default
flip; asserts nonzero pre-repair loss, nonzero repairs, zero
post-repair front loss). `--dry-run` verified: 32 images, ~$0.096
Replicate / ~$0.067 Together. Type-check clean.

Known limits going in: intersection only carves, never adds — the
thin-feature fragmentation mode (ladder rungs, flower stems) gets two
extra chances to trigger, which is what the repair pass and the hull2
fallback are for; top-view compliance is expected weakest (top-down
animals are rare in icon data); real-sheet layout compliance (three
views, right order, clean gutters) is THE probe question and is
untested until a paid run — the selftest only proves the machinery.

**Rung-2b sheet probe executed (2026-07-06, ~$0.10, Replicate,
Mike-approved).** 32/32 sheets generated into
`runs/gen2-16char-sheets/`; 27 processed, 5 failed on an empty third.
Findings (Fable eyeball of raw sheets + renders + gen.json stats):

- **The weak link is view diversity, not layout.** Sheets reliably
  contain 2–3 clean silhouettes of the SAME subject (identity drift —
  the reason separate per-view prompts were rejected — did not occur
  even once). But the TOP slot never contained a top-down view (best
  case a crouching duck, usually a third profile or a tilted copy),
  and true head-on views appeared only for duck and rocket; fox and
  mug sheets were 2–3 profiles in different poses. Empty-third
  failures concentrated in mug (4 of 8 — it drew two big mugs and
  stopped). Prompt variants a/b performed similarly. The gutter flag
  fired 21/27, mostly subjects straddling the third boundaries.
- **hull3 (strict 3-view AND) is dead on arrival** — intersecting
  with the garbage top slot carves slots and terraces, and
  alignBboxes's z pair stretched the cross-section's depth to that
  view's extent (duck body 13 of 16 deep → pancake). Fixed in-script:
  hull2 is now computed decoupled from the top third (empty top mask →
  alignBboxes skips the x/z pairs).
- **Cross-view consistency of the two good views is excellent:**
  pre-repair front reprojection loss mostly < 0.09, repair restored
  ≤ 10 cells except on the two worst fox sheets. The single-context
  sheet fully solved the consistency problem it was designed for.
- **Depth needs a cap, not aspect correction.** The aspect-true
  rescale (hull2ZScale in gen.json) measured ≈ 1.00 nearly
  everywhere — the fat depth is what schnell drew, not a
  normalization artifact. Capping the cross-section's total z extent
  at 6 (the seed2 round-depth threshold; `-hull2cap6.png` renders,
  DEPTH_CAP in gen-sheets.ts): duck lands at rough parity with
  seed4's inflate; **fox is the standout — four legs separated in
  BOTH x and z with arched openings under the body, a volume no
  deterministic profile (flat/inflate/round) can produce** — and it
  came from a "wrong" sheet of two fox profiles, whose intersection
  is still plausible animal volume; mug is crushed (worse than
  flat(4) — round objects stay icon-sourced + flat).
- Net: the sheet route's viable product is **front ∩ depth-capped
  cross-section (hull2cap6)**, its value concentrated in
  organic/quadruped nouns. Any scale-up should drop the top slot and
  hull3 entirely; a 2-view sheet prompt (front + side only) would
  also likely cut the empty-third failures.

**Mike eyeball verdict on gen2 (2026-07-06): sheet route RETIRED.**
"None of the foxes look good, including in the gen2-16char-sheets
round." This overrides the earlier Fable call that the cap6 fox was a
standout — that call over-weighted structural novelty (z-separated
legs, which no deterministic profile can produce) and under-weighted
the actual bar, instant recognizability: the cap6 fox reads as a
generic chunky quadruped (elephant/table), having traded away the
profile legibility that made seed4's fox at least nameable. Full
rung-2b ledger (~$0.30 total spend): best case (duck) = parity with
$0 inflate; round objects = worse than flat(4); animals = legibility
loss. **Do not scale the sheet route.** Standing conclusion: sourcing
better FRONTS from schnell works (gen1 → seed4); sourcing DEPTH from
schnell does not beat the free heuristics at 16³.

Sharper restatement of the open problem: Mike's fox verdict covers
seed4's inflate fox too — even the best-treatment sprites still read
as "a flat icon, just fatter" (the complaint that started rung-2b).
With depth shaping now measured as topping out at parity, the
extruded-icon feel is substantially a PRESENTATION problem: the
monotone renderer's three near-identical face grays turn every depth
step into a terrace, nothing grounds the object (no contact shadow),
and there's no silhouette edge. This is also exactly the deferred
QA-gate legibility-floor work.

**Render-side shading experiment built (2026-07-06, $0, no model
calls).** `renderIsoSVG` gained `mode: 'shaded'`
(`src/bench/isoRender.ts`): (1) wider face-luminance separation on a
slightly warm gray (top #f2f2ec / left #9c9c92 / right #5a5a52 vs the
neutral 233/179/125), (2) per-voxel depth falloff along the (1,1,1)
view axis (nearest full brightness → farthest ×0.78) so stepped
surfaces pick up a tonal gradient and read as shaded volume instead
of repeated plateaus, (3) two-tone ground contact shadow at the y=0
plane (core footprint + 4-neighbor-dilated halo) drawn beneath the
object. Silhouette outline deliberately deferred: with painter's
occlusion, naive boundary-edge strokes draw false lines over covering
faces. The default neutral mode is byte-stable (asserted by test) so
past scoring PNGs stay comparable; viewer has a "shaded (experiment)"
toggle next to blind/color/masks. 30 tests passing. First Fable
eyeball of seed4 shaded vs neutral: grounding + volume clearly
improved — objects sit on a floor instead of floating, terraced tails
and caps read as gradients.

**Mike eyeball verdict on shading (2026-07-06): no help.** "The
shaded fox looks bad. The shading doesn't help with any of the nouns.
No improved rendering, including color, can help the poor voxel
geometry." The presentation hypothesis is falsified — the shaded mode
stays in the code as a viewer toggle, but render-side work is OFF the
table as a quality lever. Geometry quality below a legibility floor
cannot be presented into goodness. (Process note, recorded so it
isn't repeated: the shading bet was proposed as "the remaining lever"
instead of as a vetoable hypothesis; Mike flagged he would have
stopped it had the framing been clearer.)

**Mike observation (2026-07-06), reframing the tier picture:** aside
from Fable rounds (mostly good enough), the SONNET rounds look okay —
better than every other non-Fable round: icon3-16char-sonnetdepth,
probe1-16char-sonnet[-bbox], probe4-16char-sonnet,
probe5-16char-sonnet. Synthesis against the recorded evidence:

- What those five rounds share, and nothing else in the project has:
  **the side/top masks were DESIGNED by a model**, not derived
  mechanically from a 2D source. Model-designed volume varies depth
  semantically (probe1's mug is a cylinder; Fable's bird is head-4 /
  body-6 / legs-2). Every icon/FLUX round extrudes or inflates — the
  "flat icon, fatter" signature.
- The recorded negative verdicts on Sonnet conflated three things
  Mike's eyeball now separates: (1) mechanical reliability — solved,
  5/5, by the deterministic retry at ~2× tokens; (2) recognizability
  as scored by Haiku blind-naming — an instrument the 2026-07-04
  QA-gate calibration later showed INVERTS quality ordering, so
  probe5's "1/3" likely underrated those outputs; (3) shape-design
  quality per Fable A/B on n=2 (icon3) — small-sample, and now
  effectively overridden by Mike's cross-run eyeball.
- Two-axis decomposition of the whole problem: front-silhouette
  legibility (icons/FLUX excellent + ~free; Sonnet weaker) vs volume
  character (heuristics flat; model-designed 3D-native). seed4
  optimized the first axis and defaulted the second — which is
  exactly Mike's complaint. Rung-2b tried to source the second axis
  from an image model and failed. The untested combination is
  **sourced front + Sonnet-designed side/top conditioned on it** —
  icon3's route, retired after n=2, BEFORE the tooling built for it
  existed (retry-feedback's --trust-front, --max-depth, and top-slab
  advisory were added later and directly target icon3's and probe5's
  observed failure modes: second-profile side views, slab
  footprints).
- Economics: probe token counts (~520–670 in / ~220 out per call)
  put a Sonnet 2-call conditioned-depth term at roughly $0.01 at list
  prices — inside the $0.01–0.02 production target. Library seeding
  via subscription subagents stays $0 actual.

**Next action:** candidate probe, pending Mike's sign-off on the
framing (hypothesis: model-designed depth over sourced fronts is the
missing quality axis; $0 actual, subscription subagents): re-run the
icon3 route over ~6 seed4 canonical fronts spanning body plans (fox,
duck, cat + mug, rocket, table), Sonnet draws side/top conditioned on
the verbatim front through retry-feedback with --trust-front and
--max-depth, strict lift, render into a run dir for eyeball A/B
against seed4's inflate/flat treatments. Verdict instrument: Mike's
eyeball only (blind-naming is calibrated-broken). Secondary open
axis, untested and unpriced: grid resolution (everything so far is
16³; the benchmark plan always contemplated 32³, where fronts survive
downsampling with far more feature detail). Earlier candidates stay
live: flower/ladder retry batch; declare seeding done at 28/30.
