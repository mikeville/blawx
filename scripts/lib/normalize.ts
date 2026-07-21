// Query normalization ahead of exact cache lookup and nearest-neighbor matching.
// Pure and dependency-free so the same logic can port verbatim into the Worker
// (../api/src/) when the NN display route is built. Apply the SAME function to
// pool terms before embedding and to live queries before lookup — the embedding
// space only matches if both sides normalize identically.

const DROP_TOKENS = new Set([
  // articles / determiners / possessives
  'a', 'an', 'the', 'my', 'our', 'your', 'his', 'her', 'their', 'its',
  'some', 'this', 'that',
  // request framing that carries no object semantics
  'lego', 'please', 'set', 'of',
]);

/**
 * Lowercase, strip punctuation (input hygiene — kills injection strings as a
 * side effect), strip possessive 's, drop determiners/possessives and request
 * framing tokens. "My dog Rex" → "dog rex"; "a birthday cake!" → "birthday cake".
 * Head-noun extraction beyond token-dropping (e.g. "dog rex" → "dog") is NOT
 * done here — the embedding NN handles residual modifiers, and exact-lookup
 * callers can retry with `poolHit` below.
 */
export function normalizeQuery(raw: string): string {
  const tokens = raw
    .toLowerCase()
    .replace(/['’]s(?=\s|$)/g, '') // possessive 's
    .replace(/[^a-z0-9\s-]/g, ' ') // punctuation and anything script-like
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 0 && !DROP_TOKENS.has(t));
  return tokens.join(' ');
}

/**
 * Exact-lookup fallback: given an already-normalized query and a vocabulary of
 * normalized cached terms, return the longest contiguous token span that is a
 * vocabulary hit ("dog rex" → "dog", "red fire truck" → "fire truck").
 * Returns null when no span matches — caller falls through to NN matching.
 */
export function poolHit(normalized: string, vocab: Set<string>): string | null {
  if (vocab.has(normalized)) return normalized;
  const tokens = normalized.split(' ');
  for (let len = tokens.length - 1; len >= 1; len--) {
    for (let start = 0; start + len <= tokens.length; start++) {
      const span = tokens.slice(start, start + len).join(' ');
      if (vocab.has(span)) return span;
    }
  }
  return null;
}
