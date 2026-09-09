const INPUT_USD_PER_MILLION = 0.20;
const CACHE_WRITE_MULTIPLIER = 1.25;
const WORST_INPUT_USD_PER_MILLION = INPUT_USD_PER_MILLION * CACHE_WRITE_MULTIPLIER;
const OUTPUT_USD_PER_MILLION = 1.20;

export const NAMING_POLICY = Object.freeze({
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  serviceTier: 'default',
  overheadTokenAllowance: 1_024,
  maxImages: 4,
  maxImageDimension: 1_024,
  maxImageBytes: 4 * 1024 * 1024,
  maxCostUsd: 0.01,
  pricingAsOf: '2026-09-08',
});

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function imageTokenCount(width, height) {
  const patches = Math.ceil(width / 32) * Math.ceil(height / 32);
  return Math.ceil(patches * 1.2) + 1;
}

const MAX_IMAGE_TOKENS = imageTokenCount(
  NAMING_POLICY.maxImageDimension,
  NAMING_POLICY.maxImageDimension,
) * NAMING_POLICY.maxImages;

function phasePolicy(maxPromptBytes, maxOutputTokens) {
  const maxInputTokens = maxPromptBytes + NAMING_POLICY.overheadTokenAllowance + MAX_IMAGE_TOKENS;
  const maxCostUsd = (maxInputTokens * WORST_INPUT_USD_PER_MILLION
    + maxOutputTokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
  return Object.freeze({ maxPromptBytes, maxOutputTokens, maxCostUsd });
}

export const NAMING_PHASE_POLICIES = Object.freeze({
  proposal: phasePolicy(10_000, 1_536),
  captions: phasePolicy(2_000, 1_280),
});

export function validateNamingImages(images = []) {
  if (!Array.isArray(images)) throw new TypeError('Naming images must be an array.');
  if (images.length > NAMING_POLICY.maxImages) {
    throw new RangeError(`Naming requests support at most ${NAMING_POLICY.maxImages} images.`);
  }
  return images.map((image, index) => {
    if (!image || typeof image !== 'object' || Array.isArray(image)) {
      throw new TypeError(`Naming image ${index + 1} must be an object.`);
    }
    const keys = Object.keys(image).sort();
    if (keys.join('\0') !== ['height', 'png', 'view', 'width'].join('\0')) {
      throw new TypeError(`Naming image ${index + 1} must contain png, width, height, and view.`);
    }
    if (!Buffer.isBuffer(image.png)) throw new TypeError(`Naming image ${index + 1} png must be a Buffer.`);
    if (image.png.length > NAMING_POLICY.maxImageBytes) {
      throw new RangeError(`Naming image ${index + 1} exceeds the ${NAMING_POLICY.maxImageBytes}-byte limit.`);
    }
    if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
      || image.width < 1 || image.height < 1
      || image.width > NAMING_POLICY.maxImageDimension || image.height > NAMING_POLICY.maxImageDimension) {
      throw new RangeError(`Naming image ${index + 1} dimensions must be integers from 1 to ${NAMING_POLICY.maxImageDimension}.`);
    }
    if (typeof image.view !== 'string' || image.view.length === 0 || [...image.view].length > 256
      || /[\u0000-\u001f\u007f]/u.test(image.view)) {
      throw new RangeError(`Naming image ${index + 1} view must be 1-256 plain-text characters.`);
    }
    if (image.png.length < 24 || !image.png.subarray(0, 8).equals(PNG_SIGNATURE)
      || image.png.readUInt32BE(8) !== 13 || image.png.subarray(12, 16).toString('ascii') !== 'IHDR') {
      throw new TypeError(`Naming image ${index + 1} must contain a PNG signature and leading IHDR chunk.`);
    }
    const pngWidth = image.png.readUInt32BE(16);
    const pngHeight = image.png.readUInt32BE(20);
    if (pngWidth !== image.width || pngHeight !== image.height) {
      throw new RangeError(`Naming image ${index + 1} IHDR dimensions do not match its claimed dimensions.`);
    }
    return Object.freeze({
      png: Buffer.from(image.png),
      width: image.width,
      height: image.height,
      view: image.view,
      imageTokens: imageTokenCount(image.width, image.height),
    });
  });
}

function phaseSettings(phase) {
  const settings = NAMING_PHASE_POLICIES[phase];
  if (!settings || !Object.hasOwn(NAMING_PHASE_POLICIES, phase)) {
    throw new RangeError('Naming phase must be proposal or captions.');
  }
  return settings;
}

