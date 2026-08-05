# tier1-blindpanel — hindsight judgment pass over the 50-set Tier-1 library

Run 2026-08-05. Ranks and flags only — per the standing decision, nothing
here gates; the eyeball verdict against the contact-sheet viewer remains
the instrument that counts. This run is input to that gate and to the
regen pass.

## Method

- All 50 sets from `runs/tier1-16char-b{1..5}` rendered through the
  production iso renderer (`renderIsoSVG`, gray, 512px), deterministically
  shuffled into opaque ids (`renders/item01..50.png`, mapping in
  `key.json`). Re-runnable: `npx tsx scripts/_tier1_blind.ts <outDir>`.
- **Blind free-naming panel:** 2 independent Sonnet voters per item ($0
  subscription subagents), asked "what object is this?" with no term list
  and no key. Raw votes in `votes.tsv`.
- **Target-aware pass:** Fable eyeballed all 50 renders against the known
  noun — "does it read as X once you know X" — the same bar the product
  implies, since a user always sees the label they typed.
- **Structure stats:** per-set bbox and median column depth (y-span per
  occupied (x,z) column), computed from the shipped voxels.

## Headline numbers

- **Blind free-naming: 6/100 strict hits** (key ×2, rabbit ×2, castle ×1,
  helicopter ×1). Near-misses (right family, wrong species/kind): ~12
  more (dinosaur→giraffe ×2, submarine→ship ×2, umbrella→mushroom ×2,
  tiger→llama ×2, pizza→"pie wedge" alt ×1, …).
- **Cross-voter wrong-consensus** — both voters independently converged
  on the same *wrong* object. This is the strongest bad-signal in the
  run, because it means the set projects a coherent wrong gestalt, not
  noise: rose→key, pumpkin→battery, tractor→factory, truck→table/bench,
  fire-truck→dog, birthday-cake→crown, bus→book, coffee-cup→tower,
  hamburger→building, boat→camera, umbrella→mushroom, tiger→llama.
- **Target-aware verdicts: 15 clean / 22 marginal / 13 flagged** (table
  below).

## Calibration — do not compare 6% to judge1's 81%

judge1's 81% identification was **forced-choice** (options given); this
run is **open free-naming in gray at 16³**, a far harder task, and it ran
on the iso render only (no front view, no color). It is a stress
instrument for *ranking* sets and exposing wrong-gestalt failures, not a
pass/fail bar. The product bar stays target-aware: the user typed the
noun and sees it as a label. But wrong-consensus items fail even that
bar in spirit — a user who typed "truck" and watches a table get built
is the live-quality complaint this library exists to prevent.

## Per-set verdicts

flag = regen candidate. Verdicts are Fable's target-aware eyeball,
informed by the blind votes; the contact-sheet gate can overrule any row.

