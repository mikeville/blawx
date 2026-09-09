export const DEMO_EXAMPLES = [
  { shape: 43, name: 'cat', aliases: ['a cat'] },
  { shape: 44, name: 'red pickup', aliases: ['pickup', 'pickup truck', 'red pickup truck'] },
  { shape: 45, name: 'dragon lighthouse', aliases: ['dragon', 'lighthouse', 'dragon around a lighthouse'] },
  { shape: 46, name: 'spaghetti', aliases: ['person eating spaghetti'] },
  { shape: 47, name: 'nostalgia', aliases: ['tv', 'television'] },
  { shape: 42, name: 'coral reef', aliases: ['reef', 'underwater research station'] },
];

export function normalizePrompt(value) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export function findDemoExample(prompt) {
  const query = normalizePrompt(prompt);
  return DEMO_EXAMPLES.find(({ name, aliases }) => [name, ...aliases].some((term) => normalizePrompt(term) === query)) ?? null;
}

export function createSavedDemoClient(fetchImpl = fetch) {
  return {
    async generate(prompt) {
      const example = findDemoExample(prompt);
      if (!example) {
        const error = new Error('This demo can load six saved examples. Live generation is not connected yet.');
        error.code = 'unsupported-demo-prompt';
        throw error;
      }
      const indexResponse = await fetchImpl('/examples/index.json');
      if (!indexResponse.ok) throw new Error('The saved example index could not be loaded.');
      const index = await indexResponse.json();
      const record = index.find((entry) => entry?.shape === example.shape
        || entry?.id === `shape-${String(example.shape).padStart(2, '0')}`);
      if (!record?.url) throw new Error(`Saved Shape ${example.shape} is unavailable.`);
      const modelResponse = await fetchImpl(record.url);
      if (!modelResponse.ok) throw new Error(`Saved Shape ${example.shape} could not be loaded.`);
      return { example, record, model: await modelResponse.json() };
    },
  };
}
