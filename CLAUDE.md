# blawx

A small experiment: type a search term, get back a tiny voxel object rendered
as a LEGO-style instruction booklet. Inspired by mid-80s to mid-90s
Panter-era LEGO instructions — flat color, hard black outline, no shading,
no gradients, no logos on studs, no wordmarks. Single-page, single-step
booklets with a parts inventory and bare-numeral steps.

## Status (read this before iterating)

**The instruction-rendering half of the project is solid.** The voxel
booklet renderer, brick packer, step pagination, palette grammar, and
validation gallery are all working. The visual aesthetic reads as
period-correct LEGO instructions.

**The voxel-form-generation half hit a ceiling.** Asking Claude to design
a voxel object from a search term at 8³ resolution produces recognizable
results for cubic stacks (chair, hat, house) and fails consistently on
anything with protrusions (animals, tools with thin features, vessels
with handles). We tried four iterations of prompt design — see "What we
tried" below. The honest score on the strict bar ("would a stranger
guess this without the label?") is roughly 5/15 strong outputs.

**Next direction (see [NEXT-DIRECTION.md](NEXT-DIRECTION.md))**: reframe
the project as a pipeline where each stage can be swapped or improved
independently. Replace the LLM-only form-generation step with an
external text-to-3D model + voxelization, and keep our existing
instruction-rendering stack downstream. The current 15 generated models
stay in `src/voxel/generated/` as a baseline for future approaches to
improve over.

## Stack

- Vite 8 + React 19 + TypeScript 6, strict mode (`noUnusedLocals`,
  `noUnusedParameters`, `verbatimModuleSyntax`, `noFallthroughCasesInSwitch`).
- Plain CSS, colocated per area. No Tailwind, no UI kits, no charting
  libraries.
- Near-zero deps. Current additions to the React baseline:
  - `@anthropic-ai/sdk` (devDep) — used by the `generate` CLI only, not
    bundled with the app. Flag any further additions.
- Tests: math and data transforms only, via `tsx --test`. No tests for
  visual output.

## Layout

```
src/
  voxel/
    types.ts            # VoxelGrid, Voxel, Brick — 8³ world
    sampleDuck.ts       # hand-authored reference duck (used in prompts + gallery)
    sampleTree.ts       # hand-authored reference tree
    sampleHouse.ts      # hand-authored reference house
    pack.ts             # greedy 2×2 plate packer (deterministic top-left scan)
    steps.ts            # layer → step pagination
    projections.ts      # voxel grid → 3 orthographic silhouettes + layer ASCII
    transform.ts        # rotateGrid (90° axis swap), shiftToGround
    analyze.ts          # BFS connectivity, ground-touch, unsupported-voxel count
    generated/          # CLI output dir (one .ts file per generated model)
  render/
    iso.ts              # 30° isometric projection math + render constants
    palette.ts          # 8-color palette, desaturation, face-darken rules
    Brick.tsx           # one brick: 3 faces + (optional) studs + outline
    Scene.tsx           # back-to-front-sorted composition of bricks
  booklet/
    Booklet.tsx         # title → inventory → steps → final
    TitlePage.tsx
    InventoryPage.tsx
    StepPage.tsx
    FinalPage.tsx
    Gallery.tsx         # dev-only validation viewer at ?gallery=1
    pages.css
scripts/
  generate.ts           # CLI: term → Anthropic API → VoxelGrid → .ts file
  promptDraft.ts        # current first-pass system prompt (draft layers)
  promptRevise.ts       # current second-pass system prompt (critique + revise)
  promptPass1.ts        # earlier silhouette-planning prompt (kept for diffing)
  promptPass2.ts        # earlier silhouette-realization prompt (kept for diffing)
  promptSystem.ts       # earliest single-shot prompt (kept for diffing)
  parseAsciiLayers.ts   # parser: layered-ASCII model output → VoxelGrid
  parseSilhouettes.ts   # parser for the silhouette-pass format (unused now)
  extractRevised.ts     # splits critique:/revised: blocks in pass-2 response
```

