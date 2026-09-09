import { createSavedDemoClient, DEMO_EXAMPLES } from './demo-client.js';

const EXAMPLE_TITLES = ['Cat', 'Red pickup', 'Dragon & lighthouse', 'Spaghetti', 'Nostalgia', 'Coral reef'];
const EXAMPLE_PROMPTS = ['cat', 'red pickup truck', 'dragon curled around a lighthouse', 'person eating spaghetti', 'nostalgia', 'an underwater research station built into a coral reef'];
export const EXAMPLE_SUMMARIES = DEMO_EXAMPLES.map((example, index) => ({
  id: `example-${example.name.replace(/\s+/g, '-')}`,
  title: EXAMPLE_TITLES[index],
  prompt: EXAMPLE_PROMPTS[index],
  example: true,
}));

export function createExampleClient(saved = createSavedDemoClient()) {
  const byId = new Map(EXAMPLE_SUMMARIES.map((item, index) => [item.id, DEMO_EXAMPLES[index]]));
  const cache = new Map();
  return {
    list: async () => ({ items: EXAMPLE_SUMMARIES, nextCursor: null }),
    getResult(id) {
      if (!cache.has(id)) {
        const example = byId.get(id);
        if (!example) return Promise.reject(new Error('That example is unavailable.'));
        cache.set(id, saved.generate(example.name).then(result => ({
          ...EXAMPLE_SUMMARIES.find(item => item.id === id),
          prompt: result.model.meta?.prompt ?? example.name, model: result.model, sourceProgram: result.sourceProgram ?? null,
          provenance: `Saved example · Shape ${result.example.shape}`, example: true,
        })).catch(error => { cache.delete(id); throw error; }));
      }
      return cache.get(id);
    },
  };
}
