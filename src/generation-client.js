import { validateVoxels } from './voxels.js';
import { appResourcePath } from './app-path.js';
import { MAX_PROMPT_CHARACTERS, PROMPT_TOO_LONG_MESSAGE, promptCharacterCount } from './prompt-policy.js';

export class GenerationClientError extends Error {
  constructor(message, { code = 'generation-failed', status = null, requestId = null, cause } = {}) {
    super(message, { cause });
    this.name = 'GenerationClientError';
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readJson(response) {
  try {
    return await response.json();
  } catch (cause) {
    throw new GenerationClientError('The generator returned an unreadable response.', {
      code: 'malformed-response', status: response.status, cause,
    });
  }
}

export function createGenerationClient(fetchImpl = fetch, endpoint = appResourcePath('api/generate')) {
  return {
    async generate(prompt, { signal } = {}) {
      const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
      if (!normalizedPrompt) throw new GenerationClientError('Enter a name for your set.', { code: 'invalid-prompt' });
      if (promptCharacterCount(normalizedPrompt) > MAX_PROMPT_CHARACTERS) {
        throw new GenerationClientError(PROMPT_TOO_LONG_MESSAGE, { code: 'prompt-too-long' });
      }

      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt: normalizedPrompt }),
          signal,
        });
      } catch (cause) {
        if (cause?.name === 'AbortError') throw cause;
        throw new GenerationClientError('The local generator could not be reached.', { code: 'network-error', cause });
      }

      const payload = await readJson(response);
      if (!response.ok) {
        const error = isRecord(payload?.error) ? payload.error : {};
        throw new GenerationClientError(
          typeof error.message === 'string' && error.message.trim() ? error.message : 'The set could not be generated.',
          {
            code: typeof error.code === 'string' ? error.code : 'generation-failed',
            status: response.status,
            requestId: typeof payload?.requestId === 'string' ? payload.requestId : null,
          },
        );
      }

      if (!isRecord(payload) || typeof payload.requestId !== 'string' || typeof payload.prompt !== 'string' || !isRecord(payload.model)
        || (payload.sourceProgram != null && !isRecord(payload.sourceProgram)) || !isRecord(payload.diagnostics) || !isRecord(payload.metadata)
        || (payload.resultId != null && typeof payload.resultId !== 'string')
        || (payload.cacheHit != null && typeof payload.cacheHit !== 'boolean')
        || (payload.saveStatus != null && !['saved', 'failed'].includes(payload.saveStatus))) {
        throw new GenerationClientError('The generator returned an incomplete result.', { code: 'malformed-response', status: response.status });
      }
      const validation = validateVoxels(payload.model);
      if (!validation.valid) {
        throw new GenerationClientError('The generated shape was not safe to preview.', { code: 'invalid-model', status: response.status, requestId: payload.requestId });
      }
      return payload;
    },
  };
}

export function createStaticGenerationClient() {
  return {
    async generate() {
      throw new GenerationClientError(
        'Live generation is being prepared. Explore the saved sets below, or clone the repo and use your own API key to generate freely.',
        { code: 'static-demo' },
      );
    },
  };
}
