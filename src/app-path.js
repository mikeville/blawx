// Keep browser resources relative so the same build works at / and /blawx/.
// Vite supplies BASE_URL in a build; Node-based tests fall back to root.
const BUILD_BASE = import.meta.env?.BASE_URL ?? '/';

export function appResourcePath(path, base = BUILD_BASE) {
  const clean = String(path ?? '').replace(/^\/+/, '');
  const prefix = String(base || '/').endsWith('/') ? String(base || '/') : `${base}/`;
  return prefix === './' ? `./${clean}` : `${prefix}${clean}`;
}

export function isGenerationEnabled(env = import.meta.env ?? {}) {
  return env.DEV === true || env.VITE_GENERATION_ENABLED === 'true';
}

export function isLocalSemanticNamingEnabled(env = import.meta.env ?? {}) {
  return env.DEV === true;
}
