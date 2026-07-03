# blawx — voxel form generation engine (decoupled from LEGO skin)

## Context

blawx turns a typed noun into a tiny voxel object rendered as a LEGO-style
instruction booklet. Rendering is solved; arbitrary-noun → good voxel *form*
is not — structural nouns work, organic nouns (fox, bird, flower) don't.
Deployment is a public toy linked from Twitter/X: cost and latency per term
must survive a public link (~$0.01/unique term, seconds not minutes).

The core product is a **semantic voxel model** — occupancy plus semantic
color roles plus optional part labels. LEGO booklet rendering is one
downstream skin; Minecraft or other skins can come later. Evaluation runs
on a neutral iso render so form quality isn't confounded by skin, and the
primary scoring metric is **monotone** (silhouette + depth articulation
only). Color rules come after form is proven.

The isometric-sprite / MagicaVoxel ecosystem is a resource — not as
runtime retrieval (best corpora legally encumbered, open ones fragmented)
and not via 2D→3D reverse projection (unsolved), but as a curated
few-shot **exemplar library** sourced from CC0/CC-BY `.vox` models.
Concrete sources for Phase 4: Sketchfab `#voxel` / `#magicavoxel` tags
(native `.vox`, searchable by noun, CC-BY), `enkisoftware/voxel-models`
on GitHub (CC-BY 4.0, hand-authored by pro voxel artists), and
hand-authoring in MagicaVoxel to fill body-plan gaps. Per
`notes/research-voxel-sources/Isometric Sprite Ecosystem Topology.md`.

## Core framing (working hypotheses — plausible lenses, not verified facts;
## the Phase 1 benchmark is what tests them)

- At 8³–16³ this is **icon design, not 3D modeling**. Recognition =
  projected silhouette at the render camera + color signature + one or two
  exaggerated distinguishing features (caricature, not fidelity).
- Organic nouns fail because they need the caricature transform: canonical
  pose, feature exaggeration, palette-as-identity.
- 30° iso shows three faces → depth articulation is visible product
  surface; coin-extrusion outputs are a visible failure mode.
- Zipf economics: cache every result permanently per normalized term;
  spend budget on cache misses; precompute the head.

## Architecture (target)

```
noun → normalize/cache lookup
     → [miss] concept resolution + design plan     (1 LLM call, structured output:
         pose, grid size, palette roles, 3 orthographic masks, part hints)
     → deterministic lift: 3-view visual-hull intersection
         + bilateral symmetry enforcement
         + repairs (floating voxels, ground contact, connectivity,
           depth-variance / anti-coin check)
     → neutral iso render → blind-name vision critic (cache-miss only,
         1 repair iteration max)
     → semantic voxel model persisted (.vox + JSON sidecar with roles/parts)
     → skins consume the model (LEGO booklet = existing renderer)
```

Grid size and mask encoding: **experimental variables, not settled policy.**
Known for sure (arithmetic only): 16³ ≈ 1–2k output tokens, 32³ ≈ 4–8k
naively encoded — all cheap (≤ ~$0.04/term on small models), so cost does
not rule out any of these. Unverified priors to be tested by the Phase 1
benchmark: (a) LLM grid-emission reliability degrades with grid size
(row drift, cross-view inconsistency); (b) compact encodings (run-length,
polygon outlines rasterized by code) mitigate this. Benchmark runs the same
noun set at 8/16/32 and compares blind-name score vs. measured cost and
failure rate; the grid decision is made from that data.

## Phases

### Phase 0 — Onboard to the repo (gated on user permission)
Specific questions the repo must answer before implementation:
1. **Renderer input contract** — voxel format, palette handling, supported
   grid sizes, camera setup. Generation output spec must plug into it;
   neutral eval render should share its projection math.
2. **Prior failure modes** — which generation approaches were tried and
   how they failed (coherence vs. caricature). *User prefers to paste
   tactical history rather than have me excavate it — ask, don't dig.*
3. **Infrastructure inventory** — existing caching, eval tooling, model
   API wiring, serving stack, term normalization. Determines greenfield
   vs. refactor for Phases 1–3.
4. **Cost/latency data from prior attempts** — calibrate the ~$0.01/term
   assumption.
5. **Judged examples** — outputs the user marked good/bad, to calibrate
   the critic and benchmark scoring to his bar.

### Phase 1 — Benchmark harness (before touching generation)
- Fixed ~30-noun list: easy-structural (mug, chair, house), organic
  (fox, bird, fish, flower, tree), hard (octopus, dragon, "love",
  multi-word phrases).
