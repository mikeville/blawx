import { ProductViewer } from '../../../src/product-viewer.js';

function resultModel(result, byId, ids) {
  return {
    ...result.brickModel,
    kind: 'bricks',
    bricks: ids.map(id => byId.get(id)).filter(Boolean),
  };
}

export function createSharedGuideRenderer({ result, byId }) {
  const stage = document.createElement('div');
  stage.className = 'r2-guide__render-stage';
  stage.setAttribute('aria-hidden', 'true');
  const source = document.createElement('canvas');
  stage.append(source);
  document.body.append(stage);
  const viewer = new ProductViewer(source);
  const records = new Map();
  const pending = new Map();
  let frame = null;
  let disposed = false;

  function enqueue(canvas) {
    const record = records.get(canvas);
    if (disposed || !record?.visible || !canvas.isConnected) return;
    pending.set(canvas, record);
    if (frame === null) frame = requestAnimationFrame(flush);
  }

  function flush() {
    frame = null;
    if (disposed) return;
    const next = pending.entries().next().value;
    if (!next) return;
    const [canvas, record] = next;
    pending.delete(canvas);
    if (record.visible && canvas.isConnected) {
      const wrap = canvas.parentElement;
      const width = Math.max(1, Math.round(wrap.clientWidth));
      const height = Math.max(1, Math.round(wrap.clientHeight));
      stage.style.width = `${width}px`;
      stage.style.height = `${height}px`;
      viewer.resize();
      const model = resultModel(result, byId, record.spec.visible);
      const retainedAzimuth = record.azimuth;
      viewer.azimuth = Math.PI * .75;
      viewer.setModel(model, {
        frameModel: model,
        highlightIds: new Set(record.spec.highlight),
        insertionDirection: record.spec.insertionDirection,
        animate: false,
      });
      record.azimuth = retainedAzimuth ?? viewer.azimuth;
      viewer.azimuth = record.azimuth;
      viewer.updateCamera();
      viewer.renderer.render(viewer.scene, viewer.camera);

      const scale = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.dataset.azimuth = String(record.azimuth);
      canvas.dataset.rendered = 'true';
    }
    if (pending.size) frame = requestAnimationFrame(flush);
  }

  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target);
      if (!record) continue;
      const range = entry.target.closest('.r2-guide__range');
      record.visible = entry.isIntersecting && (!range || range.open);
      if (record.visible) enqueue(entry.target);
      else pending.delete(entry.target);
    }
  }, { rootMargin: '100px 0px' });

  const sizes = new ResizeObserver(entries => {
    for (const entry of entries) enqueue(entry.target.querySelector('canvas'));
  });

  function observe(canvas, spec) {
    const record = { spec, azimuth: undefined, visible: false, drag: null, listeners: {} };
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
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const origin = Math.PI / 4;
      const quarter = Math.PI / 2;
      const current = record.azimuth ?? Math.PI * .75;
      record.azimuth = origin + (Math.round((current - origin) / quarter) + direction) * quarter;
      enqueue(canvas);
    };
    canvas.addEventListener('pointerdown', record.listeners.down);
    canvas.addEventListener('pointermove', record.listeners.move);
    canvas.addEventListener('pointerup', record.listeners.end);
    canvas.addEventListener('pointercancel', record.listeners.end);
    canvas.addEventListener('lostpointercapture', record.listeners.end);
    canvas.addEventListener('keydown', record.listeners.key);
    records.set(canvas, record);
    intersection.observe(canvas);
    sizes.observe(canvas.parentElement);
  }

  function refreshWithin(container) {
    container.querySelectorAll('canvas').forEach(canvas => {
      const record = records.get(canvas);
      if (!record) return;
      const range = canvas.closest('.r2-guide__range');
      record.visible = (!range || range.open) && canvas.getBoundingClientRect().bottom >= 0
        && canvas.getBoundingClientRect().top <= innerHeight;
      if (record.visible) enqueue(canvas);
    });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    pending.clear();
    intersection.disconnect();
    sizes.disconnect();
    for (const [canvas, record] of records) {
      canvas.removeEventListener('pointerdown', record.listeners.down);
      canvas.removeEventListener('pointermove', record.listeners.move);
      canvas.removeEventListener('pointerup', record.listeners.end);
      canvas.removeEventListener('pointercancel', record.listeners.end);
      canvas.removeEventListener('lostpointercapture', record.listeners.end);
      canvas.removeEventListener('keydown', record.listeners.key);
    }
    records.clear();
    viewer.dispose();
    stage.remove();
  }

  return { observe, refreshWithin, dispose };
}
