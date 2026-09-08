const TOP_LINE_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 5.5h14M12 19V8.5m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter"/>
  </svg>`;

export function mountGuideNavigation({ host, detailView }) {
  if (!(host instanceof HTMLElement) || !(detailView instanceof HTMLElement)) {
    throw new TypeError('Guide navigation requires host and detailView elements.');
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'r2-guide-top';
  button.hidden = true;
  button.title = 'Back to top';
  button.setAttribute('aria-label', 'Back to top');
  button.innerHTML = TOP_LINE_ICON;
  document.body.append(button);

  let disposed = false;
  let frame;

  function textBaseline(element) {
    const rect = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const fontSize = Number.parseFloat(styles.fontSize) || 15;
    const parsedLineHeight = Number.parseFloat(styles.lineHeight);
    const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : fontSize * 1.2;
    return rect.top + ((lineHeight - fontSize) / 2) + (fontSize * .8);
  }

  function update() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const firstChapter = host.querySelector('.r2-guide__chapter');
      const guide = host.querySelector('.r2-guide__inner');
      const detailVisible = !detailView.hidden;
      if (!firstChapter || !guide || !detailVisible) {
        button.hidden = true;
        return;
      }

      const chapterTop = firstChapter.getBoundingClientRect().top;
      const guideBottom = guide.getBoundingClientRect().bottom;
      const summaries = [...host.querySelectorAll('.r2-guide__chapter > summary')];
      const pinned = summaries.filter(summary => {
        const rect = summary.getBoundingClientRect();
        return rect.top <= 65 && rect.bottom > 64;
      }).at(-1);
      const fallbackHeight = matchMedia('(max-width: 640px)').matches ? 64 : 72;
      const headingHeight = pinned?.getBoundingClientRect().height || fallbackHeight;
      host.style.setProperty('--r2-chapter-sticky-height', `${headingHeight}px`);

      if (pinned) {
        const label = pinned.querySelector(':scope > span') || pinned.querySelector(':scope > strong');
        if (label) {
          // The icon's lower stroke sits at 19/24 of its 22px drawing. Centering
          // that drawing in the target puts the target top about 28px above it.
          button.style.setProperty('--r2-guide-top-button-y', `${textBaseline(label) - 28.5}px`);
        }
      }
      button.hidden = !pinned || chapterTop > 64 || guideBottom <= 64 + headingHeight;
    });
  }

  function returnToTop() {
    window.scrollTo(0, 0);
    detailView.querySelector('#detail-title, h1')?.focus({ preventScroll: true });
    update();
  }

  button.addEventListener('click', returnToTop);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  const mutations = new MutationObserver(update);
  mutations.observe(host, { childList: true, subtree: true });
  const sizes = new ResizeObserver(update);
  sizes.observe(host);
  host.addEventListener('toggle', update, true);
  update();

  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sizes.disconnect();
      host.removeEventListener('toggle', update, true);
      host.style.removeProperty('--r2-chapter-sticky-height');
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      button.removeEventListener('click', returnToTop);
      button.remove();
    },
  };
}
