import { join, resolve } from 'node:path';
import { createGenerationService, GenerationError } from './generation-service.js';
import { createCachedGenerationService, createGenerationVersion } from './cached-generation-service.js';
import { createResultStore } from './result-store.js';
import { createSemanticGuideService } from './semantic-guide-service.js';
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
  try {
    semantic = semanticFactory({
      root,
      dataRoot: privateRoot,
      allowTestDataRoot,
      isGenerationBusy: () => generation?.isBusy() ?? Boolean(rawGenerator.isBusy?.()),
    });
    generation = createCachedGenerationService({
      store, generationVersion: version,
      generator: {
        generate(input, options) {
          if (semantic.isBusy()) throw new GenerationError('busy', 'Another local model request is already running.', null);
          return rawGenerator.generate(input, options);
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
