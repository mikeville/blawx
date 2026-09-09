const MAX_PROMPT_LENGTH = 10_000;

export function viewStateKey(mode) {
  return `blawx-feed-view:${String(mode || 'default')}`;
}

function bounds(recentCount) {
  const maximum = Number.isInteger(recentCount) && recentCount >= 0 ? recentCount : 0;
  return { minimum: Math.min(3, maximum), maximum };
}

export function normalizeViewState(value, recentCount) {
  const source = value && typeof value === 'object' ? value : {};
  const { minimum, maximum } = bounds(recentCount);
  const prompt = typeof source.prompt === 'string' && source.prompt.length <= MAX_PROMPT_LENGTH
    ? source.prompt
    : '';
  const requestedCount = Number.isInteger(source.galleryCount) ? source.galleryCount : minimum;
  const galleryCount = Math.min(maximum, Math.max(minimum, requestedCount));
  const homeScrollY = Number.isFinite(source.homeScrollY) && source.homeScrollY >= 0
    ? source.homeScrollY
    : 0;
  return { prompt, galleryCount, homeScrollY };
}

function availableStorage(storage) {
  if (storage) return storage;
  try { return globalThis.sessionStorage; } catch { return undefined; }
}

export function loadViewState({ mode, recentCount, storage } = {}) {
  const fallback = normalizeViewState({}, recentCount);
  try {
    const raw = availableStorage(storage)?.getItem(viewStateKey(mode));
    if (!raw) return fallback;
    return normalizeViewState(JSON.parse(raw), recentCount);
  } catch {
    return fallback;
  }
}

export function saveViewState({ mode, recentCount, state, storage } = {}) {
  try {
    const target = availableStorage(storage);
    if (!target) return false;
    target.setItem(viewStateKey(mode), JSON.stringify(normalizeViewState(state, recentCount)));
    return true;
  } catch {
    return false;
  }
}
