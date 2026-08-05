# tier1-regen1 — approved regen round over the 13 blindpanel-flagged sets

Run 2026-08-05, per the round approved that day (4 steps at the end of the
pre-seed library thread in AGENTS.md). Ranks and proposals only — nothing
here gates, and **no library swap has been performed**: every proposed
winner below awaits Mike's eyeball against the contact-sheet viewer.

## What ran

1. **Brief amendments** (`scripts/make-tier1-regen-prompts.ts`): prompt v2
   plus three required pre-authoring declaration lines — `feature:` (the
   one exaggerated identity feature, H-CARICATURE), `pose:` (pose + 30°-iso
   rationale, H-POSE), `depth plan:` (per-region z/y extents, H-DEPTH) —
   plus a numeric top-view row convention (the b4/b5 brief addition,
   now in the prompt), and a wheels-as-proud-masses vehicle clause for
   motorcycle (H-WHEELS).
2. **Checker amendment** (`scripts/convert-response.ts`): median column
   depth (y-span per occupied (x,z) footprint column — the stat from the
   blindpanel run) now printed on every conversion, with an advisory note
   at ≥ 12. Advisory only; nothing blocks.
3. **Challengers:** 13 terms × 2 arms (`runs/tier1-regen1-16char-{a,b}`),
   one $0 Sonnet subscription subagent per term, tier1 protocol
   (single-shot + 1 deterministic retry, `retry-feedback.ts --max-depth=6`,
   convert-response self-check in-agent). **26/26 landed structurally
   clean**: comps=1, ground=true, 0 malformed rows, reprojection loss 0.00.
   Retry consumption: 7/26 (a: coffee-cup, dog, monkey, teddy-bear;
   b: coffee-cup, dolphin, motorcycle). The medDepth advisory caught two
   slabs in-agent (teddy-bear-a fixed on retry 12→11; coffee-cup-b shipped
   at 12 with its retry already spent — the round's only advisory carrier).
4. **Panel** (`runs/tier1-regen1-panel/`): 39 renders (13 incumbents + 26
   challengers), deterministic shuffle seed 777001, production iso renderer,
   2 independent blind free-naming Sonnet voters ($0). `key.json` unblinds;
   `votes.tsv` is the combined ballot.
5. **Re-score** (`runs/tier1-regen1-rescore/`): the 13 proposed winners
   re-shuffled (seed 424242) and free-named by 2 fresh voters.

## Proposed winners (pending Mike's eyeball — the only gate that counts)

Verdicts are Fable's target-aware eyeball informed by the blind votes;
wrong-consensus (both voters, same wrong object) is the strongest negative
signal; true ties keep the incumbent.

| noun | winner | medDepth inc→win | panel votes (winner) | re-score votes | note |
|---|---|---|---|---|---|
| camera | **chB** | 9→8 | train, suitcase | **camera, camera** | the round's headline: strict wrong→right, cross-voter correct consensus |
| dog | **chA** | 5→4 | horse, **dog** | horse, horse | strict hit in panel; staircase-consensus incumbent → coherent quadruped |
| motorcycle | **chB** | 8→6 | truck, car | bench, hammer | vehicle-family consensus in panel (wheels read); re-score regressed — n=2 variance |
| crown | **chB** | 6→6 | skyline ×2 | skyline ×2 | clean graduated ring of points; skyline is the expected gray read |
| coffee-cup | **chA** | 16→9 | building ×2 | stepped pedestal, building | mug-with-handle reads target-aware; tower-consensus broken. Panel's non-consensus pick was chB (a medDepth-12 monolith) — eyeball overrules, flagged for Mike |
| hamburger | **chB** | 15→9 | building ×2 | toaster, robot | layers finally visible as ledges; squat proportions |
| teddy-bear | **chA** | 11→11 | robot ×2 | robot ×2 | head+ears distinct from body; still robot-consensus |
| monkey | **chB** | 10→8 | robot ×2 | robot ×2 | bipedal + tail; chA rejected (teapot/pitcher wrong-consensus, class E) |
| banana | **chA** | 4→7 | fish, crystal | paw, crown | breaks the staircase wrong-consensus (INC and chB both staircase ×2) |
| bee | **chA** | 7→6 | dinosaur, dog | crown, animal | insect anatomy (wing plate, stinger) vs incumbent's shell-read; weak |
| dolphin | **chB** | 7→7 | skyline, skyscraper | staircase ×2 | fin+body+tail organized vs incoherent incumbent; weak |
| shark | **chA** | 9→9 | castle ×2 | castle ×2 | dorsal fin + two-lobe tail visible target-aware; blind unmoved; weak |
| pizza | **keep incumbent** | 7 | — | fan, pyramid | both challengers repeated the upright-slice pose; all three read wedge/pyramid — tie keeps incumbent |

12 proposed replacements (2 strong, 1 good, 9 marginal-to-weak), 1 keep.

## Hypothesis verdicts (the falsifiers, honestly scored)

- **H-DEPTH — supported.** The slab stat moved where it mattered:
  coffee-cup 16→9, hamburger 15→9, and the advisory caught two more slabs
  in-agent during authoring. The tower/building slab-consensus broke on
  both headline slab terms. Teddy-bear (11→11) shows the stat's floor:
  under-12 monoliths still read blocky.
- **H-CARICATURE — mixed.** Dog: staircase/shoe → horse/horse + one strict
  "dog" (measurable, per the prediction). Monkey: blob/rock → robot ×2
  (coherent but wrong). Bee: no improvement — an insect at 16³ gray with a
  mandatory ground plane may be unwinnable without color. Species collapse
  (horse-not-dog) persists: the exaggerated-feature rule produces *a*
  quadruped, not the right one.
- **H-POSE — falsified on its main target.** Both pizza challengers
  declared a pose rationale and still chose the upright-slice glyph pose;
  all three pizzas read wedge/pyramid. The declaration line alone does not
  move pose choice — a term-specific pose directive (e.g. "lay the slice
  flat, crust ring visible") would be the next escalation. Banana (the
  other class-C member here) did improve (staircase-consensus broken).
- **H-WHEELS — partially supported.** Motorcycle went bridge/blob →
  truck/car (vehicle family, both panel voters) with wheels as proud
  masses; the fresh re-score pair said bench/hammer. Signal exists;
  2-voter variance is large.
- **H-PANEL — kept, with a measured caveat.** The panel ranked cheaply
  (~$0, minutes) and its wrong-consensus criterion drove real decisions
  (rejecting monkey-chA's teapot, banana's staircase). But
  motorcycle's panel-vs-rescore flip shows n=2 variance; treat single-pair
  wrong-consensus as a flag, not a verdict. Wrong-consensus among the 13
  proposed winners (re-score): 5 of 13 (crown→skyline, shark→castle,
  teddy-bear→robot, monkey→robot, dolphin→staircase) vs 2 of 13 among the
  original flagged incumbents — but the incumbents' scatter was
  no-gestalt-at-all, while the winners' consensus is coherent-wrong-object;
  the metric is not monotone in quality across that transition.

## Bookkeeping

- Provenance wrinkle found while auditing: 3 of 50 shipped tier1 JSONs
  (b1: airplane, coffee-cup, train) do not reproduce from their stored
  `responses/*.txt` (e.g. coffee-cup ships 582 vox / medDepth 16 but its
  response converts to 448 / medDepth 9). The shipped JSONs remain the
  incumbents of record; the response files were likely overwritten after
  conversion in the b1 session.
- Blind free-naming remains a stress ranker, not a bar: strict hits 3/104
  votes across panel + re-score (dog, camera ×2) — but that is 3 more than
  the 13 flagged incumbents managed in the original run.
- Rendering harness: `scripts/_tier1_regen_blind.ts <outDir> <seed>
  <result.json…>` (generic; reused for the re-score).
- Contact sheet for the eyeball gate: `runs/tier1-regen1-sheet.html`
  (both arms), plus the per-item PNGs in `renders/` here with `key.json`.
