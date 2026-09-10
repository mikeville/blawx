import { truncatePrompt } from './prompt-policy.js';

const MOBILE_QUERY = '(max-width: 760px)';
const INTERACTIVE_TARGETS = 'input, textarea, select, button, a[href], [contenteditable]:not([contenteditable="false"])';

/** Enhance the shared prompt textarea without owning its value or submission flow. */
export function mountPromptField({ input, form, publicNote } = {}) {
  const field = input?.closest?.('.prompt-field');
  if (!input || !form || !field) return { sync() {}, dispose() {} };

  const media = window.matchMedia(MOBILE_QUERY);
  let frame;
  let disposed = false;
  let observedWidth;

  function focusAtEnd() {
    if (input.disabled || input.readOnly) return;
    input.focus({ preventScroll: true });
    const end = input.value.length;
    input.setSelectionRange?.(end, end);
  }

  function clearDesktopSizing() {
    input.style.removeProperty('height');
    input.style.removeProperty('overflow-y');
    input.style.removeProperty('overflow-x');
  }

  function autosize() {
    if (media.matches) {
      input.wrap = 'off';
      clearDesktopSizing();
      return;
    }

    input.wrap = 'soft';
    const wasEditing = document.activeElement === input;
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const internalScrollTop = input.scrollTop;
    const caretIsAtEnd = wasEditing
      && input.selectionStart === input.selectionEnd
      && input.selectionEnd === input.value.length;
    input.style.height = '0px';
    const cssMaximum = Number.parseFloat(getComputedStyle(input).maxHeight);
    const maximum = Number.isFinite(cssMaximum) ? cssMaximum : input.scrollHeight;
    const height = Math.min(input.scrollHeight, maximum);
    input.style.height = `${height}px`;
    input.style.overflowY = input.scrollHeight > maximum ? 'auto' : 'hidden';
    input.style.overflowX = 'hidden';
    input.scrollTop = caretIsAtEnd
      ? Math.max(0, input.scrollHeight - input.clientHeight)
      : internalScrollTop;
    if (!wasEditing && (window.scrollX !== scrollX || window.scrollY !== scrollY)) {
      window.scrollTo(scrollX, scrollY);
    }
  }

  function sync() {
    if (disposed) return;
    const boundedValue = truncatePrompt(input.value);
    if (boundedValue !== input.value) {
      const selectionStart = Math.min(input.selectionStart ?? boundedValue.length, boundedValue.length);
      const selectionEnd = Math.min(input.selectionEnd ?? selectionStart, boundedValue.length);
      input.value = boundedValue;
      if (document.activeElement === input) input.setSelectionRange?.(selectionStart, selectionEnd);
    }
    const hasPrompt = Boolean(input.value.trim());
    form.classList.toggle('has-prompt', hasPrompt);
    field.classList.toggle('has-prompt', hasPrompt);
    if (publicNote) {
      publicNote.hidden = !hasPrompt;
      if (hasPrompt && publicNote.id) input.setAttribute('aria-describedby', publicNote.id);
      else input.removeAttribute('aria-describedby');
    } else {
      input.removeAttribute('aria-describedby');
    }
    autosize();
  }

  function schedule() {
    if (disposed || frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      sync();
    });
  }

  function onResizeObserved(entries) {
    const entry = entries.find(candidate => candidate.target === field);
    const width = entry?.contentRect?.width ?? field.getBoundingClientRect().width;
    if (width === observedWidth) return;
    observedWidth = width;
    schedule();
  }

  function onKeydown(event) {
    if (event.defaultPrevented || event.key !== 'Enter') return;
    if (event.isComposing || event.keyCode === 229) return;
    if (!media.matches && event.shiftKey) return;
    event.preventDefault();
    form.requestSubmit();
  }

  function onDocumentKeydown(event) {
    if (media.matches || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.isComposing || event.keyCode === 229 || document.activeElement === input) return;
    if (input.disabled || input.readOnly || field.closest?.('[hidden], [inert]')) return;
    if (event.key.length !== 1 && event.key !== 'Dead') return;
    const target = event.target ?? document.activeElement;
    if (target?.closest?.(INTERACTIVE_TARGETS)) return;
    focusAtEnd();
  }

  input.addEventListener('input', sync);
  input.addEventListener('keydown', onKeydown);
  document.addEventListener('keydown', onDocumentKeydown);
  window.addEventListener('resize', schedule);
  media.addEventListener('change', schedule);
  const observer = new ResizeObserver(onResizeObserved);
  observer.observe(field);
  document.fonts?.ready?.then(schedule, () => {});
  sync();

  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      input.removeEventListener('input', sync);
      input.removeEventListener('keydown', onKeydown);
      document.removeEventListener('keydown', onDocumentKeydown);
      window.removeEventListener('resize', schedule);
      media.removeEventListener('change', schedule);
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
    },
  };
}
