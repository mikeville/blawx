# blawx2

Read `PLAN.md` for the project plan.

## Entry point

Phase 0's code-survey items (Q1 renderer contract, Q3 infrastructure)
are answered inline below — see "Substrate to reuse." Q2/Q4/Q5 are also
answered inline. **Start at Phase 1a** (benchmark harness). Stop and
report before any API calls so the spend guardrail below can be honored
per run.

## Spend guardrail (load-bearing)

Every API sweep gets a per-run cost estimate and explicit confirmation
before executing. No batch runs without sign-off. Approval for one run
does not carry to re-runs or larger variants. Target per unique term:
**$0.01–0.02**, ≤ ~10 s per cache-miss.

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
