# NEXT-DIRECTION

## Reframe

Blawx is a **pipeline that converts a search term into a LEGO instruction
booklet**, not a single model that solves "term → voxel object." The
pipeline has several stages, each independently improvable:

```
term ─► [3D object generation] ─► [voxelize] ─► [LEGO grammar] ─► [step planning] ─► [render]
```

The instruction-rendering half (the last two stages, and partly the
LEGO-grammar one) is in good shape. The voxel-form half is the weak
link. Past efforts to solve it inside one LLM call hit a ceiling
(see [CLAUDE.md § What we tried](CLAUDE.md#what-we-tried-for-voxel-form-generation-and-what-we-learned)).

**The new framing**: ship the "shitty first draft" of the full pipeline
with modular stages, so the project is meaningfully complete even when
the form-generation stage is bad. Improvements land per-stage as
external models and community contributions evolve. The funny artifact —
recognizable LEGO-instruction aesthetic wrapped around voxel slop — is
itself a portfolio of how the craftwork holds up while the spatial-AI
craftwork catches up.

## What we already have

| Stage | Status |
|---|---|
| 3D object generation | LLM-only (current). Hits a strict-bar ceiling around 5/15 strong outputs. Keep as **baseline**. |
| Voxelize | Trivial (LLM emits a `VoxelGrid` directly). Reusable for any upstream representation. |
| LEGO grammar | `pack.ts` collapses 1×1s into 2×2 plates. Only two brick types — needs expansion to real LEGO inventory (2×4, 1×6, slopes, tiles). |
| Step planning | `steps.ts` paginates layer-by-layer with a brick-count cap. Works; could be smarter (sub-assemblies, anti-collision). |
| Render | `Brick.tsx` + `Scene.tsx` + `Booklet.tsx` — period-correct, isometric, hard outlines, no shading. The strong artifact. |

## What needs work, in priority order

### 1. Replace the form-generation stage with a real 3D pipeline

This is the one swing that would unblock the whole project. Options
worth a focused spike (a half-day each):

- **Trellis (Microsoft, late 2024)** — text- or image-to-3D. Outputs
  meshes. Quality has crossed a threshold that prior generations
  (Shap-E, Point-E) did not. Hugging Face demo + inference API.
- **TripoSR / Tripo3D** — fast text-to-3D, image-to-3D. Reasonable
  quality, hosted API. Tripo's free tier is enough for a panel run.
- **Shap-E (OpenAI, open weights)** — earlier but freely runnable.
  Cubic shapes are decent; organic shapes are wobbly. Useful as a
  cheap floor.
- **Cube (Common Sense Machines)** — outputs voxels natively. Skips
  the mesh→voxel step but the voxel quality varies.

The output is a mesh (or point cloud, or voxel grid). For anything
mesh-shaped, voxelizing into 8³ or 12³ is a standard rasterization
problem: sample the mesh against an axis-aligned grid; for each
occupied cell, snap to the nearest palette color. Libraries like
`binvox` and `voxelize` do this off-the-shelf.

The expected quality improvement: the upstream 3D model commits to
*protrusions* as actual geometry (ears, legs, handles, fins). Those
features survive the downsample to 8³ better than what Claude
composes from scratch, because they're geometric facts rather than
voxel placements an LLM has to assemble correctly.

**First spike**: pick one (Trellis if it's accessible; TripoSR if not).
Add a new `scripts/generate3d.ts` that takes a term, calls the API,
saves the mesh, voxelizes to a `VoxelGrid`, writes the same
`.ts` file format the gallery already reads. Generate the 15-prompt
panel. Compare side-by-side with the existing baseline in the gallery.

### 2. Expand the LEGO brick grammar

`pack.ts` currently emits 1×1s and 2×2s. Real LEGO instructions use
2×4, 1×6, 1×8, 2×3, slopes, tiles, and so on. Each brick type changes
the parts inventory and the step pagination.

Reasonable approach: define a brick catalog (footprints + heights),
greedy-pack with priority for larger pieces, fall back to smaller
when constraints fail. There's almost certainly prior art in the LEGO
MOC ("My Own Creation") community — search for "voxel to LEGO
optimization" or "LDraw conversion."

### 3. Smarter step planning

Real LEGO step sequences group sub-assemblies (build the head
separately, then attach), use callouts for parallel work, and avoid
collisions (don't place a brick where you'd need to reach through
existing structure). `steps.ts` does none of this.

This is a constraint-solving problem. The LEGO Digital Designer and
Stud.io both implement it; their algorithms may be documented.

### 4. Booklet polish

Cosmetic, deferred. Studs currently render as full cylinders (side +
top); the original spec wanted simpler outlined ellipses. The title
page composition has dead space above the hero. The duck's eye reads
more like a side-plate than an eye.

## Adjacent worlds worth borrowing from

- **LDraw** — the open-source LEGO CAD format. Used by Mecabricks,
  Stud.io, LEGO Digital Designer. The **Official Model Repository
  (OMR)** has thousands of official sets in machine-readable form.
  Worth ingesting as either a retrieval substrate ("for 'cat', find
  nearest LDraw model, recolor, voxelize") or as a corpus to learn
  from.
- **Minecraft** — voxel community has decades of "text → schematic"
  tools, voxel art tutorials, and palette-snapping algorithms.
  Schematics (`.litematic`, `.schem`) are voxel grids with metadata.
- **MagicaVoxel** — the de facto voxel art editor. Outputs `.vox`
  files. Originally scoped for blawx but deferred. Could become the
  authoring loop for hand-crafted reference models if needed.

## First move for the next session

1. Read [CLAUDE.md](CLAUDE.md) end to end. Pay attention to the "What
   we tried" section — don't re-spike anything there.
2. Pick one text-to-3D option (Trellis is my best guess as of mid-2026,
   but evaluate freshly — this space moves quickly).
3. Build the simplest possible `term → 3D → voxel → VoxelGrid` path
   that lands a new file in `src/voxel/generated/<slug>-3d.ts` or
   similar (keep them separate from the LLM baseline so the gallery
   shows both).
4. Generate the same 15-prompt panel. Eyeball against the strict bar:
   "would a stranger guess this without the label?"
5. If green: continue down the pipeline (brick grammar, then step
   planning). If not green: try a different external model. Don't go
   back to prompt engineering — the ceiling there is real.

## Final note on scoring

Whoever picks this up: apply the strict bar from the start. Generative
work has a strong pull toward marking your own homework. The trustworthy
signal is "could a non-blawx person identify each generated object
without seeing the prompt label." Score conservatively. Movement in
that strict signal is what matters; everything else is noise.