- Neutral iso renderer for eval (decoupled from LEGO skin; small
  in-house projector sharing `iso.ts`'s projection constants). Primary
  render is **monotone** so form quality isn't confounded by palette; a
  flat-color variant is available for secondary comparison but doesn't
  feed the score.
- Auto contact sheet per pipeline version + blind-name scoring via cheap
  vision model ("what is this?" with no context) on the monotone render.
  Every generation change reruns the sheet.
- Harness logs per-term cost and latency alongside scores, so every
  quality/cost tradeoff (grid size, encoding, model tier, critic on/off)
  is decided from data rather than priors.
- First experiment on the harness: grid-size × encoding sweep (8/16/32 ×
  char-grid/run-length) on the same noun set — settles the open
  reliability question for ~a dollar of API spend.

### Phase 2 — Generation v1: single-call three-view hull
- One LLM call (Haiku/Sonnet-class) → structured plan: concept resolution
  (love→heart), canonical pose + camera-corner orientation, grid size,
  semantic palette, front/side/top pixel masks, part hints.
- Deterministic code: hull intersection, symmetry, repair passes.
- Persist as .vox + JSON sidecar. Wire into existing LEGO renderer.
- Measure on the benchmark. This is the baseline.

### Phase 3 — Critic loop (cache-miss only)
- Render actual neutral iso output → blind-name + recognizability critique
  → one revision pass with critique fed back. Budget: ≤2 total LLM calls
  + 1 vision call per unique term.

### Phase 4 — Exemplar library (first measured intervention)
- Curate ~20–50 objects across body plans (quadruped, biped, bird, fish,
  plant, vehicle, furniture, blob) from CC0/CC-BY sources: Sketchfab
  `#voxel` and `#magicavoxel` tags (native `.vox` files, searchable by
  noun), `enkisoftware/voxel-models` on GitHub (CC-BY 4.0), and
  hand-authoring in MagicaVoxel for gaps. Kenney.nl CC0 is a partial fit
  for structural/vehicle/furniture body plans only (mostly 2D sprites;
  extrusion clean only for icons and side-profiles). Hand-reduced to
  8³/16³, converted to the exact structured text format the LLM emits.
- Runtime: body-plan-matched exemplar selection injected as few-shot
  context ("fox" → wolf/cat exemplar). Static, cacheable prompt content.
- Measure delta on the benchmark, organic subset especially.

### Phase 5 — Only if organics still miss: armature DSL
- Parameterized body-plan part kits the LLM selects and adjusts;
  silhouettes become the check rather than the source. Produces part
  labels for free (future LEGO step decomposition).

### Later / out of scope now
- Cache + precompute head-of-distribution nouns before launch; 👍/👎 on
  the toy → cache becomes distillation training data.
- LEGO skin phase: brick decomposition, construction steps, 2:1 (26.565°)
  stepping if renders look jaggy at true 30°.
- Minecraft or other skins.

## Explicitly rejected (with reasons)
- Runtime sprite retrieval — best corpora (Habbo etc.) legally encumbered;
  open ones fragmented/style-inconsistent; no long-tail coverage.
- 2D→3D reverse projection — unsolved research problem per the research doc.
- Large neural 3D models (TRELLIS, Pixal3D, Shap-E-class) — aesthetic
  mismatch (flat shading read as lighting), cost/latency wrong for a
  public toy, downsampling to 8–16³ reproduces the mush problem.
- Per-request multi-step agent loops — latency.
- Fine-tuning now — no data yet; the cache will produce it.

## Spend discipline
Per the global API-spend guardrail: every harness run that hits the
Anthropic API gets a per-run cost estimate and explicit confirmation
before executing — no sweep runs without sign-off, and approval for one
run does not carry to re-runs or larger variants.

## Verification
- Phase 1 harness is itself the verification instrument: contact sheet +
  blind-name score per pipeline version, tracked across changes.
- Per-term cost and latency logged per generation; targets ≤ ~$0.01–0.02
  and ≤ ~10 s per unique (cache-miss) term.
- End-to-end: benchmark nouns render through the existing LEGO skin
  without renderer changes (format compatibility check).

## Status of open questions
1. Repo access: pending — user wants the curiosity list (now in Phase 0)
   before permitting reads. Tactical history arrives via user paste.
2. Grid policy: resolved — adaptive 8³/16³, user open to larger since
   cost is grid-size-insensitive.
