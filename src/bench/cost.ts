// Hypothetical cost math only. Nothing in this harness calls a live API —
// model responses arrive by paste during R&D. Costs are computed as "what
// this generation would have cost at published API list prices" so the
// grid-size / encoding / model-tier tradeoffs are decided on real numbers.

export type ModelPrice = {
  /** USD per million input tokens. */
  inPerMTok: number;
  /** USD per million output tokens. */
  outPerMTok: number;
};

// Published Anthropic API list prices, $/MTok (cached 2026-06-24).
// Sonnet 5 has intro pricing ($2/$10) through 2026-08-31; list price used
// here since the toy would outlive the intro window.
export const PRICES: Record<string, ModelPrice> = {
  'claude-haiku-4-5': { inPerMTok: 1.0, outPerMTok: 5.0 },
  'claude-sonnet-5': { inPerMTok: 3.0, outPerMTok: 15.0 },
  'claude-opus-4-8': { inPerMTok: 5.0, outPerMTok: 25.0 },
};

/**
 * Rough token estimate for pasted prompt/response text (~4 chars/token).
 * Order-of-magnitude bookkeeping only; a sweep decision that hinges on
 * <2x cost difference should recount properly.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Returns null for unknown models rather than guessing a price. */
export function hypotheticalCostUSD(
  model: string,
  tokensIn: number,
  tokensOut: number,
): number | null {
  const p = PRICES[model];
  if (!p) return null;
  return (tokensIn * p.inPerMTok + tokensOut * p.outPerMTok) / 1_000_000;
}