| noun | batch | vox | medDepth | blind votes | verdict | note |
|---|---|---|---|---|---|---|
| key | b5 | 184 | 5 | key, key | clean | best free-name result in the library |
| rabbit | b2 | 471 | 8 | rabbit, rabbit | clean | repaired set; tall ears carry it |
| dinosaur | b1 | 354 | 8 | giraffe ×2 | clean | long neck carries it; giraffe-adjacent is fine |
| castle | b1 | 828 | 11 | skyline, castle | clean | towers + gate arch read |
| birthday-cake | b1 | 744 | 7 | crown ×2 | clean | candles read as prongs blind; fine once labeled |
| windmill | b5 | 568 | 9 | bird, cake | clean | blades read target-aware |
| eiffel-tower | b5 | 317 | 5 | tree, tent | clean | taper + splayed legs read |
| helicopter | b2 | 506 | 11 | helicopter, blob | clean | rotor slab carries it |
| submarine | b2 | 289 | 4 | ship ×2 | clean | hull + tower + periscope |
| bicycle | b2 | 212 | 7 | bowtie, scissors | clean | reads target-aware; thin at 212 vox |
| boat | b1 | 448 | 6 | camera ×2 | clean | hull + cabin tiers; cabin reads as knob blind |
| tractor | b2 | 655 | 8 | factory ×2 | clean | exhaust pole reads; big-wheel cue weak |
| rose | b1 | 226 | 5 | key, key (high conf!) | clean | bloom+stem+leaf mimics a key silhouette in gray |
| snowman | b4 | 624 | 9 | backpack, blob | clean | tiers + hat read target-aware |
| skyscraper | b5 | 557 | 5 | ziggurat ×2 | clean | setback-style tower; legit archetype |
| turtle | b3 | 474 | 8 | horse/dog ×2 | marginal | repaired set; shell not distinct from body |
| bear | b2 | 684 | 9 | stegosaurus, horse | marginal | generic quadruped; back ridge misreads |
| tiger | b3 | 556 | 6 | llama ×2 | marginal | proportions read camelid, not big cat |
| lion | b3 | 565 | 8 | dog ×2 | marginal | mane invisible in gray |
| elephant | b2 | 648 | 10 | staircase, dinosaur | marginal | trunk voxelizes into literal stairs |
| apple | b4 | 400 | 8 | trophy, blob | marginal | stem/leaf arch confuses the crown |
| pumpkin | b4 | 936 | 12 | battery ×2 | marginal | ribs don't survive; stem nub = terminal |
| owl | b3 | 466 | 9 | crown, castle tower | marginal | wing-layer ridges read architectural |
| crab | b4 | 378 | 6 | camel, bridge | marginal | claws read as legs/piers |
| umbrella | b5 | 292 | 5 | mushroom ×2 | marginal | canopy+shaft fine; handle hook lost |
| butterfly | b3 | 276 | 12 | pine tree, leaf | marginal | flat radial form reads as foliage in iso |
| sun | b4 | 444 | 12 | snowflake, blob | marginal | flat disc (h=3) lying down; rays read as snowflake |
| star | b4 | 368 | 10 | robot ×2 | marginal | upright 5-point star = humanoid in iso |
| whale | b3 | 411 | 8 | table, insect | marginal | tail flukes read as furniture legs |
| train | b1 | 630 | 6 | towers, camel | marginal | cab+boiler blocks don't chain into "train" |
| truck | b2 | 636 | 9 | bench, table | marginal | wheels-as-notches read as legs |
| fire-truck | b1 | 630 | 7 | dog ×2 | marginal | ladder reads target-aware; cab misreads blind |
| bus | b2 | 944 | 11 | book ×2 | marginal | near-full-depth slab; window strip saves it labeled |
| guitar | b5 | 120 | 4 | flag, signpost | marginal | thinnest set; body reads as plate on post |
| flower | b4 | 372 | 6 | bird, creature | marginal | projected-provenance set; bloom fragmented |
| airplane | b1 | 296 | 8 | robot, tree | marginal | upright cross gestalt; wings read as arms |
| bridge | b5 | 592 | 6 | bowtie, blob | marginal | X-crossing composition confuses; arch weak |
| dolphin | b3 | 558 | 7 | thumbs up, mountain | **flag** | no coherent read from iso angle |
| shark | b3 | 562 | 9 | robot torso, blob | **flag** | jagged mass; no fish gestalt |
| teddy-bear | b5 | 688 | 11 | sofa, boombox | **flag** | slab body; one ear clipped |
| coffee-cup | b1 | 582 | 16 | tower ×2 | **flag** | full-depth extrusion; 16-deep "mug" |
| hamburger | b4 | 948 | 15 | building ×2 | **flag** | full-depth slab; layers invisible in iso |
| camera | b5 | 612 | 9 | tugboat, fortress | **flag** | lens invisible; two-knob slab |
| pizza | b4 | 358 | 7 | arrowhead, iceberg | **flag** | slice standing on its tip |
| banana | b4 | 256 | 4 | pyramid, staircase | **flag** | crescent voxelizes into literal staircase |
| dog | b1 | 288 | 5 | shoe, staircase | **flag** | worst of the quadrupeds; stairs + floating cube read |
| bee | b3 | 538 | 7 | turtle, blob | **flag** | wing plates read as shell |
| monkey | b3 | 437 | 10 | blob, rock | **flag** | fragmented mass, no silhouette |
| motorcycle | b2 | 432 | 8 | bridge, blob | **flag** | no two-wheel gestalt |
| crown | b5 | 294 | 6 | trophy, robot | **flag** | reads as cross-on-pedestal, not a ring of points |

**Flag list (13):** banana, bee, camera, coffee-cup, crown, dog, dolphin,
hamburger, monkey, motorcycle, pizza, shark, teddy-bear.
Batch skew: b3 animals carry 5 of 13 flags; b1/b4/b5 3–4 each; b2 one.
The skew tracks term class (organic/round things), not batch process.

## Failure classes