## Voxel and brick rules

- **Grid**: 8×8×8. Integer coordinates `0..7` on every axis. Y is up,
  X is left-to-right, Z is back-to-front.
- **Palette** (7 colors + empty), encoded as single letters in the
  generator's ASCII output:

  | Letter | Color     | Typical use                                 |
  | ------ | --------- | ------------------------------------------- |
  | Y      | yellow    | warm bodies, ducks, taxis                   |
  | R      | red       | accents, beaks, hats                        |
  | B      | blue      | water, denim, sky                           |
  | G      | green     | foliage, grass, stems                       |
  | W      | white     | sails, teeth, snow                          |
  | K      | black     | eyes, tires, deep details                   |
  | L      | lightGray | stone, metal, machinery                     |
  | .      | empty     | no voxel                                    |

  Color hex values are defined in [src/render/palette.ts](src/render/palette.ts).

- **Connectivity rule**: every voxel must be face-adjacent to at least
  one other voxel in the model. The model is a single connected piece
  that touches the ground (some voxel at y=0). [analyze.ts](src/voxel/analyze.ts)
  enforces this via BFS.

- **Voxel → brick packing**: `pack.ts` runs per Y-layer, scanning in
  row-major order (z ascending, then x ascending). At each unconsumed
  voxel it checks if the three voxels at `(x+1,z)`, `(x,z+1)`,
  `(x+1,z+1)` exist, are unconsumed, and share the same color. If so,
  it emits a 2×2 plate; otherwise a 1×1. Deterministic.

