const MICROS_PER_DOLLAR = 1_000_000;

export const OPENAI_LAUNCH_POLICY = Object.freeze({
  model: 'gpt-6-astra',
  reasoningEffort: 'low',
  serviceTier: 'default',
  maxInputBytes: 7_000,
  maxOutputTokens: 2_000,
  timeoutMs: 50_000,
  maxResponseBytes: 2 * 1024 * 1024,
  requestReserveMicros: 200_000,
  // Official standard rates are $10/M input and $50/M output as of
  // 2026-09-09. The input side deliberately reserves a 25% safety premium.
  conservativeInputUsdPerMillion: 12.5,
  outputUsdPerMillion: 50,
});

function tokenCostMicros(tokens, usdPerMillion) {
  return Math.ceil(tokens * usdPerMillion * MICROS_PER_DOLLAR / 1_000_000);
}

export function worstCaseRequestMicros(policy = OPENAI_LAUNCH_POLICY) {
  // A tokenizer cannot emit more tokens than the UTF-8 bytes it consumes. The
  // gap between this bound and the reservation also covers request overhead.
  return tokenCostMicros(policy.maxInputBytes, policy.conservativeInputUsdPerMillion)
    + tokenCostMicros(policy.maxOutputTokens, policy.outputUsdPerMillion);
}

export function buildBoundedOpenAIRequest(input, policy = OPENAI_LAUNCH_POLICY) {
  if (typeof input !== 'string' || !input) throw new Error('openai_input_required');
  if (new TextEncoder().encode(input).byteLength > policy.maxInputBytes) {
    throw new Error('openai_input_too_large');
  }
  if (worstCaseRequestMicros(policy) > policy.requestReserveMicros) {
    throw new Error('openai_request_exceeds_reservation');
  }

  return Object.freeze({
    model: policy.model,
    reasoning: { effort: policy.reasoningEffort },
    service_tier: policy.serviceTier,
    max_output_tokens: policy.maxOutputTokens,
    store: false,
    tools: [],
    input,
  });
}
