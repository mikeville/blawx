import { ProductViewer } from './product-viewer.js';

const CASES_PATH = '/instruction-appearance-cases.json';
const viewers = [];
const status = document.querySelector('.status');

async function loadExamples() {
  const response = await fetch(CASES_PATH);
  if (!response.ok) throw new Error(`Proof cases failed to load (${response.status}).`);
  const fixture = await response.json();
  return new Map(fixture.cases.map(entry => [String(entry.shape), {
    model: entry.model,
    highlightIds: new Set(entry.highlightIds),
    caption: `Step ${entry.step.index} · ${entry.highlightIds.length} new / ${entry.model.bricks.length} visible`,
  }]));
}

function renderExamples(examples) {
  document.querySelectorAll('canvas[data-case]').forEach(canvas => {
    const example = examples.get(canvas.dataset.case);
    const viewer = new ProductViewer(canvas);
    viewer.setModel(example.model, {
      frameModel: example.model,
      highlightIds: example.highlightIds,
      animate: false,
    });
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      viewer.turn(event.key === 'ArrowLeft' ? -1 : 1);
    });
    viewers.push(viewer);
    document.querySelector(`[data-caption="${canvas.dataset.case}"]`).textContent = example.caption;
  });
}

loadExamples().then(renderExamples).catch(error => {
  status.textContent = error.message;
  status.style.color = '#a9251b';
});

window.addEventListener('pagehide', () => {
  viewers.splice(0).forEach(viewer => viewer.dispose());
}, { once: true });
