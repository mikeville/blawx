# judge1-cache-eval — auto-judge validation (2026-07-20, $0 API)

Question: can a Sonnet-tier automated judge reproduce the eyeball verdicts
on the 43 cached sets well enough to gate anything?

Ground truth: `ground-truth.json` — per-term iso/front recognizability 1–5
+ failure class, labeled from the same renders the judges saw (regenerate
via `npx tsx scripts/render-cache.ts <dir>`; inputs pinned by
`grid-hashes.json`). Binary split used everywhere below: **bad = iso ≤ 2**
(16 bad / 7 marginal / 20 good).

Designs (both single-vote Sonnet, subscription subagents):
- **J-A conditioned rubric** — term given, score both views, verdict
  good/marginal/bad. `judge-results/ja-*.json`
- **J-B forced choice** — anonymized filenames, pick the object from 4
  options + confidence. `jb-spec.json` / `jb-answers.json`,
  `judge-results/jb-*.json`

Results:

| gate design                 | agree | catches bad | false-bad |
|-----------------------------|-------|-------------|-----------|
| structure alone (comps/ground, no magnitude threshold) | 72% | 11/16 | 7 |
| J-A alone                   | 77%   | 11/16       | 5         |
| composite OR (struct ∪ J-A) | 70%   | **14/16**   | 11        |

J-B identification: 81% overall (chance 25%); 89% on good sets, 69% on
bad — misidentification correlates with badness but is not a gate alone.
J-A iso-score Kendall tau vs ground truth: 0.61.

Read of the misses:
- J-A's missed-bads (rainbow, helicopter, palm-tree) are floating-fragment
  failures — exactly what deterministic `analyze()` catches for free; hence
  the composite.
- Structure's false-bads (cat, lighthouse, sailboat, snail…) are cosmetic
  1–few-voxel fragments — `components !== 1` needs a magnitude threshold.
- Several J-A "errors" (fish, apple, duck, spider) are borderline eyeball
  calls; ground-truth noise puts a ceiling under any agreement number.

Verdict: single-vote Sonnet is NOT a hard quality gate (77% ≪ the ~90%
bar). The composite IS good enough to rank/queue background regeneration,
where a false-bad costs a $0 subscription re-gen and a missed-bad just
persists the status quo. Untested levers for gate-grade accuracy: 3-vote
panels, fragment-magnitude-aware structure signal, richer renders (spider's
front view renders near-blank; robot reads as ghost — render quality is
confounded with judge accuracy).

Future judge designs must beat 77% binary / 0.61 tau on this benchmark
before gating anything.
