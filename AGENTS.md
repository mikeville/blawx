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

**Next action:** the model-tier probe — same 16-char prompts hardened
("solid filled silhouette, not an outline"; animal-shaped filled
worked example instead of the sphere; emit a shared bounding box
before the three views), ~6 nouns (fox, bird, mug, chair, fish,
rocket ship) through a Sonnet/Fable-class session, subscription-only,
then relift + eyeball. If strong-model masks are recognizable in 2D,
the architecture stands and model tier is the lever; if not, pull
Phase 4 (exemplar few-shot) forward. Optional cheap add-on while
there: span-fill (per-row/column first-to-last fill) as a
gap-tolerant alternative to flood fill for outline masks.
