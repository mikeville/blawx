function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeGenerationPrompt(value) {
  if (typeof value !== 'string') throw new TypeError('cache_prompt_required');
  const prompt = value.trim().replace(/\s+/gu, ' ');
  if (!prompt) throw new TypeError('cache_prompt_required');
  return prompt.toLowerCase();
}

export async function createPublicGenerationVersion({ promptTemplate, policy, schemaVersion = 'voxel-model-v1' }) {
  if (typeof promptTemplate !== 'string' || !promptTemplate) throw new TypeError('cache_template_required');
  const templateHash = await digest(promptTemplate);
  const versionHash = await digest(JSON.stringify(stable({ policy, schemaVersion, templateHash })));
  return `raw-${versionHash}`;
}

export async function createPublicGenerationCacheKey({ prompt, generationVersion, options = {} }) {
  if (typeof generationVersion !== 'string' || !generationVersion) throw new TypeError('cache_version_required');
  return digest(JSON.stringify(stable({
    generationVersion,
    options,
    prompt: normalizeGenerationPrompt(prompt),
  })));
}
