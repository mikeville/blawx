# Benchmark runs

One folder per run. A run = one pipeline version × one set of conditions,
evaluated over the fixed noun list in `src/bench/nouns.ts`. The harness is
**human-in-loop**: no file in here is ever produced by a live API call during
R&D. Model responses are generated in a Claude session, converted to the JSON
format below, and dropped into the run folder. The contact sheet
(`npm run dev`) picks up every `runs/*/*.json` automatically.

## Folder layout

```
runs/<run-id>/
  run.json          manifest (required)
  scores.json       blind-name scores (added after scoring)
  <noun>.json       one result per noun
```

## run.json

```json
{
  "id": "v1-hull-16-rle",
  "label": "v1 three-view hull, 16³, run-length",
  "date": "2026-07-03",
  "pipeline": "single-call three-view hull",
  "conditions": { "grid": "16", "encoding": "rle", "model": "claude-haiku-4-5" }
}
```

## Result files (`<noun>.json`)

```json
{
  "noun": "fox",
  "size": 16,
  "voxels": [[3, 0, 5], [4, 0, 5]],
  "colors": ["#C8102E", "#C8102E"],
  "meta": {
    "model": "claude-haiku-4-5",
    "encoding": "rle",
    "tokensIn": 900,
    "tokensOut": 1400,
    "latencyMs": 6200,
    "notes": ""
  }
}
```

- `voxels` — integer `[x, y, z]` triples, `y` up, all in `[0, size)`.
  Out-of-range or duplicate voxels are dropped at load and surface on the
  contact sheet as a `dropped` count — that count is itself a reliability
  signal, so convert pasted output faithfully; don't pre-clean it.
- `colors` — optional hex array parallel to `voxels`. The primary
  (monotone) render ignores it; it only feeds the secondary color view.
- `meta.tokensIn/tokensOut` — estimates for hypothetical cost math
  (`src/bench/cost.ts`, ~4 chars/token on the pasted prompt + response).
  Nothing is billed; this tracks what the call *would* cost at API list
  prices. `latencyMs` — wall clock of the generating chat turn, best effort.

## Blind-name scoring workflow

1. On the contact sheet, hit **export scoring pngs** for the run. Filenames
   are opaque (`<run>-item01.png` …) so the vision model can't read the
   answer out of the filename. Item numbering = alphabetical by noun; the
   mapping is on screen when blind mode is off.
2. In a **fresh** Claude chat (no project context), attach the PNGs and ask
   only: *"One or two words each: what is this?"* — no hints, no noun list.
3. Record each answer in `scores.json`:

```json
{
  "fox": { "answer": "dog", "verdict": "close" },
  "mug": { "answer": "mug", "verdict": "hit" },
  "octopus": { "answer": "red blob", "verdict": "miss" }
}
```

Verdicts: `hit` = names the noun or an exact synonym; `close` = right
body-plan family or near-synonym (fox→dog); `miss` = anything else.
Score = mean of hit=1 / close=0.5 / miss=0, shown per run on the sheet.

## Sweep workflow (Phase 1b)

The grid-size × encoding sweep stages everything as files; each model
response is one paste in a fresh Claude chat.

1. `npx tsx scripts/make-prompts.ts` — writes six run folders
   (`sweep1-{8,16,32}-{char,rle}`), each with `prompts/<noun>.md` and an
   empty `responses/`. Default is a 12-noun stratified subset; `--all`
   for the full 30.
2. For each prompt: paste into a **fresh** chat, save the raw response
   verbatim to `responses/<noun>.txt` (same basename as the prompt).
   Note which model the chat used and put it in the run's `run.json`
   `conditions.model` (once per run folder).
3. `npx tsx scripts/convert-response.ts runs/<run-id>/responses/<noun>.txt`
   — parses the three masks, lifts the strict visual hull, writes
   `<noun>.json` with diagnostics: malformed-row count (row drift) and
   per-view reprojection loss (cross-view inconsistency). Zero-voxel
   results are written too — failures must stay visible.
4. Score each run via the blind-name workflow above; compare score,
   failure diagnostics, and hypothetical cost across the six conditions.

## Reference runs

`baseline-*` folders are imported prior-attempt outputs (via
`npx tsx scripts/import-baselines.ts`). They are **failure references** —
what bad looks like — not pipeline versions under test. Don't score-chase
against them; they exist to keep the eval renderer honest and the failure
modes visible.
