import { createSemanticGuideClient } from '../../../src/semantic-guide-client.js';

const REVIEW_IDS = new Set(['consensus-v1']);
const STATIC_RECEIPT = /^\/semantic-guides\/([a-zA-Z0-9_-]+\.json)$/;

function notFound() {
  return Promise.resolve({
    status: 404,
    ok: false,
    async json() { return null; },
  });
}

export function semanticReviewId(search = '') {
  const requested = new URLSearchParams(search).get('naming-review');
  return REVIEW_IDS.has(requested) ? requested : null;
}

export function semanticReviewUrl(url, reviewId) {
  if (!REVIEW_IDS.has(reviewId)) return null;
  if (url === '/semantic-guides/index.json') {
    return `/semantic-guide-reviews/${reviewId}/index.json`;
  }
  const match = STATIC_RECEIPT.exec(url);
  return match ? `/semantic-guide-reviews/${reviewId}/${match[1]}` : null;
}

export function createSemanticReviewClient({ search = '', fetchImpl = fetch } = {}) {
  const reviewId = semanticReviewId(search);
  if (!reviewId) return { ...createSemanticGuideClient(fetchImpl), reviewId: null };

  const reviewFetch = (url, options) => {
    const mappedUrl = semanticReviewUrl(url, reviewId);
    return mappedUrl ? fetchImpl(mappedUrl, options) : notFound();
  };
  return { ...createSemanticGuideClient(reviewFetch), reviewId };
}
