import { expandLoftProgram } from '../../../src/loft-program.js';
import { validateVoxels } from '../../../src/voxels.js';
import { substituteSubject } from '../../../server/prompt-template.js';
import { buildBoundedOpenAIRequest, OPENAI_LAUNCH_POLICY } from './openai-budget.js';

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MICROS_PER_DOLLAR = 1_000_000;
const STANDARD_RATES_USD_PER_MILLION = Object.freeze({
  uncachedInput: 10,
  cachedInput: 1,
  // Cache-write usage is not normally present in a Responses usage object.
  // If it appears, price it at the request-reservation safety rate.
  cacheWriteInput: 12.5,
  output: 50,
});

export class OpenAIProviderError extends Error {
  constructor(code, { actualMicros, cause, publicStatus } = {}) {
    super(code, cause ? { cause } : undefined);
    this.name = 'OpenAIProviderError';
    this.code = code;
    if (Number.isInteger(actualMicros) && actualMicros >= 0) this.actualMicros = actualMicros;
    if (Number.isInteger(publicStatus)) this.publicStatus = publicStatus;
  }
}

function nonnegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function tokenCostMicros(tokens, usdPerMillion) {
  return Math.ceil(tokens * usdPerMillion * MICROS_PER_DOLLAR / 1_000_000);
}

export function usageCostMicros(usage, rates = STANDARD_RATES_USD_PER_MILLION) {
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const cacheWrites = usage?.input_tokens_details?.cache_write_tokens ?? 0;
  if (![input, output, cached, cacheWrites].every(nonnegativeInteger)
      || cached + cacheWrites > input) {
    throw new OpenAIProviderError('openai_usage_invalid');
  }
  const uncached = input - cached - cacheWrites;
  return tokenCostMicros(uncached, rates.uncachedInput)
    + tokenCostMicros(cached, rates.cachedInput)
    + tokenCostMicros(cacheWrites, rates.cacheWriteInput)
    + tokenCostMicros(output, rates.output);
}

async function readBoundedResponse(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new OpenAIProviderError('openai_response_too_large');
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) {
      throw new OpenAIProviderError('openai_response_too_large');
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new OpenAIProviderError('openai_response_too_large');
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function parseResponseJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not_an_object');
    return parsed;
  } catch (cause) {
    throw new OpenAIProviderError('openai_response_invalid_json', { cause });
  }
}

export function extractOpenAIOutputText(response) {
  if (response?.status !== 'completed') throw new OpenAIProviderError('openai_response_incomplete');
  if (!Array.isArray(response.output) || response.output.length === 0) {
    throw new OpenAIProviderError('openai_output_missing');
  }
  const texts = [];
  for (const item of response.output) {
    if (item?.type === 'reasoning') continue;
    if (item?.type !== 'message' || item.role !== 'assistant') {
      throw new OpenAIProviderError('openai_output_unexpected');
    }
    if (item.status != null && item.status !== 'completed') {
      throw new OpenAIProviderError('openai_output_incomplete');
    }
    if (!Array.isArray(item.content) || item.content.length === 0) {
      throw new OpenAIProviderError('openai_output_missing');
    }
    for (const content of item.content) {
      if (content?.type === 'refusal') throw new OpenAIProviderError('openai_refusal');
      if (content?.type !== 'output_text' || typeof content.text !== 'string') {
        throw new OpenAIProviderError('openai_output_unexpected');
      }
      texts.push(content.text);
    }
  }
  if (texts.length === 0) throw new OpenAIProviderError('openai_output_missing');
  return texts.join('');
}

function parseProgram(text, actualMicros) {
  let sourceProgram;
  try {
    sourceProgram = JSON.parse(text);
  } catch (cause) {
    throw new OpenAIProviderError('openai_program_invalid_json', { actualMicros, cause });
  }

  try {
    const model = expandLoftProgram(sourceProgram, { method: 'voxel-loft' });
    const diagnostics = validateVoxels(model);
    if (!diagnostics.valid) throw new Error('voxel_validation_failed');
    return { sourceProgram, model, diagnostics };
  } catch (cause) {
    if (cause instanceof OpenAIProviderError) throw cause;
    throw new OpenAIProviderError('openai_program_invalid', { actualMicros, cause });
  }
}

