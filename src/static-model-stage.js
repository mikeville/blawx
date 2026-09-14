import { brickPreviewData, voxelPreviewData } from './brick-preview.js';
import { PALETTE } from './geometry.js';

const ISO_X = Math.sqrt(3) / 2;
const PADDING = 24;

function geometryFor(model) {
  return model.kind === 'bricks' ? brickPreviewData(model) : voxelPreviewData(model);
}

function project({ x, y, z }) {
  return { x: (x - z) * ISO_X, y: (x + z) * 0.5 - y };
}

function corners(body) {
  const minX = body.x - body.w / 2;
  const maxX = body.x + body.w / 2;
  const minY = body.y - body.h / 2;
  const maxY = body.y + body.h / 2;
  const minZ = body.z - body.d / 2;
  const maxZ = body.z + body.d / 2;
  return {
    top: [
      { x: minX, y: maxY, z: minZ }, { x: maxX, y: maxY, z: minZ },
      { x: maxX, y: maxY, z: maxZ }, { x: minX, y: maxY, z: maxZ },
    ],
    left: [
      { x: minX, y: minY, z: maxZ }, { x: minX, y: maxY, z: maxZ },
      { x: maxX, y: maxY, z: maxZ }, { x: maxX, y: minY, z: maxZ },
    ],
    right: [
      { x: maxX, y: minY, z: minZ }, { x: maxX, y: maxY, z: minZ },
      { x: minX, y: maxY, z: minZ }, { x: minX, y: minY, z: minZ },
    ],
  };
}

function colorChannels(value) {
  const hex = (PALETTE[value] ?? value ?? '#ff3b80').replace('#', '');
  const normalized = hex.length === 3 ? [...hex].map(part => part + part).join('') : hex;
  const number = Number.parseInt(normalized, 16);
  return Number.isFinite(number)
    ? [(number >> 16) & 255, (number >> 8) & 255, number & 255]
    : [255, 59, 128];
}

function shade(color, amount) {
  const channels = colorChannels(color).map(value => Math.round(value * amount));
  return `rgb(${channels.join(' ')})`;
}

export function staticPreviewScene(model) {
  const { bodies, studs } = geometryFor(model);
  const orderedBodies = [...bodies].sort((a, b) => (
    (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.y - b.y || a.x - b.x || a.z - b.z
  ));
  const points = orderedBodies.flatMap(body => Object.values(corners(body)).flat().map(project));
  for (const stud of studs) points.push(project(stud));
  const xs = points.map(point => point.x);
  const ys = points.map(point => point.y);
  return {
    bodies: orderedBodies,
    studs: [...studs].sort((a, b) => (
      (a.x + a.y + a.z) - (b.x + b.y + b.z) || a.y - b.y || a.x - b.x || a.z - b.z
    )),
    bounds: points.length ? {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    } : { minX: 0, maxX: 1, minY: 0, maxY: 1 },
  };
}

function drawPolygon(context, points, fill, transform) {
  context.beginPath();
  points.map(project).forEach((point, index) => {
    const shown = transform(point);
    if (index === 0) context.moveTo(shown.x, shown.y);
    else context.lineTo(shown.x, shown.y);
  });
  context.closePath();
  context.fillStyle = fill;
  context.fill();
  context.strokeStyle = '#171612';
  context.lineWidth = 0.65;
  context.stroke();
}

export function drawStaticPreview(context, model, width, height) {
  const scene = staticPreviewScene(model);
  const rangeX = Math.max(1, scene.bounds.maxX - scene.bounds.minX);
  const rangeY = Math.max(1, scene.bounds.maxY - scene.bounds.minY);
  const scale = Math.max(0.01, Math.min((width - PADDING * 2) / rangeX, (height - PADDING * 2) / rangeY));
  const offsetX = (width - rangeX * scale) / 2 - scene.bounds.minX * scale;
  const offsetY = (height - rangeY * scale) / 2 - scene.bounds.minY * scale;
  const transform = point => ({ x: point.x * scale + offsetX, y: point.y * scale + offsetY });

  context.clearRect(0, 0, width, height);
  context.lineJoin = 'round';
  for (const body of scene.bodies) {
    const faces = corners(body);
    drawPolygon(context, faces.left, shade(body.color, 0.72), transform);
    drawPolygon(context, faces.right, shade(body.color, 0.56), transform);
    drawPolygon(context, faces.top, shade(body.color, 1), transform);
  }
  for (const stud of scene.studs) {
    const center = transform(project(stud));
    const radiusX = Math.max(1, scale * 0.25);
    const radiusY = Math.max(0.65, scale * 0.13);
    context.beginPath();
    context.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2);
    context.fillStyle = shade(stud.color, 1.08);
    context.fill();
    context.strokeStyle = '#171612';
    context.lineWidth = 0.6;
    context.stroke();
  }
}

export function mountStaticModelStage(host, {
  model = null,
  label = 'LEGO-style set preview',
  onOpen,
  loading = false,
  linked = false,
} = {}) {
  const root = document.createElement('div');
  root.className = 'hero-renderer static-model-stage';
  Object.assign(root.style, { position: 'relative', width: '100%', height: '100%', overflow: 'hidden' });
  const canvas = document.createElement('canvas');
  canvas.className = 'hero-canvas static-preview-canvas';
  canvas.tabIndex = linked ? -1 : 0;
  canvas.setAttribute('role', linked ? 'img' : onOpen ? 'button' : 'img');
  if (linked) canvas.setAttribute('aria-hidden', 'true');
  else canvas.setAttribute('aria-label', label);
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', opacity: '1' });
  root.append(canvas);
  host.append(root);

  const context = canvas.getContext('2d');
  let shownModel = model;
  let isLoading = loading;
  let disposed = false;

  function render() {
    if (disposed || !context) return;
    const width = Math.max(1, root.clientWidth);
    const height = Math.max(1, root.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (shownModel) drawStaticPreview(context, shownModel, width, height);
  }

  function setModel(nextModel, { label: nextLabel } = {}) {
    shownModel = nextModel;
    isLoading = false;
    if (nextLabel) canvas.setAttribute('aria-label', nextLabel);
    canvas.dataset.phase = 'ready';
    render();
  }

  function setLoading(nextLoading) {
    isLoading = nextLoading;
    canvas.dataset.phase = nextLoading ? 'loading' : shownModel ? 'ready' : 'idle';
    render();
  }

  const activate = event => { if (onOpen && !isLoading) onOpen(event); };
  const onKeyDown = event => {
    if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      activate(event);
    }
  };
  if (onOpen) {
    canvas.style.cursor = 'pointer';
    canvas.addEventListener('click', activate);
    canvas.addEventListener('keydown', onKeyDown);
  }
  const resizeObserver = new ResizeObserver(render);
  resizeObserver.observe(root);
  if (model) setModel(model, { label });
  else setLoading(loading);

  return {
    element: root,
    setModel,
    setLoading,
    dispose() {
      if (disposed) return;
      disposed = true;
      resizeObserver.disconnect();
      canvas.removeEventListener('click', activate);
      canvas.removeEventListener('keydown', onKeyDown);
      root.remove();
    },
  };
}