- **Steps**: one layer per step, bottom-up. If a layer exceeds
  `STEP_BRICK_CAP` bricks it splits along the x-axis. Empty layers are
  skipped. Each step carries `newBricks` (this step's additions) and
  `cumulativeBricks` (everything placed before).

## Render grammar

- **Isometric projection**: true 30°, no perspective. See
  [src/render/iso.ts](src/render/iso.ts).
- **Three faces per brick**: top + left + right, all painted the same
  hue. Light colors (white, lightGray) darken ~6% on side faces only;
  saturated colors stay flat — the spec deliberately avoids gradients
  and shading.
- **Outline**: every edge stroked `#000` at `1.5` SVG user-units,
  `strokeLinejoin="miter"`, `vectorEffect="non-scaling-stroke"`.
- **Studs**: stroked ellipse + a path for the side-cylinder, both
  filled with `topFill`. Only rendered when `style='plate'`.
- **Desaturation**: previously placed bricks render at 50%
  saturation, current-step bricks render at full saturation. This
  contrast is the load-bearing signal in a step page.
- **Brick style**: `Scene` and `BrickShape` accept `style: 'plate' |
  'cube'`. `plate` is the LEGO grammar (0.4-unit-tall bricks with
  studs). `cube` is the bare-cube view used by the gallery for
  validating voxel form independent of brick details.

## Running it

```
npm install
npm run dev         # http://localhost:5195
npm test            # unit tests (parser, packer, step splitter, iso math, etc.)
```

Two views, toggled by query string:

- `http://localhost:5195/` — booklet view (hand-authored duck)
- `http://localhost:5195/?gallery=1` — gallery: 3-column grid of every
  model in `src/voxel/generated/` plus the three reference models
  (duck, tree, house). Click a tile to rotate the view 90°. Tiles
  display a connectivity badge (solid / N unsupported / broken multi-part
  or floating).

## Generation CLI

```
# one-time setup
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local

# generate one or more models
npm run generate -- "mushroom" "lighthouse"
```

Output goes to `src/voxel/generated/<slug>.ts`. The file embeds the
raw draft, critique, and revised model output as trailing block
comments for debugging.

Pipeline:

1. `scripts/generate.ts` loads `.env.local` and calls `claude-opus-4-7`.
2. **Draft pass** — system prompt is
   [promptDraft.ts](scripts/promptDraft.ts) (single-shot voxel layers
   with three worked examples: duck, tree, house, derived from the
   `sampleX.ts` reference grids via [projections.ts](src/voxel/projections.ts)).
3. Parse + auto-fix (shift to ground if floating). Compute objective
   metrics via [analyze.ts](src/voxel/analyze.ts).
4. **Revise pass** — system prompt is
   [promptRevise.ts](scripts/promptRevise.ts). User message includes
   the draft + metrics ("84 voxels, 1 component, touches ground, 17
   unsupported"). Model responds with `critique:` + `revised:` blocks.
5. Parse revised layers, validate, write the `.ts` file.

## What we tried for voxel-form generation (and what we learned)

This section is here so future sessions don't redo work that didn't
help. **Calibrate down from anything that sounds like a win** —
self-reported "improvements" in this session were sometimes generous;
the strict-bar scoring is what matters.

Four levers, in chronological order:

1. **Single-shot with one duck example.** Baseline. ~1/15 strong on
   the strict bar (chair). Most outputs are cubic blobs with thematic
   colors but no form discrimination. 8/15 unrecognizable.

2. **Two-pass: silhouettes → voxel layers.** Pass 1 produced front,
   side, and top orthographic projections; pass 2 realized them as
   voxels. Marginal improvement (~2/15). Failure mode: pass 2 over-fills
   interiors to satisfy three independent 2D projections, producing
   denser blobs than pass 1's silhouettes suggested. Also, pass 1's
   three views are often mutually inconsistent (different shapes from
   each angle). Files: [promptPass1.ts](scripts/promptPass1.ts),
   [promptPass2.ts](scripts/promptPass2.ts), [parseSilhouettes.ts](scripts/parseSilhouettes.ts),
   [projections.ts](src/voxel/projections.ts).

3. **Multi-example anchoring (3 reference grids).** Single-shot but
   with duck + tree + house as worked examples instead of just duck.
   This was the biggest real jump — broke a strong "duck-shape bias"
   we'd been inducing. ~5/15 strong on strict scoring. The 3-reference
   approach is worth keeping in any future LLM-as-designer pipeline.
   Files: [sampleTree.ts](src/voxel/sampleTree.ts),
   [sampleHouse.ts](src/voxel/sampleHouse.ts).

4. **Draft + revise (current).** Pass 1 produces a draft; pass 2 is
   shown its own draft + objective metrics and asked to self-critique
   then produce revised layers. The critiques are often surgical
   ("the head sits awkwardly with no neck connection, no ears or tail
   visible"). The revisions partially follow them. ~5/15 strong on
   strict scoring — small lift over multi-example alone. Hit the
   ceiling here. Files: [promptDraft.ts](scripts/promptDraft.ts),
   [promptRevise.ts](scripts/promptRevise.ts),
   [extractRevised.ts](scripts/extractRevised.ts).

**Failure pattern that explains all of the above**: Claude composes
cubic objects (chair, hat, house, lighthouse) reasonably well because
each is a small stack of rectangular masses. Claude fails on objects
needing **protrusions** (animal legs, mug handles, fish fins, fox
ears) because at 8³ each protrusion costs 1–3 voxels out of a
60-voxel budget and Claude doesn't have a strong prior for how to
spend that budget. This is a resolution ceiling on a non-spatial
reasoner. More prompt engineering will not break it. Adding more
self-critique iterations probably wouldn't help either — Claude
correctly identifies missing features in its critiques but doesn't
have the spatial vocabulary to add them back convincingly.

**Honest takeaway**: the LLM-only path is exhausted for now. See
[NEXT-DIRECTION.md](NEXT-DIRECTION.md).

## Conventions

- Plain CSS, colocated per area (`booklet/pages.css`). No CSS-in-JS.
- TypeScript imports use explicit `.ts` / `.tsx` extensions
  (`verbatimModuleSyntax`).
- Tests live next to the file they test (`*.test.ts`) and run under
  `tsx --test`. Math and data transforms only — no DOM tests, no
  visual snapshots.
- Files stay small. The render layer is a few hundred lines total;
  keep it that way.