function combineSignals(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort(externalSignal?.reason ?? new Error('request_aborted'));
  if (externalSignal?.aborted) abort();
  else externalSignal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('openai_timeout')), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', abort);
    },
  };
}

export function createOpenAIProvider({
  apiKey,
  promptTemplate,
  fetchImpl = globalThis.fetch,
  policy = OPENAI_LAUNCH_POLICY,
  nowMs = () => Date.now(),
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('openai_api_key_required');
  if (typeof promptTemplate !== 'string' || !promptTemplate) throw new Error('openai_prompt_template_required');
  if (typeof fetchImpl !== 'function') throw new Error('openai_fetch_required');

  const provider = async (prepared, { requestId, signal } = {}) => {
    if (!prepared || typeof prepared !== 'object' || typeof prepared.input !== 'string'
        || typeof prepared.userPrompt !== 'string') {
      throw new OpenAIProviderError('openai_prepared_input_required');
    }
    const requestBody = buildBoundedOpenAIRequest(prepared.input, policy);
    const combined = combineSignals(signal, policy.timeoutMs);
    const startedAt = nowMs();
    let response;
    let responseText;
    try {
      response = await fetchImpl(RESPONSES_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        redirect: 'error',
        signal: combined.signal,
      });
      responseText = await readBoundedResponse(response, policy.maxResponseBytes);
    } catch (cause) {
      if (cause instanceof OpenAIProviderError) throw cause;
      throw new OpenAIProviderError(combined.signal.aborted ? 'openai_request_aborted' : 'openai_network_failure', { cause });
    } finally {
      combined.dispose();
    }

    const responseJson = parseResponseJson(responseText);
    let actualMicros;
    try {
      actualMicros = usageCostMicros(responseJson.usage);
    } catch (cause) {
      throw new OpenAIProviderError('openai_usage_unknown', { cause });
    }
    if (!response.ok) {
      throw new OpenAIProviderError('openai_http_failure', { actualMicros });
    }
    if (responseJson.usage.output_tokens > policy.maxOutputTokens) {
      throw new OpenAIProviderError('openai_output_limit_exceeded', { actualMicros });
    }

    let outputText;
    try {
      outputText = extractOpenAIOutputText(responseJson);
    } catch (cause) {
      throw new OpenAIProviderError(cause.code ?? 'openai_output_invalid', { actualMicros, cause });
    }
    const { sourceProgram, model, diagnostics } = parseProgram(outputText, actualMicros);
    const generationMs = Math.max(0, nowMs() - startedAt);
    const resultId = typeof responseJson.id === 'string' && responseJson.id
      ? responseJson.id
      : requestId;
    if (typeof resultId !== 'string' || !resultId) {
      throw new OpenAIProviderError('openai_response_id_missing', { actualMicros });
    }
    return {
      actualMicros,
      resultId,
      payload: {
        requestId,
        prompt: prepared.userPrompt,
        model,
        sourceProgram,
        diagnostics,
        metadata: {
          runtime: 'openai-responses-api',
          generationMs,
          timingScope: 'server request through local validation',
          requestedModel: policy.model,
          actualModel: typeof responseJson.model === 'string' ? responseJson.model : null,
          reasoningEffort: policy.reasoningEffort,
          requestedServiceTier: policy.serviceTier,
          actualServiceTier: typeof responseJson.service_tier === 'string' ? responseJson.service_tier : null,
          requestCount: 1,
          retries: 0,
        },
      },
    };
  };

  provider.prepare = async (userPrompt) => {
    let input;
    try {
      input = substituteSubject(promptTemplate, userPrompt);
      buildBoundedOpenAIRequest(input, policy);
    } catch (cause) {
      const publicStatus = cause?.message === 'openai_input_too_large' ? 400 : undefined;
      throw new OpenAIProviderError('openai_prompt_preflight_failed', { cause, publicStatus });
    }
    return Object.freeze({ input, userPrompt });
  };

  return provider;
}

export const openAIProviderConfig = Object.freeze({
  endpoint: RESPONSES_URL,
  standardRatesUsdPerMillion: STANDARD_RATES_USD_PER_MILLION,
});
