const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path d="M5 5.5h14M12 19V8.5m0 0-4 4m4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.5"/>
</svg>`;

export function mountBookletNavigation(host) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'manual-guide-top';
  button.style.backgroundColor = 'var(--paper, #f4f4f4)';
  button.style.color = 'var(--ink, #171612)';
  button.hidden = true;
  button.title = 'Back to top';
  button.setAttribute('aria-label', 'Back to top');
  button.innerHTML = ICON;
  document.body.append(button);
  let frame = null;
  let disposed = false;

  const baseline = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const fontSize = parseFloat(style.fontSize) || 15;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.2;
    return rect.top + (lineHeight - fontSize) / 2 + fontSize * .8;
  };
  const headerHeight = () => {
    const value = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-visible-height'));
    return Number.isFinite(value) ? value : 64;
  };
  function update() {
    if (disposed) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = null;
      const guide = host.querySelector('.manual-scroll');
      const chapters = [...host.querySelectorAll('.manual-chapter > summary')];
      if (!guide) { button.hidden = true; return; }
      const top = headerHeight();
      const pinned = chapters.filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.top <= top + 1 && rect.bottom > top;
      }).at(-1);
      const height = pinned?.getBoundingClientRect().height
        || (matchMedia('(max-width: 640px)').matches ? 64 : 72);
      host.style.setProperty('--manual-chapter-height', `${height}px`);
      if (pinned) {
        const label = pinned.querySelector(':scope > span') || pinned.querySelector('strong');
        button.style.setProperty('--manual-top-y', `${baseline(label) - 28.5}px`);
      }
      button.hidden = !pinned || guide.getBoundingClientRect().bottom <= top + height;
    });
  }
  function returnToTop() {
    window.scrollTo(0, 0);
    document.querySelector('#detail-title, .detail-copy h1, h1')?.focus({ preventScroll: true });
    update();
  }
  button.addEventListener('click', returnToTop);
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
  const mutations = new MutationObserver(update);
  mutations.observe(host, { subtree: true, childList: true });
  const sizes = new ResizeObserver(update);
  sizes.observe(host);
  host.addEventListener('toggle', update, true);
  update();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    mutations.disconnect();
    sizes.disconnect();
    host.removeEventListener('toggle', update, true);
    window.removeEventListener('scroll', update);
    window.removeEventListener('resize', update);
    button.removeEventListener('click', returnToTop);
    button.remove();
    host.style.removeProperty('--manual-chapter-height');
  };
}
