# improve1-cache-swap — H-D background improver (2026-07-20, $0 API)

Question: does the improve loop (regenerate flagged sets → blind rank →
guarded replace) actually raise cache quality, or just churn?

Inputs: the 25 terms flagged by the judge1 composite gate. Each got two
full-authorship challengers (probe8 prompt v2, subscription subagents;
`runs/improve1-16char-a`/`-b`) plus the incumbent, rendered as blind
shuffled trios. A 9-voter Sonnet panel (3 votes/term) ranked each trio
(`panel-results/`); Borda scoring + a deterministic structure guard
(winner must be single-component and grounded) + ties-keep-incumbent
produced `decisions.json`.

Outcome: **20/25 replaced, 5 kept.** All 20 winners passed the
Fable-eyeball QA gate before the swap. KV writes via
`wrangler kv key put --local`; verbatim incumbent backups in
`incumbents/` (restore = put the backup back under `g:<term>`).

Safety properties, observed:
- duck (canonical exemplar), star, mug, sailboat: incumbents won their
  panels outright — the loop did not clobber good sets.
- peanut: challenger-a won the votes but is airborne (touchesGround
  false) — the structure guard blocked it; incumbent (also degraded)
  stays. Net: peanut remains the one flagged term with no fix this round.
- Both semantic traps fixed: castle is a two-tower castle (was a
  tree-painted chess rook), grapes is a hanging cluster (was a wine
  bottle). candy-cane/rainbow went from floating fragments to coherent
  single objects; helicopter/octopus/palm-tree/spider/pants are large
  legibility upgrades.
- Weakest accepts, per the eyeball pass: bowl (funnel-ish, but beats a
  two-piece split sphere); lighthouse and snail are lateral swaps.
- Not fixed because never flagged: fish, mushroom (judge1 blind spots).

Caveats:
- Generation methodology drift: several gen subagents wrote projection
  code (3D part model → orthographic views) instead of freehand mask
  authoring — 48/50 first drafts validator-clean, far above probe8's
  4/10. That is a property of agents-with-tools, NOT of the raw-API
  call profile; do not read it as a prompt improvement. It is, however,
  a real candidate architecture for the Worker miss path (author via
  code, validate deterministically).
- Color: replacements carry the single colorFor() color; the Haiku
  paint overlay was not re-run (color work deferred). candy-cane is
  now blue — silhouette right, palette wrong — the first item for the
  color session.
- Panel and generators are both Sonnet: judge1 showed 77% verdict
  agreement with the human baseline, so expect ~1-in-4 panel calls to
  be arguable (lighthouse may be one). Backups make every call cheap
  to revisit.

Backtest baseline re-snapshotted after the swap (all 20 diffs were
CACHE-CHANGED inputs, 0 behavior diffs, as designed).