**A. Full-depth extrusion ("slab class").** Sets authored as a front mask
extruded through most or all of the 16-voxel depth. medDepth ≥ ~11 with
high fill and the iso view shows a monolith: coffee-cup (16), hamburger
(15), pumpkin (12), bus (11), teddy-bear (11). The prompt's top-view
anchoring says where mass sits but nothing constrains *how deep*; agents
default to filling the grid. Box-shaped objects survive this (castle,
bus, skyscraper); round/organic/layered objects die (a 16-deep mug, a
hamburger whose layers only exist on the front face). The existing
`fillRatio ≥ 0.9` slab check misses all of these because bbox fill stays
low (0.5–0.76) — median column depth is the discriminating stat.

**B. Species collapse on quadrupeds.** bear, lion, tiger, dog, elephant,
turtle all read "some four-legged animal, wrong species." In gray at 16³,
species is carried entirely by one or two exaggerated silhouette features
— the sets that survived blind naming each have exactly that (rabbit:
tall ears; dinosaur: long neck). Sets that under-exaggerate collapse:
lion's mane is invisible, elephant's trunk became stairs, tiger's
build reads camelid. Texture-level identity (stripes, mane, ribs) does
not exist until the color session.

**C. Flat/radial objects posed wrong for iso.** sun (flat disc lying
down → snowflake), star (upright → robot/person), butterfly (flat →
foliage), pizza (slice balanced on its tip → arrowhead), banana (profile
crescent → staircase). Pose selection is currently implicit in each
authoring agent; nothing in the brief asks "how will this silhouette
read at 30° iso?"

**D. Vehicles: wheels-as-notches read as furniture legs.** truck→table,
bus→book, fire-truck→dog, motorcycle/bicycle→abstract. Wheels carved as
underbody notches disappear; a vehicle gestalt needs wheels as distinct
proud masses plus a cab/hood step. tractor half-survives on its exhaust
pole alone.

**E. Wrong-gestalt mimicry.** A set can be structurally clean and still
project a *different* object coherently (rose→key at high confidence
both voters, pumpkin→battery, birthday-cake→crown). Structure checks can
never catch this class; only a blind viewer can.

## What raises the next batch — vetoable hypotheses, in dependency order

None of these are decisions; each is falsifiable against a regen batch
scored by the same panel method, and any can be vetoed.

1. **H-DEPTH — brief states a depth plan; checker gains a median-depth
   advisory.** Add to the authoring brief: name the object's real
   proportions and give per-region depth extents before writing voxels
   (a mug is ~10 deep and hollow; a hamburger is as deep as it is wide
   *with layers stacked in z*). Deterministic advisory (not a gate):
   median column depth ≥ 12 on a non-boxy term ⇒ warn. Prediction: the
   slab class (A) disappears from a regen of the 13 flags; falsified if
   flagged slab terms still read as slabs with the depth plan stated.
2. **H-CARICATURE — brief demands one named identity feature,
   exaggerated.** Before authoring, the agent must answer "what single
   silhouette feature says X?" and oversize it (rabbit-ears rule).
   Prediction: quadruped species collapse (B) improves measurably on
   blind re-naming; falsified if lion/tiger/dog regens still free-name
   as generic animals.
3. **H-POSE — brief requires an explicit pose choice with an iso
   rationale.** One line: "posed how, and why does that read at 30°?"
   (pizza flat with crust ring visible, star tilted off-axis, sun as
   upright disc with proud rays). Prediction: class C flags stop reading
   as snowflake/robot/arrowhead. Must work within iso — the front-on
   hero moment stays off the table.
4. **H-WHEELS — vehicle sub-brief: wheels as proud masses.** Wheels
   protrude ≥1 voxel below/beside the body plane; cab/hood step stated.
   Prediction: truck/bus/motorcycle regens stop free-naming as
   furniture; falsified if they still do.
5. **H-PANEL — keep the 2-voter blind free-name panel as the per-batch
   regen ranker.** ~$0 and ~5 min per 50 sets; wrong-consensus (both
   voters agree on the same wrong object) queues a set for regen ahead
   of low-confidence scatter. It ranks, it does not gate — same standing
   rule as judge1. The 100 votes here are the baseline; append future
   eyeball verdicts to grow it.

Color (open call 3) would independently rescue much of class B and E
(stripes, mane, red-cross, rose-red), but it is deferred by explicit
decision and none of the above depends on it.
