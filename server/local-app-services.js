import { join, resolve } from 'node:path';
import { createGenerationService, GenerationError } from './generation-service.js';
import { createCachedGenerationService, createGenerationVersion } from './cached-generation-service.js';
import { createResultStore } from './result-store.js';
import { createSemanticGuideService } from './semantic-guide-service.js';
import { SEMANTIC_NAMING_STRATEGY } from '../src/semantic-naming-version.js';
import { ensurePrivateDirectory, resolvePrivateDataRoot } from './private-data-root.js';

const DEFAULT_ROOT = resolve(import.meta.dirname, '..');

// The cache sits outside the provider concurrency gate: browsing and reuse stay
// available while an independent semantic-name request owns the local provider.
export async function createLocalAppServices({
  root = DEFAULT_ROOT,
  dataRoot,
  allowTestDataRoot = false,
  generator,
  semanticFactory = createSemanticGuideService,
  storeFactory = createResultStore,
  generationVersion,
} = {}) {
  const privateRoot = resolvePrivateDataRoot({ sourceRoot: root, dataRoot, allowTestDataRoot });
  await ensurePrivateDirectory(privateRoot);
  const rawGenerator = generator ?? createGenerationService({
    root,
    dataRoot: privateRoot,
    allowTestDataRoot,
  });
  const version = generationVersion ?? await createGenerationVersion({ root });
  const store = await storeFactory({
    databasePath: join(privateRoot, 'feed', 'results.sqlite'),
    sourceRoot: root,
    allowTestDataRoot,
  });
  let generation;
  let semantic;
  let generationRequested = false;
  try {
    semantic = semanticFactory({
      root,
      dataRoot: privateRoot,
      allowTestDataRoot,
      isGenerationBusy: () => generationRequested
        || (generation?.isBusy() ?? Boolean(rawGenerator.isBusy?.())),
      allowExperimentalInference: true,
      strategy: SEMANTIC_NAMING_STRATEGY,
    });
    generation = createCachedGenerationService({
      store, generationVersion: version,
      generator: {
        async generate(input, options) {
          generationRequested = true;
          try {
            if (semantic.isInferenceBusy?.()) {
              const settled = semantic.cancelAndWait
                ? await semantic.cancelAndWait({ timeoutMs: 1_000 })
                : (semantic.cancel(), !semantic.isInferenceBusy?.());
              if (!settled || semantic.isInferenceBusy?.()) {
                throw new GenerationError('busy', 'Another local model request is already running.', null);
              }
            }
            return await rawGenerator.generate(input, options);
          } finally {
            generationRequested = false;
          }
        },
        isBusy: () => Boolean(rawGenerator.isBusy?.()),
      },
    });
  } catch (error) {
    store.close();
    throw error;
  }
  let closing;
  return {
    generation, semantic, store,
    close() {
      if (!closing) {
        semantic.cancel();
        closing = generation.close().finally(() => store.close());
      }
      return closing;
    },
  };
}
