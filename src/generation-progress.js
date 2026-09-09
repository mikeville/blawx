const PHASES = Object.freeze([
  Object.freeze({ key: 'designing', label: 'Designing' }),
  Object.freeze({ key: 'bricks', label: 'Choosing bricks' }),
  Object.freeze({ key: 'guide', label: 'Preparing guide' }),
]);

export function formatGenerationElapsed(milliseconds) {
  const seconds = Math.max(0, Math.floor(Number(milliseconds) / 1000) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function normalizedEstimate(range) {
  if (!Array.isArray(range) || range.length !== 2) return null;
  const [minimum, maximum] = range.map(Number);
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 0 || maximum < minimum) return null;
  return { minimum: Math.round(minimum), maximum: Math.round(maximum) };
}

export function mountGenerationProgress(host, {
  onCancel,
  estimateRange = null,
  now = () => performance.now(),
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
} = {}) {
  host.innerHTML = `<div class="generation-progress">
    <ol aria-label="Set progress">
      ${PHASES.map(({ key, label }) => `<li data-phase="${key}"><span class="generation-progress-node" aria-hidden="true"></span><span>${label}</span></li>`).join('')}
    </ol>
    <p class="generation-elapsed"></p>
    <button class="generation-cancel" type="button">Cancel</button>
    <span class="sr-only generation-phase-live" role="status" aria-live="polite" aria-atomic="true"></span>
  </div>`;
  const root = host.querySelector('.generation-progress');
  const items = [...root.querySelectorAll('[data-phase]')];
  const elapsed = root.querySelector('.generation-elapsed');
  const live = root.querySelector('.generation-phase-live');
  const cancel = root.querySelector('.generation-cancel');
  const startedAt = now();
  const estimate = normalizedEstimate(estimateRange);
  let current = '';
  let disposed = false;

  function updateElapsed() {
    const duration = now() - startedAt;
    const seconds = Math.max(0, Math.floor(duration / 1000));
    const timing = !estimate
      ? ''
      : seconds > estimate.maximum
        ? ' · longer than estimated'
        : ` · usually ${estimate.minimum}–${estimate.maximum}s`;
    elapsed.textContent = `${formatGenerationElapsed(duration)} elapsed${timing}`;
  }

  function setPhase(key) {
    if (disposed || key === current) return;
    const index = PHASES.findIndex(phase => phase.key === key);
    if (index < 0) return;
    current = key;
    items.forEach((item, itemIndex) => {
      item.dataset.state = itemIndex < index ? 'complete' : itemIndex === index ? 'current' : 'future';
      if (itemIndex === index) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
    });
    live.textContent = PHASES[index].label;
  }

  function dispose({ clear = true } = {}) {
    if (disposed) return;
    disposed = true;
    clearIntervalFn(timer);
    cancel.removeEventListener('click', onCancelClick);
    if (clear) host.replaceChildren();
  }

  function onCancelClick() {
    if (!disposed) onCancel?.();
  }

  cancel.addEventListener('click', onCancelClick);
  setPhase('designing');
  updateElapsed();
  const timer = setIntervalFn(updateElapsed, 1000);

  return {
    setPhase,
    complete() {
      dispose();
    },
    dispose,
  };
}
