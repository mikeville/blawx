export function homeHref(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname || './';
  return `${pathname}${locationLike?.search || ''}`;
}

export function resultHref(id) {
  return `#set/${encodeURIComponent(id)}`;
}

export function hasModifiedLinkIntent(event = {}) {
  return Boolean(
    event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
    || (typeof event.button === 'number' && event.button !== 0)
  );
}

export function shouldHandleLinkClick(event = {}) {
  return event.defaultPrevented !== true && !hasModifiedLinkIntent(event);
}