function estimateEnvelope(promptBytes, images, phase) {
  const settings = phaseSettings(phase);
  const imageTokens = images.reduce((sum, image) => sum + image.imageTokens, 0);
  const maxInputTokens = promptBytes + NAMING_POLICY.overheadTokenAllowance + imageTokens;
  const maxInputCostUsd = maxInputTokens * WORST_INPUT_USD_PER_MILLION / 1_000_000;
  const maxOutputCostUsd = settings.maxOutputTokens * OUTPUT_USD_PER_MILLION / 1_000_000;
  return Object.freeze({
    phase,
    promptBytes,
    imageCount: images.length,
    imageTokens,
    maxInputTokens,
    maxOutputTokens: settings.maxOutputTokens,
    worstInputUsdPerMillion: WORST_INPUT_USD_PER_MILLION,
    outputUsdPerMillion: OUTPUT_USD_PER_MILLION,
    maxInputCostUsd,
    maxOutputCostUsd,
    maxCostUsd: maxInputCostUsd + maxOutputCostUsd,
    pricingAsOf: NAMING_POLICY.pricingAsOf,
    basis: 'Conservative envelope at pinned published rates; not a billing guarantee if provider prices change.',
  });
}

export function createNamingStageBudget() {
  const phases = Object.freeze(Object.fromEntries(Object.entries(NAMING_PHASE_POLICIES).map(([phase, settings]) => [
    phase,
    estimateEnvelope(settings.maxPromptBytes, Array.from({ length: NAMING_POLICY.maxImages }, () => ({
      imageTokens: MAX_IMAGE_TOKENS / NAMING_POLICY.maxImages,
    })), phase),
  ])));
  const maxCostUsd = Object.values(phases).reduce((sum, budget) => sum + budget.maxCostUsd, 0);
  if (maxCostUsd > NAMING_POLICY.maxCostUsd) throw new RangeError('Combined naming stage exceeds the production cost ceiling.');
  return Object.freeze({
    phases,
    maxCostUsd,
    ceilingUsd: NAMING_POLICY.maxCostUsd,
    pricingAsOf: NAMING_POLICY.pricingAsOf,
    basis: 'Two fixed conservative phase envelopes at pinned published rates; reserve before either request.',
  });
}

export const NAMING_STAGE_ENVELOPE = createNamingStageBudget();

export function createNamingApiRequest(prompt, { images = [], phase = 'proposal' } = {}) {
  if (typeof prompt !== 'string') throw new TypeError('Naming prompt must be a string.');
  const settings = phaseSettings(phase);
  const preparedImages = validateNamingImages(images);
  const promptBytes = Buffer.byteLength(prompt, 'utf8');
  if (promptBytes > settings.maxPromptBytes) {
    throw new RangeError(`Naming ${phase} prompt exceeds the ${settings.maxPromptBytes.toLocaleString('en-US')}-byte production limit.`);
  }
  const budget = estimateEnvelope(promptBytes, preparedImages, phase);
  if (budget.maxCostUsd > settings.maxCostUsd) {
    throw new RangeError(`Naming ${phase} request exceeds its fixed production cost envelope.`);
  }
  return {
    body: Object.freeze({
      model: NAMING_POLICY.model,
      input: preparedImages.length ? Object.freeze([Object.freeze({
        role: 'user',
        content: Object.freeze([
          Object.freeze({ type: 'input_text', text: prompt }),
          ...preparedImages.map((image) => Object.freeze({
            type: 'input_image',
            image_url: `data:image/png;base64,${image.png.toString('base64')}`,
            detail: 'high',
          })),
        ]),
      })]) : prompt,
      reasoning: Object.freeze({ effort: NAMING_POLICY.reasoningEffort }),
      service_tier: NAMING_POLICY.serviceTier,
      max_output_tokens: settings.maxOutputTokens,
      tools: Object.freeze([]),
      store: false,
      stream: false,
      text: Object.freeze({ format: Object.freeze({ type: 'json_object' }) }),
    }),
    budget,
  };
}

export function estimateNamingUsageCost(usage) {
  return (usage.input_tokens * WORST_INPUT_USD_PER_MILLION
    + usage.output_tokens * OUTPUT_USD_PER_MILLION) / 1_000_000;
}
