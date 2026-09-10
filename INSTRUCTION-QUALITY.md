# Instruction quality

## Next construction and guide review — 2026-09-10

Status: section pacing implemented and verified; broader geometry and construction critiques remain separate.

Keep the booklet flat: one level of expandable sections, consecutive whole-number steps, opaque Pastel context, illustrated total/section inventories, and the existing vintage manual styling. Preserve the generator and the accepted raw voxel design separately from derived brick placements.

Ordinary sections should rarely contain fewer than three displayed steps. Start evaluation with a preferred range of **3–18 displayed steps per ordinary section**; eighteen is the existing presentation bound, not an external LEGO standard. Short exceptions need a coherent reason such as a separate subassembly, repeated recipe, or attachment. A join can remain an explicit numbered diagram inside a larger section; being a join does not automatically require its own section. Never erase an operation, warning, hold, join, or genuine repeat to satisfy the range.

First bounded task: rebalance short tails when splitting long chapters, then combine compatible adjacent tiny sections. Choose boundaries from assembly relationships, spatial continuity and truthful semantic ownership, not just matching display names. Preserve exact ordered diagram coverage, source-operation IDs, geometry/colors, inventory counts, repeat instances, and reader restoration by step ID. Handle an entire guide shorter than three steps without padding.

### Existing implementation

- `src/assembly-booklet-presentation.js`: `createBookletPresentation` projects the raw presentation through `createFlatBookletPresentation`. It currently keeps ordinary chapters through 18 steps and promotes the existing reading parts of longer chapters to peer sections. It imposes no minimum and does not rebalance short tails.
- `src/guide-presentation.js`: `readingParts` greedily chunks whole groups with a 12-step ceiling. Its final chunk can be short. `deriveGuidePresentation` preserves repeat recipes and labels.
- `src/semantic-local-grouping.js`: `createLocalSemanticProposal` derives natural/protected boundaries and `mergeToLimit` merges toward at most twelve semantic chapters. That chapter-count bound does not provide a displayed-step minimum or maximum.
- `src/guide-label-variation.js`: wording is downstream presentation. Labels alone must not decide assembly compatibility. Mixed subject headings must not inherit an inaccurate old label when sections merge.
- `tests/assembly-booklet-presentation.test.js`, `tests/guide-presentation.test.js`, `tests/guide-numbering.test.js`, and the semantic grouping tests cover neighboring contracts.

Evaluate the general change using saved models, including accepted Shapes 42–47 and an additional saved castle. Record short-section counts and reasons for retained exceptions, maximum section size, exact coverage/order, and inventory/repeat preservation. Inspect the ordinary 5179 product as well as pure projections: versioned local construction and semantic caches can affect which guide is shown. No fresh generation or naming call is needed to develop or verify grouping.

If the semantic grouping algorithm changes, inspect `PARALLEL_FIXED_NAMING_POLICY.groupingVersion` in `server/naming-budget.js` and grouping identity in `src/semantic-guide-client.js`. A source-range change invalidates old label evidence; do not automatically spend a naming call to refresh it during local evaluation. Rebalancing slices within the same original semantic section can retain its truthful label.

This first issue concerns section pacing. It does not establish a geometry defect or improve physical support. Broader geometry critiques should be tracked separately as source shape, packing, support/connectivity, assembly order, or instruction presentation; fixes must generalize beyond one example.

## Section pacing checkpoint — 2026-09-10

`createFlatBookletPresentation` now applies the 3–18-step preference without changing canonical construction data. Long ordinary sections still split only at existing guide-group boundaries, but a sub-three-step reading chunk is absorbed into the smallest adjacent chunk that remains at or below eighteen. Adjacent source sections combine only when at least one is short, both are unnamed ordinary sections with the same structural fallback meaning, and their assembly roles are compatible. Module continuity, graph contact, and a bounded spatial neighborhood support ordinary merges; independent finishing-detail attachments may share one finishing pass. Spatial distance breaks otherwise equal merge choices. Matching display copy by itself is insufficient.

Named semantic purposes and repeated recipes remain exact section boundaries. A merged source range drops the old per-range semantic label evidence and uses its validated generic structural label; slices inside one original semantic range retain that range's label. A join remains a numbered diagram and does not automatically force or forbid a section boundary. Remaining short sections are recorded with a reason (`complete guide`, `repeated recipe`, `named assembly purpose`, `attachment sequence`, or `distinct assembly purpose`).

The saved castle now has 14 displayed sections and 116 diagrams, with sizes `11, 11, 11, 12, 12, 13, 3, 3, 3, 6, 3, 5, 17, 6`. The former step-70 tail is now `58–70`; the four one-step sections plus the two-step tail are now `89–93`. It has zero short sections and a maximum of seventeen. Exact displayed step order, ordered source-operation IDs, joins, warnings, per-section inventories, reader restoration by step ID, all 610 bricks, and cached semantic labels were verified.

Saved Shapes 42–47 retain complete order, inventory, diagram data, and repeated-recipe instances. Shapes 42, 43, 45, and 46 have no short sections. Shape 44 retains four meaningful short structural sections around its work-surface and protected repeated recipe. Shape 47 now combines its compatible two-step finishing attachment with the preceding finishing section and retains only its distinct two-step foundation. Every ordinary displayed section is at most eighteen steps.

This is a presentation-only projection change. `PARALLEL_FIXED_NAMING_POLICY.groupingVersion` remains `1`, and `CONSTRUCTION_PIPELINE_VERSION` remains `2026-09-09.1`: semantic source ranges and cached construction outputs did not change. Verification: effective full suite 671/671 (the localhost-bind integration passes outside the sandbox), focused pacing/presentation/cache tests, saved Shapes 42–47, production build, and the ordinary cached castle on port 5179. Private measurements are in `.blawx-private/geometry-review/section-pacing-checkpoint.json`.
