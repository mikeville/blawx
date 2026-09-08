/**
 * Mount the optional floating prompt composer.
 *
 * `fixed` and `inline` deliberately retain the existing app behaviour. The
 * floating modes share behaviour but keep separate visual treatments. The
 * caller should invoke setRoute whenever its home/detail route changes.
 */
export function mountComposer({ composer, promptInput, form, mode = 'inline' }) {
  if (!composer || !promptInput || !form || !['floating', 'circle'].includes(mode)) {
    return { setRoute() {}, dispose() {} };
  }

  const promptField = promptInput.closest('.prompt-field');
  const makeButton = form.querySelector('.make-button');
  const formMessage = composer.querySelector('#form-message');
  if (!promptField || !makeButton) {
    return { setRoute() {}, dispose() {} };
  }

  const originalButtonText = makeButton.textContent;
  const originalPromptFieldId = promptField.id;
  promptField.id ||= 'composer-prompt-field';
  const originalMessageParent = formMessage?.parentNode;
  const originalMessageNext = formMessage?.nextSibling;
  const surface = document.createElement('div');
  surface.className = 'composer-surface';
  surface.setAttribute('aria-hidden', 'true');

  const closeButton = document.createElement('button');
  closeButton.className = 'composer-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close prompt');
  closeButton.innerHTML = '<span aria-hidden="true"></span>';

  const buttonLabel = document.createElement('span');
  buttonLabel.className = 'composer-button-label';
  buttonLabel.textContent = originalButtonText.trim() || 'Make it';
  const plus = document.createElement('span');
  plus.className = 'composer-plus';
  plus.setAttribute('aria-hidden', 'true');
  const studs = document.createElement('span');
  studs.className = 'composer-studs';
  studs.setAttribute('aria-hidden', 'true');
  studs.innerHTML = '<i></i><i></i>';
  makeButton.replaceChildren(studs, plus, buttonLabel);
  makeButton.setAttribute('aria-expanded', 'true');
  makeButton.setAttribute('aria-controls', promptField.id);
  makeButton.setAttribute('aria-label', 'Make this set');

  composer.prepend(surface);
  form.prepend(closeButton);
  if (formMessage) form.append(formMessage);
  composer.classList.add('floating-composer', `composer-${mode}`, 'is-expanded');

  let expanded = true;
  let disposed = false;

  function setExpanded(next, { focusInput = false, returnFocus = false } = {}) {
    if (disposed || expanded === next) {
      if (next && focusInput) promptInput.focus({ preventScroll: true });
      return;
    }
    expanded = next;
    composer.classList.toggle('is-expanded', expanded);
    composer.classList.toggle('is-collapsed', !expanded);
    makeButton.setAttribute('aria-expanded', String(expanded));
    makeButton.setAttribute('aria-label', expanded ? 'Make this set' : 'Open prompt');
    promptInput.disabled = !expanded;
    promptField.inert = !expanded;
    closeButton.disabled = !expanded;
    if (formMessage) formMessage.inert = !expanded;
    if (expanded && focusInput) promptInput.focus({ preventScroll: true });
    if (!expanded && returnFocus) makeButton.focus({ preventScroll: true });
  }

  function onSubmit(event) {
    if (expanded) return;
    // The app submit handler observes defaultPrevented and leaves opening to us.
    event.preventDefault();
    setExpanded(true, { focusInput: true });
  }

  function onClose() {
    setExpanded(false, { returnFocus: true });
  }

  function onKeydown(event) {
    if (event.key !== 'Escape' || !expanded) return;
    event.preventDefault();
    setExpanded(false, { returnFocus: true });
  }

  form.addEventListener('submit', onSubmit, { capture: true });
  closeButton.addEventListener('click', onClose);
  composer.addEventListener('keydown', onKeydown);

  return {
    setRoute(isDetail) {
      if (isDetail) setExpanded(false);
    },
    dispose() {
      if (disposed) return;
      form.removeEventListener('submit', onSubmit, { capture: true });
      closeButton.removeEventListener('click', onClose);
      composer.removeEventListener('keydown', onKeydown);
      promptInput.disabled = false;
      promptField.inert = false;
      if (formMessage) {
        formMessage.inert = false;
        originalMessageParent?.insertBefore(formMessage, originalMessageNext);
      }
      makeButton.replaceChildren(originalButtonText);
      makeButton.removeAttribute('aria-expanded');
      makeButton.removeAttribute('aria-controls');
      makeButton.removeAttribute('aria-label');
      if (!originalPromptFieldId) promptField.removeAttribute('id');
      closeButton.remove();
      surface.remove();
      composer.classList.remove('floating-composer', `composer-${mode}`, 'is-expanded', 'is-collapsed');
      disposed = true;
    },
  };
}
