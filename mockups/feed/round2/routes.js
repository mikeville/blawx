const SET_HASH = /^#set\/([A-Za-z0-9_-]+)$/;

export function normalizeSetHash(hash) {
  if (hash == null || hash === '' || hash === '#') return '';
  const candidate = String(hash).startsWith('#') ? String(hash) : `#${hash}`;
  const match = candidate.match(SET_HASH);
  return match ? `#set/${match[1]}` : '';
}

function routeUrl(hash) {
  return `${window.location.pathname}${window.location.search}${hash}`;
}

function hasSameOriginParent() {
  if (window.parent === window) return false;
  try {
    return window.parent.location.origin === window.location.origin;
  } catch {
    return false;
  }
}

export function mountAppRoutes({ onChange }) {
  if (typeof onChange !== 'function') throw new TypeError('mountAppRoutes requires onChange.');

  const parentPreview = new URLSearchParams(window.location.search).get('preview') === '1'
    && hasSameOriginParent();
  let disposed = false;

  function currentHash() {
    return normalizeSetHash(window.location.hash);
  }

  function navigate(hash, { replace = false } = {}) {
    if (disposed) return;
    const canonical = normalizeSetHash(hash);
    if (canonical === currentHash()) return;

    if (parentPreview) {
      window.parent.postMessage({ type: 'blawx:navigate', hash: canonical, replace }, window.location.origin);
      return;
    }

    if (replace) {
      window.history.replaceState(null, '', routeUrl(canonical));
      onChange(canonical);
      return;
    }
    window.location.hash = canonical;
  }

  function handleHashChange() {
    if (!disposed && !parentPreview) onChange(currentHash());
  }

  function handleMessage(event) {
    if (disposed || !parentPreview || event.source !== window.parent || event.origin !== window.location.origin) return;
    if (event.data?.type !== 'blawx:route') return;
    const canonical = normalizeSetHash(event.data.hash);
    if (canonical === currentHash()) return;
    window.history.replaceState(null, '', routeUrl(canonical));
    onChange(canonical);
  }

  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('message', handleMessage);
  if (parentPreview) {
    window.parent.postMessage({ type: 'blawx:ready' }, window.location.origin);
  }

  return {
    navigate,
    dispose() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener('hashchange', handleHashChange);
      window.removeEventListener('message', handleMessage);
    },
  };
}
