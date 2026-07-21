# Pre-seed candidate pool

Selection artifacts for the pre-seed library: which nouns to bake into the cache so
that (a) head queries hit directly and (b) every plausible query has a decent
nearest-neighbor stand-in while its real set generates.

## Files

- `sources/` — raw source lists, vendored verbatim:
  - `quickdraw.txt` — the 345 Google Quick, Draw! categories
    (googlecreativelab/quickdraw-dataset, CC BY 4.0) — nouns with proven mass
    demand-to-depict.
  - `things.txt` — the 1,854 THINGS concept words (Hebart et al. 2019,
    doi:10.1371/journal.pone.0223792) — psychology-normed concrete nameable objects.
  - `first-words.txt` — hand-authored children's first-words / picture-book nouns
    (~110, CDI-style).
- `candidates.json` — the union (lowercased, `_`/`-` → space, leading "the" stripped,
  deduped; 1,953 terms) with per-term source tags and a keep/drop buildability verdict
  ("seed-worthy at 16³?" — judged by Sonnet subagents against the criteria in the
  verdict `tag` taxonomy, reviewed by hand).
- `tier1.txt` — the head list placed as seeds before farthest-point sampling starts.
- `holdout.txt` — plausible queries deliberately not drawn from the pool, for
  coverage validation.
- `seed-list.json`, `covering-report.md` — outputs of `npx tsx scripts/seed-pool.ts`:
  the ordered seed list and measured covering numbers at several similarity floors.

## Method

`scripts/seed-pool.ts` normalizes every term with `scripts/lib/normalize.ts` (the
same normalizer intended for live queries), embeds with bge-small-en-v1.5 locally
(same model as Workers AI `@cf/baai/bge-small-en-v1.5`, so the geometry matches the
production NN space), then runs farthest-point sampling seeded with Tier 1. The FPS
radius curve gives the covering number at each floor: the number of seeds needed
before every pool candidate sits within that cosine similarity of some seed.
