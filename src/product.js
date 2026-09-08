import './product.css';
import { createSavedDemoClient, DEMO_EXAMPLES } from './demo-client.js';
import { createGenerationClient } from './generation-client.js';
import { ProductViewer } from './product-viewer.js';
import { mountConstructionComparison } from './construction-comparison.js';

const picks = DEMO_EXAMPLES.map(({ name }) => `<button type="button" data-prompt="${name}">${name}</button>`).join('');
document.querySelector('#app').innerHTML = `
  <main class="shell"><div class="sheet">
    <header class="masthead"><button class="wordmark" type="button">Blawx</button><span id="tagline">LEGO generator</span></header>
    <section class="stage" aria-label="Model preview"><canvas id="model-canvas" tabindex="0"></canvas></section>
    <section class="content" aria-live="polite"><form id="prompt-form"><h1>Name your set</h1><label class="sr-only" for="prompt">Set description</label><input id="prompt" maxlength="500" autocomplete="off" placeholder="Type anything"><div class="example-group"><div class="picks">${picks}</div></div><button class="submit" disabled>Generate set</button></form><div id="status" hidden></div></section>
    <footer><details class="developer-tools"><summary>Developer</summary><div class="developer-body"><p class="developer-record"></p><div class="developer-generation"></div><div class="developer-construction"></div><nav><a href="?lab">Geometry lab</a></nav><p>Local generation · brick comparison</p></div></details></footer>
  </div></main>`;

const form = document.querySelector('#prompt-form');
const input = document.querySelector('#prompt');
const status = document.querySelector('#status');
const tagline = document.querySelector('#tagline');
const canvas = document.querySelector('#model-canvas');
const developer = document.querySelector('.developer-construction');
const developerRecord = document.querySelector('.developer-record');
const developerGeneration = document.querySelector('.developer-generation');
const viewer = new ProductViewer(canvas);
const savedClient = createSavedDemoClient();
const generationClient = createGenerationClient();
let requestId = 0;
let activeController = null;
let elapsedTimer = null;
let disposeComparison = null;

function escape(value) { const node = document.createElement('div'); node.textContent = value; return node.innerHTML; }
function stopActiveRequest() {
  disposeComparison?.();
  disposeComparison = null;
  developer.replaceChildren();
  developerRecord.textContent = "";
  developerGeneration.replaceChildren();
  activeController?.abort();
  activeController = null;
  clearInterval(elapsedTimer);
  elapsedTimer = null;
}
function showForm() {
  requestId += 1; stopActiveRequest(); form.hidden = false; status.hidden = true; tagline.textContent = 'LEGO generator';
  form.querySelector('.submit').disabled = !input.value.trim(); input.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
function formatSeconds(milliseconds) {
  return Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(1)} seconds` : 'Not reported';
}
async function generate(value) {
  const currentRequest = ++requestId;
  stopActiveRequest();
  const controller = new AbortController();
  activeController = controller;
  window.scrollTo(0, 0);
  input.value = value; form.hidden = true; status.hidden = false; status.className = 'loading';
  status.innerHTML = `<p class="kicker">Generating your set</p><h1>${escape(value)}</h1><div class="build-line"><i></i><span>Generating your set… <b id="elapsed" aria-hidden="true" aria-live="off">0.0 s</b></span></div><button class="cancel" type="button">Cancel</button>`;
  status.querySelector('.cancel').onclick = showForm;
  const startedAt = performance.now();
  const elapsed = status.querySelector('#elapsed');
  elapsedTimer = setInterval(() => { elapsed.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)} s`; }, 100);
  try {
    const result = await generationClient.generate(value, { signal: controller.signal }); if (currentRequest !== requestId) return;
    const browserMs = performance.now() - startedAt;
    stopActiveRequest();
    viewer.setModel(result.model); tagline.textContent = 'LEGO generator'; status.className = 'result';
    const metadata = result.metadata;
    developerRecord.textContent = `Generated result · ${result.requestId}`;
    developerGeneration.innerHTML = `<dl><div><dt>Generation</dt><dd>${formatSeconds(metadata.generationMs)}</dd></div><div><dt>Browser wait</dt><dd>${formatSeconds(browserMs)}</dd></div><div><dt>Model</dt><dd>${escape(metadata.actualModel || metadata.requestedModel || 'Not reported')}</dd></div><div><dt>Timing scope</dt><dd>${escape(metadata.timingScope || 'Generation only')}</dd></div></dl>`;
    status.innerHTML = `<h1>${escape(result.prompt)}</h1><div class="construction-comparison"></div><button class="again" type="button">Build another set</button>`;
    disposeComparison = mountConstructionComparison(status.querySelector('.construction-comparison'), { rawModel: result.model, sourceProgram: result.sourceProgram ?? null, viewer, devHost: developer, subject: result.model.meta?.prompt ?? result.prompt, allowSemanticInference: true });
  } catch (error) {
    if (currentRequest !== requestId) return;
    stopActiveRequest();
    if (error?.name === 'AbortError') return;
    status.className = 'error';
    status.innerHTML = `<p class="kicker">Generation stopped</p><h1>Couldn’t generate that set</h1><p>${escape(error.message || 'The local generator did not return a usable set.')}</p><button class="again" type="button">Try again</button>`;
  }
  status.querySelector('.again').onclick = showForm;
}

async function showSavedExample(value) {
  const currentRequest = ++requestId;
  stopActiveRequest();
  window.scrollTo(0, 0);
  form.hidden = true; status.hidden = false; status.className = 'loading';
  status.innerHTML = `<h1>${escape(value)}</h1><div class="build-line"><i></i><span>Loading…</span></div>`;
  try {
    const result = await savedClient.generate(value); if (currentRequest !== requestId) return;
    viewer.setModel(result.model); tagline.textContent = 'LEGO generator';
    developerRecord.textContent = `Saved example · Shape ${result.example.shape}. Accepted raw geometry from the demo shelf.`; status.className = 'result';
    status.innerHTML = `<h1>${escape(result.example.name)}</h1><div class="construction-comparison"></div><button class="again" type="button">Build another set</button>`;
    disposeComparison = mountConstructionComparison(status.querySelector('.construction-comparison'), { rawModel: result.model, sourceProgram: result.sourceProgram ?? null, viewer, devHost: developer, subject: result.model.meta?.prompt ?? value });
  } catch (error) {
    if (currentRequest !== requestId) return;
    status.className = 'error';
    status.innerHTML = `<h1>Couldn’t load that example</h1><p>${escape(error.message)}</p><button class="again" type="button">Choose another</button>`;
  }
  status.querySelector('.again').onclick = showForm;
}

input.addEventListener('input', () => { form.querySelector('.submit').disabled = !input.value.trim(); });
form.addEventListener('submit', (event) => { event.preventDefault(); if (input.value.trim()) generate(input.value.trim()); });
document.querySelectorAll('[data-prompt]').forEach((button) => { button.onclick = () => showSavedExample(button.dataset.prompt); });
document.querySelector('.wordmark').onclick = showForm;
canvas.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); viewer.turn(event.key === 'ArrowLeft' ? -1 : 1); } });
const heroRequest = requestId;
savedClient.generate('cat').then(({ model }) => { if (heroRequest === requestId) viewer.setModel(model); }).catch(() => {});
