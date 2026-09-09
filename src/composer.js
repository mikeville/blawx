/** Mount the floating composer studies without changing inline/fixed modes. */
export function mountComposer({ composer, promptInput, form, mode = 'inline', homeHost } = {}) {
  if (!composer || !promptInput || !form || !['floating', 'circle'].includes(mode)) {
    return { setRoute() {}, dispose() {} };
  }
  const promptField = promptInput.closest('.prompt-field');
  const makeButton = form.querySelector('.make-button');
  const formMessage = composer.querySelector('#form-message');
  if (!promptField || !makeButton) return { setRoute() {}, dispose() {} };

  const originalParent = composer.parentNode;
  const originalNext = composer.nextSibling;
  const desktopHost = homeHost || originalParent;
  const marker = document.createComment('composer-home-position');
  originalParent?.insertBefore(marker, composer);
  const mobile = window.matchMedia('(max-width: 760px)');
  const originalButtonText = makeButton.textContent;
  const originalPromptFieldId = promptField.id;
  const originalButtonLabel = makeButton.getAttribute('aria-label');
  const originalMessageParent = formMessage?.parentNode;
  const originalMessageNext = formMessage?.nextSibling;
  let latestIsDetail = /^#set\//.test(window.location.hash);
  let mobileHomeExpanded = true;
  let expanded = true;
  let enhanced = false;
  let disposed = false;
  let surface;
  let closeButton;

  function enhance() {
    if (enhanced || disposed) return;
    promptField.id ||= 'composer-prompt-field';
    surface = document.createElement('div');
    surface.className = 'composer-surface';
    surface.setAttribute('aria-hidden', 'true');
    closeButton = document.createElement('button');
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
    makeButton.setAttribute('aria-controls', promptField.id);
    composer.prepend(surface);
    form.prepend(closeButton);
    if (formMessage) form.append(formMessage);
    composer.classList.add('floating-composer', `composer-${mode}`);
    closeButton.addEventListener('click', onClose);
    enhanced = true;
  }

  function setExpanded(next, { focusInput = false, returnFocus = false } = {}) {
    if (!enhanced || disposed) return;
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

  function unenhance() {
    if (!enhanced) return;
    closeButton.removeEventListener('click', onClose);
    promptInput.disabled = false;
    promptField.inert = false;
    if (formMessage) {
      formMessage.inert = false;
      originalMessageParent?.insertBefore(formMessage, originalMessageNext);
    }
    makeButton.replaceChildren(originalButtonText);
    makeButton.removeAttribute('aria-expanded');
    makeButton.removeAttribute('aria-controls');
    if (originalButtonLabel === null) makeButton.removeAttribute('aria-label');
    else makeButton.setAttribute('aria-label', originalButtonLabel);
    if (!originalPromptFieldId) promptField.removeAttribute('id');
    closeButton.remove();
    surface.remove();
    composer.classList.remove('floating-composer', `composer-${mode}`, 'is-expanded', 'is-collapsed');
    enhanced = false;
  }

  function moveHome() {
    if (marker.parentNode) marker.parentNode.insertBefore(composer, marker.nextSibling);
    else if (desktopHost) desktopHost.insertBefore(composer, originalNext);
  }

  function syncContext() {
    if (mode === 'floating') {
      enhance();
      setExpanded(latestIsDetail ? false : expanded);
      return;
    }
    if (mobile.matches) {
      document.body.append(composer);
      enhance();
      setExpanded(latestIsDetail ? false : mobileHomeExpanded);
    } else {
      if (enhanced && !latestIsDetail) mobileHomeExpanded = expanded;
      if (latestIsDetail && composer.contains(document.activeElement)) promptInput.blur();
      unenhance();
      moveHome();
    }
  }

  function onSubmit(event) {
    if (!enhanced || expanded) return;
    event.preventDefault();
    if (!latestIsDetail) mobileHomeExpanded = true;
    setExpanded(true, { focusInput: true });
  }
  function onClose() {
    if (!latestIsDetail) mobileHomeExpanded = false;
    setExpanded(false, { returnFocus: true });
  }
  function onKeydown(event) {
    if (event.key !== 'Escape' || !enhanced || !expanded) return;
    event.preventDefault();
    onClose();
  }
  function onMediaChange() { syncContext(); }

  form.addEventListener('submit', onSubmit, { capture: true });
  composer.addEventListener('keydown', onKeydown);
  if (mode === 'circle') mobile.addEventListener('change', onMediaChange);
  syncContext();

  return {
    setRoute(isDetail) {
      latestIsDetail = Boolean(isDetail);
      if (enhanced) setExpanded(latestIsDetail ? false : mobileHomeExpanded);
    },
    dispose() {
      if (disposed) return;
      form.removeEventListener('submit', onSubmit, { capture: true });
      composer.removeEventListener('keydown', onKeydown);
      if (mode === 'circle') mobile.removeEventListener('change', onMediaChange);
      unenhance();
      if (mode === 'circle') moveHome();
      marker.remove();
      disposed = true;
    },
  };
}
