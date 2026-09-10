import { validateNamingImages } from './naming-budget.js';
import {
  SEMANTIC_NAMING_CACHE_IDENTITY,
  SEMANTIC_NAMING_GROUPING_VERSION,
  SEMANTIC_NAMING_STRATEGY,
} from '../src/semantic-naming-version.js';

const INPUT_USD_PER_MILLION = 2;
const CACHE_WRITE_MULTIPLIER = 1.25;
const WORST_INPUT_USD_PER_MILLION = INPUT_USD_PER_MILLION * CACHE_WRITE_MULTIPLIER;
const OUTPUT_USD_PER_MILLION = 12;

export const SINGLE_HIGHLIGHT_NAMING_POLICY = Object.freeze({
  strategy: SEMANTIC_NAMING_STRATEGY,
  groupingVersion: SEMANTIC_NAMING_GROUPING_VERSION,
  cacheIdentity: SEMANTIC_NAMING_CACHE_IDENTITY,
  model: 'gpt-5.6-terra',
  reasoningEffort: 'none',
  serviceTier: 'default',
  maxPromptBytes: 800,
  overheadTokenAllowance: 1_024,
  maxImages: 4,
  maxImageDimension: 512,
  maxImageBytes: 4 * 1024 * 1024,
  maxOutputTokens: 128,
  maxCostUsd: 0.009186,
  inputUsdPerMillion: INPUT_USD_PER_MILLION,
  cacheWriteMultiplier: CACHE_WRITE_MULTIPLIER,
  worstInputUsdPerMillion: WORST_INPUT_USD_PER_MILLION,
  outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
  pricingAsOf: '2026-09-10',
});

function imageTokenCount(width, height) {
  return Math.ceil(Math.ceil(width / 32) * Math.ceil(height / 32) * 1.2) + 1;
}

function prepareImages(images) {
  const prepared = validateNamingImages(images);
  if (prepared.length > SINGLE_HIGHLIGHT_NAMING_POLICY.maxImages) {
    throw new RangeError(`Single-highlight naming accepts at most ${SINGLE_HIGHLIGHT_NAMING_POLICY.maxImages} images.`);
  }
  for (const [index, image] of prepared.entries()) {
    if (image.width > SINGLE_HIGHLIGHT_NAMING_POLICY.maxImageDimension
      || image.height > SINGLE_HIGHLIGHT_NAMING_POLICY.maxImageDimension) {
      throw new RangeError(`Single-highlight naming image ${index + 1} exceeds 512 pixels.`);
    }
    if (image.png.length > SINGLE_HIGHLIGHT_NAMING_POLICY.maxImageBytes) {
      throw new RangeError(`Single-highlight naming image ${index + 1} exceeds the byte limit.`);
    }
  }
  return prepared;
}

function estimateBudget(promptBytes, images) {
  const imageTokens = images.reduce((sum, image) => sum + imageTokenCount(image.width, image.height), 0);
  const maxInputTokens = promptBytes + SINGLE_HIGHLIGHT_NAMING_POLICY.overheadTokenAllowance + imageTokens;
  const maxInputCostUsd = maxInputTokens * WORST_INPUT_USD_PER_MILLION / 1_000_000;
  const maxOutputCostUsd = SINGLE_HIGHLIGHT_NAMING_POLICY.maxOutputTokens * OUTPUT_USD_PER_MILLION / 1_000_000;
  return Object.freeze({
    promptBytes,
    imageCount: images.length,
    imageTokens,
    maxInputTokens,
    maxOutputTokens: SINGLE_HIGHLIGHT_NAMING_POLICY.maxOutputTokens,
    worstInputUsdPerMillion: WORST_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
    maxInputCostUsd,
    maxOutputCostUsd,
    maxCostUsd: Number((maxInputCostUsd + maxOutputCostUsd).toFixed(10)),
    pricingAsOf: SINGLE_HIGHLIGHT_NAMING_POLICY.pricingAsOf,
    basis: 'Prospective API envelope at pinned rates; the subscription CLI reports usage separately and cannot enforce the output-token cap.',
  });
}

const maximumImages = Array.from({ length: SINGLE_HIGHLIGHT_NAMING_POLICY.maxImages }, () => ({
  width: SINGLE_HIGHLIGHT_NAMING_POLICY.maxImageDimension,
  height: SINGLE_HIGHLIGHT_NAMING_POLICY.maxImageDimension,
}));

export const SINGLE_HIGHLIGHT_NAMING_STAGE_ENVELOPE = estimateBudget(
  SINGLE_HIGHLIGHT_NAMING_POLICY.maxPromptBytes,
  maximumImages,
);

if (SINGLE_HIGHLIGHT_NAMING_STAGE_ENVELOPE.maxCostUsd !== SINGLE_HIGHLIGHT_NAMING_POLICY.maxCostUsd) {
  throw new RangeError('Single-highlight naming envelope does not match its fixed cost ceiling.');
}

export function createSingleHighlightApiRequest(prompt, { images = [] } = {}) {
  if (typeof prompt !== 'string') throw new TypeError('Single-highlight naming prompt must be text.');
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > SINGLE_HIGHLIGHT_NAMING_POLICY.maxPromptBytes) {
    throw new RangeError('Single-highlight naming prompt exceeds the 800-byte production limit.');
  }
  const preparedImages = prepareImages(images);
  const budget = estimateBudget(promptBytes, preparedImages);
  if (budget.maxCostUsd > SINGLE_HIGHLIGHT_NAMING_POLICY.maxCostUsd) {
    throw new RangeError('Single-highlight naming request exceeds its fixed production envelope.');
  }
  return {
    body: Object.freeze({
      model: SINGLE_HIGHLIGHT_NAMING_POLICY.model,
      input: Object.freeze([Object.freeze({
        role: 'user',
        content: Object.freeze([
          Object.freeze({ type: 'input_text', text: prompt }),
          ...preparedImages.map((image) => Object.freeze({
            type: 'input_image',
            image_url: `data:image/png;base64,${image.png.toString('base64')}`,
            detail: 'high',
          })),
        ]),
      })]),
      reasoning: Object.freeze({ effort: SINGLE_HIGHLIGHT_NAMING_POLICY.reasoningEffort }),
      service_tier: SINGLE_HIGHLIGHT_NAMING_POLICY.serviceTier,
      max_output_tokens: SINGLE_HIGHLIGHT_NAMING_POLICY.maxOutputTokens,
      tools: Object.freeze([]),
      store: false,
      stream: false,
      text: Object.freeze({ format: Object.freeze({ type: 'json_object' }) }),
    }),
    budget,
  };
}

export function createSingleHighlightReservation(requestId) {
  if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/u.test(requestId)) {
    throw new TypeError('Single-highlight reservation requires a safe request ID.');
  }
  return Object.freeze({
    requestId,
    strategy: SEMANTIC_NAMING_STRATEGY,
    groupingVersion: SEMANTIC_NAMING_GROUPING_VERSION,
    cacheIdentity: SEMANTIC_NAMING_CACHE_IDENTITY,
    amountUsd: SINGLE_HIGHLIGHT_NAMING_STAGE_ENVELOPE.maxCostUsd,
    envelope: SINGLE_HIGHLIGHT_NAMING_STAGE_ENVELOPE,
  });
}
