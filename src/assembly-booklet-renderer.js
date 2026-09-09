import { ProductViewer } from './product-viewer.js';

export function bookletViewerOptions(spec, visibleModel) {
  return {
    frameModel: visibleModel,
    highlightIds: new Set(spec.highlight),
    insertionDirection: spec.insertionDirection,
    joinContext: spec.joinContext,
    animate: false,
  };
}

export function createBookletRenderer({ result, byId }) {
  const stage = document.createElement('div');
  stage.className = 'manual-render-stage';
  stage.setAttribute('aria-hidden', 'true');
  const source = document.createElement('canvas');
  stage.append(source);
  document.body.append(stage);
  const drawFailure = canvas => {
    const width = Math.max(1, canvas.parentElement?.clientWidth || 1);
    const height = Math.max(1, canvas.parentElement?.clientHeight || 1);
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#686864';
      context.font = '13px Helvetica, Arial, sans-serif';
      context.fillText('Preview unavailable', 12, 28);
    }
    canvas.dataset.renderError = 'true';
  };
  let viewer;
  try {
    viewer = new ProductViewer(source);
  } catch {
    stage.remove();
    return {
      observe(canvas) { drawFailure(canvas); },
      refreshWithin() {},
      dispose() {},
    };
  }
  const records = new Map();
  const pending = new Map();
  let frame = null;
  let disposed = false;
  const model = ids => ({ ...result.brickModel, bricks: ids.map(id => byId.get(id)).filter(Boolean) });

  function enqueue(canvas) {
    const record = records.get(canvas);
    if (disposed || !record?.visible || !canvas.isConnected) return;
    pending.set(canvas, record);
    if (frame === null) frame = requestAnimationFrame(flush);
  }
  function flush() {
    frame = null;
    const next = pending.entries().next().value;
    if (disposed || !next) return;
    const [canvas, record] = next;
    pending.delete(canvas);
    if (record.visible && canvas.isConnected) try {
      const wrap = canvas.parentElement;
      const width = Math.max(1, Math.round(wrap.clientWidth));
      const height = Math.max(1, Math.round(wrap.clientHeight));
      stage.style.width = `${width}px`; stage.style.height = `${height}px`; viewer.resize();
      const visibleModel = model(record.spec.visible);
      const retained = record.azimuth;
      viewer.azimuth = Math.PI * .75;
      viewer.setModel(visibleModel, bookletViewerOptions(record.spec, visibleModel));
      record.azimuth = retained ?? viewer.azimuth;
      viewer.azimuth = record.azimuth; viewer.updateCamera(); viewer.renderer.render(viewer.scene, viewer.camera);
      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.dataset.rendered = 'true'; canvas.dataset.azimuth = String(record.azimuth);
    } catch {
      drawFailure(canvas);
    }
    if (pending.size) frame = requestAnimationFrame(flush);
  }
  const intersection = new IntersectionObserver(entries => entries.forEach(entry => {
    const record = records.get(entry.target); if (!record) return;
    const reading = entry.target.closest('.manual-reading');
    record.visible = entry.isIntersecting && (!reading || reading.open);
    if (record.visible) enqueue(entry.target); else pending.delete(entry.target);
  }), { rootMargin: '100px 0px' });
  const sizes = new ResizeObserver(entries => entries.forEach(entry => enqueue(entry.target.querySelector('canvas'))));

  function observe(canvas, spec) {
    const record = { spec, visible: false, azimuth: undefined, drag: null, listeners: {} };
    record.listeners.down = event => {
      record.drag = { x: event.clientX, azimuth: record.azimuth ?? Math.PI * .75 };
      canvas.setPointerCapture(event.pointerId);
    };
    record.listeners.move = event => {
      if (!record.drag) return;
      record.azimuth = record.drag.azimuth - (event.clientX - record.drag.x) * .012;
      enqueue(canvas);
    };
    record.listeners.end = () => { record.drag = null; };
    record.listeners.key = event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const origin = Math.PI / 4;
      const quarter = Math.PI / 2;
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      record.azimuth = origin + (Math.round(((record.azimuth ?? Math.PI * .75) - origin) / quarter) + direction) * quarter;
      enqueue(canvas);
    };
    for (const [type, listener] of [['pointerdown', record.listeners.down], ['pointermove', record.listeners.move], ['pointerup', record.listeners.end], ['pointercancel', record.listeners.end], ['lostpointercapture', record.listeners.end], ['keydown', record.listeners.key]]) {
      canvas.addEventListener(type, listener);
    }
    records.set(canvas, record);
    intersection.observe(canvas);
    sizes.observe(canvas.parentElement);
  }
  function refreshWithin(container) {
    container.querySelectorAll('canvas').forEach(canvas => {
      const record = records.get(canvas);
      if (!record) return;
      const reading = canvas.closest('.manual-reading');
      const rect = canvas.getBoundingClientRect();
      record.visible = (!reading || reading.open) && rect.bottom >= 0 && rect.top <= innerHeight;
      if (record.visible) enqueue(canvas);
      else pending.delete(canvas);
    });
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    pending.clear();
    intersection.disconnect();
    sizes.disconnect();
    for (const [canvas, record] of records) {
      for (const [type, listener] of [['pointerdown', record.listeners.down], ['pointermove', record.listeners.move], ['pointerup', record.listeners.end], ['pointercancel', record.listeners.end], ['lostpointercapture', record.listeners.end], ['keydown', record.listeners.key]]) {
        canvas.removeEventListener(type, listener);
      }
    }
    records.clear();
    viewer.dispose();
    stage.remove();
  }
  return { observe, refreshWithin, dispose };
}
