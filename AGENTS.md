# blawx2

Read `PLAN.md` for the project plan.

## Stack

Vite + React + TypeScript strict (incl. `noUnusedLocals`,
`noUnusedParameters`). Tailwind is fine. No UI kits, no charting
libraries. Near-zero dependencies.

## Substrate to reuse from the sibling repo

The prior prototype at `../blawx/` is not authoritative for the new
generation pipeline, but two of its pieces are directly reusable:

- **Iso projection math** — `../blawx/src/render/iso.ts`. True 30° iso,
  `x' = (x - z) · cos30° · 22`, `y' = (x + z) · sin30° · 22 - y · 22`.
  The neutral eval renderer in Phase 1a should share these constants so
  eval and LEGO views are geometrically aligned.
- **KV cache + Worker route + rate limit** — `../blawx.proj/api/`. Key
  `g:<slug>`, infinite TTL; `slug.ts` normalization; 5 fresh/hr/IP.
  `ANTHROPIC_API_KEY` already wired as a Wrangler secret. Phase 2 onward
  can plug into this rather than rebuild it.

The prior LEGO renderer is locked to 8³ with a 7-color indexed palette
(`../blawx/src/voxel/types.ts`, `../blawx/src/render/palette.ts`). The
plan explicitly runs the benchmark at 8³/16³/32³ in the neutral eval
renderer only; the LEGO skin stays 8³ until form quality is proven.

## What NOT to reuse

The prior generation approach itself. It struggled on organic nouns and
Mike is starting fresh with the pipeline in `PLAN.md`. Don't import its
prompt, its plan structure, or its critique loop.
