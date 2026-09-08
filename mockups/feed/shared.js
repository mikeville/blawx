// Saved research results for layout exploration; never calls a generator.
export const SETS = [
  { id: 'cat', shape: 43, title: 'Cat', prompt: 'cat' },
  { id: 'pickup', shape: 44, title: 'Red pickup', prompt: 'red pickup truck' },
  { id: 'dragon', shape: 45, title: 'Dragon & lighthouse', prompt: 'dragon curled around a lighthouse' },
  { id: 'spaghetti', shape: 46, title: 'Spaghetti', prompt: 'person eating spaghetti' },
  { id: 'tv', shape: 47, title: 'Nostalgia', prompt: 'nostalgia' },
  { id: 'reef', shape: 42, title: 'Coral reef', prompt: 'an underwater research station built into a coral reef' },
].map(set => ({ ...set, image: `/mockups/feed/assets/${set.id}.png` }));

export async function prepareImages() { return SETS; }
