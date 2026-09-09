// CSS owns stable first-screen framing; this only lifts the mobile dock above
// an overlaid keyboard and reserves its actual height at the end of the feed.
export function keyboardInset({ focused, layoutHeight, visibleHeight, offsetTop = 0, scale = 1 }) {
  if (!focused || Math.abs(scale - 1) > 0.01) return 0;
  const hiddenHeight = layoutHeight - visibleHeight - offsetTop;
  // Browser toolbar movement is not a keyboard. Resizing-layout browsers
  // already move fixed elements themselves and therefore produce zero here.
  return Number.isFinite(hiddenHeight) && hiddenHeight > 120 ? Math.round(hiddenHeight) : 0;
}

export function mountViewportLayout({ composer, promptInput }) {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  const mobile = window.matchMedia('(max-width: 760px)');
  let frame;

  function writeProperty(name, value) {
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  }

  function update() {
    frame = undefined;
    const height = composer.getBoundingClientRect().height;
    // A hidden home view must not erase the reserved size on its return.
    if (height > 0) writeProperty('--dock-height', `${Math.ceil(height)}px`);
    const floating = ['floating', 'circle'].includes(document.body.dataset.composer);
    const inset = viewport && (mobile.matches || floating) ? keyboardInset({
      focused: document.activeElement === promptInput,
      layoutHeight: window.innerHeight,
      visibleHeight: viewport.height,
      offsetTop: viewport.offsetTop,
      scale: viewport.scale,
    }) : 0;
    writeProperty('--keyboard-inset', `${inset}px`);
  }

  function schedule() {
    if (frame === undefined) frame = requestAnimationFrame(update);
  }

  const observer = new ResizeObserver(schedule);
  observer.observe(composer);
  const listeners = [
    [window, 'resize'], [viewport, 'resize'], [viewport, 'scroll'],
    [promptInput, 'focus'], [promptInput, 'blur'],
  ];
  for (const [target, event] of listeners) target?.addEventListener(event, schedule);
  update();

  return {
    dispose() {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
      for (const [target, event] of listeners) target?.removeEventListener(event, schedule);
      root.style.removeProperty('--dock-height');
      root.style.removeProperty('--keyboard-inset');
    },
  };
}
