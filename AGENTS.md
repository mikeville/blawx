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

**Next action:** run the sweep via automated subagent fan-out (72 fresh
Claude Code Haiku subagents, one per prompt), saving raw responses to
`runs/sweep1-*/responses/<noun>.txt`. Convert with
`scripts/convert-response.ts`, then blind-score. A follow-up session
aggregates the six conditions and makes the grid/encoding call.

**Why automated instead of manual pasting:** Mike doesn't have time for
72 hand-pastes. Subagent fan-out uses the Claude Code subscription (not
`ANTHROPIC_API_KEY`), so the spend guardrail is honored. The only
confound vs. a claude.ai chat is the Claude Code system prompt wrapping
the subagent — that's a constant across all 6 cells, so it shifts
absolute scores but preserves the grid×encoding ranking Phase 1b needs
to output. All six `run.json` files record `conditions.model` as the
actual Haiku 4.5 subagent model used.
