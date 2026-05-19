# blawx

A small experiment: type a search term, get back a tiny voxel object rendered
as a LEGO-style instruction booklet. Inspired by mid-80s to mid-90s
Panter-era LEGO instructions — flat color, hard black outline, no shading,
no gradients, no logos on studs, no wordmarks. Single-page, single-step
booklets with a parts inventory and bare-numeral steps.

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
    sampleDuck.ts       # hand-authored reference duck
    pack.ts             # greedy 2×2 plate packer (deterministic top-left scan)
    steps.ts            # layer → step pagination
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
  promptSystem.ts       # the cached system prompt for the generator
  parseAsciiLayers.ts   # parser: layered-ASCII model output → VoxelGrid
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

- **Connectivity**: every voxel must be face-adjacent to at least one
  other voxel in the model. The model is a single connected piece that
  touches the ground (some voxel at y=0).

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
npm test            # unit tests (parser, packer, step splitter, iso math)
```

Two views, toggled by query string:

- `http://localhost:5195/` — booklet view (Phase 1 hand-authored duck)
- `http://localhost:5195/?gallery=1` — gallery: 3-column grid of
  finished bare-cube isometric views of every model in
  `src/voxel/generated/` (plus the reference duck). Used to validate
  generated voxel forms before they go through the booklet pipeline.

## Generation CLI

The booklet renders any `VoxelGrid`. The generator produces those grids
from a search term.

```
# one-time setup: put your API key in .env.local
echo 'ANTHROPIC_API_KEY=sk-ant-...' > .env.local

# generate a single model
npm run generate -- "mushroom"

# generate several in one batch
npm run generate -- "duck" "chair" "lighthouse" "cat"
```

Output goes to `src/voxel/generated/<slug>.ts` as a default-exported
`VoxelGrid` plus a `term` constant. The raw model output is preserved
as a trailing block comment for debugging.

Under the hood:

1. `scripts/generate.ts` loads `.env.local`, calls
   `claude-opus-4-7` with extended thinking enabled.
2. The system prompt (cached via `cache_control: ephemeral`) describes
   the 8³ grid, the palette letters, the hard rules, the output format,
   and gives the hand-authored duck as a worked example. See
   [scripts/promptSystem.ts](scripts/promptSystem.ts).
3. The model returns 8 layers (`y=0` to `y=7`) of 8×8 ASCII grids.
4. `parseAsciiLayers` (defensive — handles markdown fences,
   space-separated cells, lowercase letters, missing headers, prose
   between rows) converts the ASCII to a `VoxelGrid`.
5. The grid is written to disk and shows up in the gallery on next
   reload.

## Conventions

- Plain CSS, colocated per area (`booklet/pages.css`). No CSS-in-JS.
- TypeScript imports use explicit `.ts` / `.tsx` extensions
  (`verbatimModuleSyntax`).
- Tests live next to the file they test (`*.test.ts`) and run under
  `tsx --test`. Math and data transforms only — no DOM tests, no
  visual snapshots.
- Files stay small. The render layer is a few hundred lines total;
  keep it that way.
