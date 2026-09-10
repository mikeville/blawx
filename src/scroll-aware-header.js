/**
 * Mount a header which tracks the direction and distance of page scrolling.
 *
 * The controller deliberately has no animation of its own: each frame applies
 * the amount of movement observed since the previous frame.  This keeps the
 * interaction tied to the scroll position (and therefore also respects reduced
 * motion preferences without needing a separate media-query branch).
 */
export function mountScrollAwareHeader(
  header,
  {
    win = typeof window === 'undefined' ? globalThis : window,
    doc = typeof document === 'undefined' ? undefined : document,
    raf,
    caf,
  } = {},
) {
  if (!header || !header.style) throw new TypeError('A header element is required');

  const requestFrame = raf || win?.requestAnimationFrame?.bind(win) || ((callback) => setTimeout(callback, 0));
  const cancelFrame = caf || win?.cancelAnimationFrame?.bind(win) || clearTimeout;
  const root = doc?.documentElement;
  let disposed = false;
  let frame = null;
  let offset = 0;
  let height = measureHeight();
  let previousY = readScrollY();
  let pendingY = previousY;

  function measureHeight() {
    const measured = Number(header.getBoundingClientRect?.().height ?? header.offsetHeight ?? 0);
    return Number.isFinite(measured) && measured >= 0 ? measured : 0;
  }

  function readScrollY() {
    const value = Number(win?.scrollY ?? win?.pageYOffset ?? 0);
    return Number.isFinite(value) ? value : 0;
  }

  function publish() {
    const visible = Math.max(0, height - offset);
    root?.style?.setProperty('--header-visible-height', `${visible}px`);
  }

  function apply(y = readScrollY()) {
    if (disposed) return;
    height = measureHeight();
    if (y <= 0) {
      offset = 0;
    } else {
      offset = Math.min(height, Math.max(0, offset + (y - previousY)));
    }
    previousY = y;
    pendingY = y;
    header.style.setProperty('transform', offset ? `translateY(-${offset}px)` : 'translateY(0)');
    publish();
  }

  function flush() {
    frame = null;
    apply(pendingY);
  }

  function schedule() {
    if (frame === null) frame = requestFrame(flush);
  }

  function onScroll() {
    pendingY = readScrollY();
    schedule();
  }

  function onResize() {
    pendingY = readScrollY();
    schedule();
  }

  function sync() {
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
    apply(readScrollY());
  }

  apply(previousY);
  header.style.setProperty('will-change', 'transform');
  win?.addEventListener?.('scroll', onScroll, { passive: true });
  win?.addEventListener?.('resize', onResize);

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame !== null) cancelFrame(frame);
    win?.removeEventListener?.('scroll', onScroll, { passive: true });
    win?.removeEventListener?.('resize', onResize);
    header.style.removeProperty('transform');
    header.style.removeProperty('will-change');
    root?.style?.removeProperty('--header-visible-height');
  }

  return { dispose, sync };
}
