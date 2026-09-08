import { SETS } from '../shared.js';
export { SETS };

// Editorial choices are independent from creation order.
export const FEATURED_IDS = ['dragon', 'cat', 'tv'];
export const RECENT_IDS = ['tv', 'spaghetti', 'dragon', 'pickup', 'cat', 'reef'];
const results = new Map();

export function getSavedResult(id) {
  if (!SETS.some(set => set.id === id)) return Promise.reject(new Error('Unknown saved set.'));
  if (!results.has(id)) {
    results.set(id, fetch(new URL(`./data/${id}.json`, import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error('This saved set could not load.');
        return response.json();
      }).catch(error => { results.delete(id); throw error; }));
  }
  return results.get(id);
}
