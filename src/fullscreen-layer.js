import './fullscreen-layer.css';

let activeLayer = null;

function focusableElements(root) {
  return [...root.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

export function openFullscreenLayer({
  content,
  className = '',
  label,
  returnFocus = document.activeElement,
  onClose = null,
}) {
  activeLayer?.close({ restoreFocus: false });

  const layer = document.createElement('section');
  layer.className = `fullscreen-layer ${className}`.trim();
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-modal', 'true');
  layer.setAttribute('aria-label', label);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'fullscreen-layer-close';
  closeButton.setAttribute('aria-label', `Close ${label}`);
  closeButton.innerHTML = '<span aria-hidden="true">×</span>';

  const inner = document.createElement('div');
  inner.className = 'fullscreen-layer-inner';
  inner.append(content);
  layer.append(closeButton, inner);

  const app = document.querySelector('#app');
  const background = app?.querySelector('main') ?? app;
  const backgroundWasInert = background?.inert ?? false;
  (app ?? document.body).append(layer);
  if (background) background.inert = true;
  document.body.classList.add('has-fullscreen-layer');
  let closed = false;

  function close({ restoreFocus = true } = {}) {
    if (closed) return;
    closed = true;
    layer.removeEventListener('keydown', onKeydown);
    closeButton.removeEventListener('click', close);
    onClose?.();
    layer.remove();
    if (background) background.inert = backgroundWasInert;
    document.body.classList.remove('has-fullscreen-layer');
    if (activeLayer?.element === layer) activeLayer = null;
    if (restoreFocus && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(layer);
    if (!focusable.length) {
      event.preventDefault();
      closeButton.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  closeButton.addEventListener('click', close);
  layer.addEventListener('keydown', onKeydown);
  closeButton.focus({ preventScroll: true });
  activeLayer = { element: layer, close };
  return activeLayer;
}
