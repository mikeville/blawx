# Instruction quality

## Next construction and guide review — 2026-09-10

Status: requirements and current behavior inspected; the minimum-size rule below is not implemented.

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
