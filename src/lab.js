import './style.css';
import { validateModel } from './geometry.js';
import { validateVoxels } from './voxels.js';
import { BrickViewer } from './viewer.js';
import { comparisonCost, filterComparisonRows, findFixtureIndex, formatSeconds, formatUsd, sortComparisonRows } from './comparison.js';

const MAX_IMPORT_BYTES = 5_000_000;
const MAX_BRICKS = 5_000;
const RUBRIC = [
  ['fidelity', 'Prompt fidelity'],
  ['composition', 'Shape / composition'],
  ['authenticity', 'LEGO authenticity'],
  ['appeal', 'Finished-set appeal'],
];

document.querySelector('#app').innerHTML = `
  <header class="topbar">
    <div><h1>blawx <span>/ geometry lab</span></h1><p>Shape experiments · saved results</p></div>
    <div class="actions"><label class="import">Import JSON<input id="import-file" type="file" accept="application/json,.json"></label><button id="export" class="button" disabled>Export result</button></div>
  </header>
  <main>
    <section class="stage" aria-label="3D model viewer">
      <canvas id="canvas"></canvas>
      <div class="stage-tools" aria-label="Camera views">
        <button data-view="front">Front</button><button data-view="side">Side</button><button data-view="rear">Rear</button><button data-view="isometric" class="active">Iso</button>
      </div>
      <button id="shape-only" class="shape-only" type="button" aria-pressed="false">Shape only</button>
      <div class="hint">Drag to orbit · scroll to zoom</div>
      <div id="empty" class="empty"><span>◇</span><strong>Select a prepared study</strong><small>or import a model JSON file</small></div>
    </section>
    <aside>
      <section class="panel picker"><label for="fixture">Study</label><select id="fixture"><option value="">Loading fixtures…</option></select></section>
      <section id="notice" class="notice" hidden></section>
      <section class="panel details">
        <div class="eyebrow">Model record</div>
        <dl><div><dt>Method</dt><dd id="method">—</dd></div><div><dt>Provenance</dt><dd id="provenance">—</dd></div><div><dt>Generation</dt><dd id="generation">not measured</dd></div><div><dt>Scene setup</dt><dd id="render">—</dd></div><div><dt id="count-label">Pieces</dt><dd id="pieces">—</dd></div><div><dt>Stage</dt><dd id="stage">—</dd></div></dl>
        <button id="prompt-toggle" class="prompt-toggle" disabled>Reveal prompt</button>
        <p id="prompt" class="prompt" hidden></p>
        <details id="diagnostics" class="diagnostics" hidden><summary>Geometry diagnostics</summary><div id="diagnostic-body"></div></details>
      </section>
      <details class="panel attempts-panel">
        <summary>Generation attempts <span id="attempt-count">—</span></summary>
        <div id="attempts" class="attempts"><small>Loading attempt records…</small></div>
      </details>
      <section class="panel scoring">
        <div class="eyebrow">Your visual score <span>0–4</span></div>
        <div id="rubric"></div>
      </section>
    </aside>
  </main>
  <section class="comparison" aria-labelledby="comparison-title">
    <div class="comparison-heading">
      <div><div class="eyebrow">Saved shapes</div><h2 id="comparison-title">Results comparison</h2></div>
      <div class="comparison-controls"><label>Find a subject<input id="comparison-search" type="search" placeholder="Try reef or cat"></label><label>Cost basis<select id="comparison-cost-basis"><option value="observed">Observed run</option><option value="cold">Same input · uncached</option><option value="warm">Same input · mostly cached</option></select></label><label>Sort<select id="comparison-sort"><option value="shape-desc">Newest shape</option><option value="time-asc">Time · fastest</option><option value="time-desc">Time · slowest</option><option value="dollars-asc">Estimate · lowest</option><option value="dollars-desc">Estimate · highest</option></select></label></div>
    </div>
    <p class="comparison-note">This table compares saved shapes only. Private generation-attempt records are not included in this public dataset. Times exclude browser rendering; staged runs show sums of measured stages. Subscription access and API-equivalent estimates are separate. No separate API charge does not mean free public generation. Hypothetical estimates use saved September 2026 research rates; the actual product tier is unreported.</p>
    <p id="comparison-assumption" class="comparison-assumption" hidden><strong>Illustrative normalized scenario:</strong> 1,500 input tokens; uncached assumes all uncached, mostly cached assumes 1,400 cached + 100 uncached; observed output is held fixed; no cache-write charges are assumed. Uses historical rates and is not a deployment forecast.</p>
    <div id="comparison-table" class="comparison-table"><small>Loading saved-shape comparison…</small></div>
  </section>`;

const el = Object.fromEntries(['fixture','notice','empty','method','provenance','generation','render','pieces','count-label','stage','prompt-toggle','prompt','export','import-file','rubric','diagnostics','diagnostic-body','attempt-count','attempts','shape-only','comparison-search','comparison-cost-basis','comparison-sort','comparison-assumption','comparison-table'].map((id) => [id, document.getElementById(id)]));
const viewer = new BrickViewer(document.getElementById('canvas'));
let current = null;
let currentValidation = null;
let currentLabel = '';
let currentIdentity = '';
let requestId = 0;
const scoresByIdentity = new Map();
let fixtureEntries = [];
let comparisonRows = [];

for (const [key, label] of RUBRIC) {
  const row = document.createElement('fieldset');
  row.innerHTML = `<legend>${label}</legend><div>${[0,1,2,3,4].map((n) => `<label><input type="radio" name="${key}" value="${n}"><span>${n}</span></label>`).join('')}</div>`;
  el.rubric.append(row);
}
el.rubric.addEventListener('change', () => {
  if (!currentIdentity) return;
  scoresByIdentity.set(currentIdentity, Object.fromEntries(RUBRIC.map(([key]) => {
    const checked = document.querySelector(`input[name="${key}"]:checked`);
    return [key, checked ? Number(checked.value) : null];
  })));
});

function normalizeValidation(result) {
  if (!result) return { valid: true, errors: [], warnings: [] };
  if (result === true) return { valid: true, errors: [], warnings: [] };
  if (result === false) return { valid: false, errors: ['Model validation failed.'], warnings: [] };
  return {
    valid: result.valid ?? result.ok ?? !(result.errors?.length),
    errors: result.errors ?? [], warnings: result.warnings ?? [], ...result,
  };
}

function textIssue(issue) {
  return typeof issue === 'string' ? issue : issue?.message ?? JSON.stringify(issue);
}

function preflight(model) {
  if (!model || typeof model !== 'object' || Array.isArray(model)) throw new Error('Expected a JSON model object.');
  if (model.kind === 'voxels') {
    if (!Array.isArray(model.cells)) throw new Error('Voxel model is missing a cells array.');
    if (model.cells.length > 50_000) throw new Error('Voxel model exceeds the 50,000-cell limit.');
    return;
  }
  if (!Array.isArray(model.bricks)) throw new Error('Model is missing a bricks array.');
  if (model.bricks.length > MAX_BRICKS) throw new Error(`Model has ${model.bricks.length.toLocaleString()} bricks; viewer limit is ${MAX_BRICKS.toLocaleString()}.`);
}

function showNotice(kind, lines) {
  el.notice.hidden = !lines.length;
  el.notice.className = `notice ${kind}`;
  const title = kind === 'error' ? 'Could not load model' : kind === 'invalid' ? 'Failed digital validation' : 'Preliminary validation';
  el.notice.innerHTML = lines.length ? `<strong>${title}</strong><ul>${lines.slice(0, 8).map((line) => `<li>${escapeHtml(textIssue(line))}</li>`).join('')}</ul>${lines.length > 8 ? `<small>+ ${lines.length - 8} more</small>` : ''}` : '';
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function loadModel(model, label = 'Imported model', identity = label) {
  preflight(model);
  const isVoxel = model.kind === 'voxels';
  const validation = normalizeValidation(isVoxel ? validateVoxels(model) : validateModel(model));
  const schemaFailed = validation.checks?.schema === false || validation.schemaValid === false;
  if (schemaFailed) throw Object.assign(new Error('The model does not match the interchange schema.'), { validation });
  const started = performance.now();
  viewer.setModel(model);
  const renderMs = performance.now() - started;
  current = model;
  currentValidation = validation;
  currentLabel = label;
  currentIdentity = `${isVoxel ? 'voxels' : 'bricks'}:${identity}`;
  el.empty.hidden = true;
  const meta = model.meta ?? {};
  el.method.textContent = meta.method ?? 'unspecified';
  el.provenance.textContent = meta.provenance ?? 'unspecified';
  const timingScope = [meta.runtime, meta.timingScope].filter(Boolean).join(' · ') || 'recorded generation only';
  el.generation.textContent = Number.isFinite(meta.generationMs) ? `${meta.generationMs.toLocaleString()} ms · ${timingScope}` : 'not measured';
  el.render.textContent = `${renderMs.toFixed(1)} ms local preparation (not generation)`;
  el['count-label'].textContent = isVoxel ? 'Voxels' : 'Pieces';
  el.pieces.textContent = (isVoxel ? model.cells : model.bricks).length.toLocaleString();
  el.stage.textContent = isVoxel ? 'Raw shape · parts not assigned' : 'Brick geometry · buildability unknown';
  el.prompt.textContent = meta.prompt ?? 'No prompt recorded.';
  el.prompt.hidden = true;
  el['prompt-toggle'].textContent = 'Reveal prompt';
  el['prompt-toggle'].disabled = false;
  el.export.disabled = false;
  const issues = [...(validation.errors ?? []), ...(validation.warnings ?? []), ...(validation.limitations ?? [])];
  el.diagnostics.hidden = !issues.length;
  el.diagnostics.open = false;
  el['diagnostic-body'].innerHTML = issues.length ? `<p>${isVoxel ? 'Connectivity is a geometry diagnostic, separate from shape judgement.' : 'Packing checks are preliminary and do not determine raw-shape quality.'}</p><ul>${issues.map((issue) => `<li>${escapeHtml(textIssue(issue))}</li>`).join('')}</ul>` : '';
  showNotice('warning', []);
  const authenticityLegend = document.querySelector('input[name="authenticity"]')?.closest('fieldset')?.querySelector('legend');
  if (authenticityLegend) authenticityLegend.textContent = isVoxel ? 'Brick suitability (provisional)' : 'LEGO authenticity';
  const savedScores = scoresByIdentity.get(currentIdentity) ?? {};
  document.querySelectorAll('input[type="radio"]').forEach((input) => {
    input.checked = savedScores[input.name] === Number(input.value);
  });
}

async function loadFixture(entry, label = entry.label, identity = entry.id ?? entry.url, id = ++requestId) {
  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`Fixture request failed (${response.status}).`);
  const text = await response.text();
  if (text.length > MAX_IMPORT_BYTES) throw new Error('Fixture exceeds the 5 MB viewer limit.');
  if (id === requestId) loadModel(JSON.parse(text), label, identity);
}

async function initializeFixtures() {
  const initId = ++requestId;
  try {
    const readIndex = async (url, optional = false) => {
      const response = await fetch(url);
      if (!response.ok) {
        if (optional && response.status === 404) return [];
        throw new Error(`Study index is not available (${response.status}).`);
      }
      const data = await response.json();
      const entries = Array.isArray(data) ? data : data.fixtures ?? data.experiments;
      if (!Array.isArray(entries)) throw new Error('Study index must be an array.');
      return entries;
    };
    const [experiments, fixtures] = await Promise.all([readIndex('/examples/index.json', true), readIndex('/fixtures/index.json')]);
    const numberedExperiments = experiments.map((entry, index) => {
      const shapeNumber = Number.isSafeInteger(entry.shape) && entry.shape > 0
        ? entry.shape
        : index + 1;
      return {
      ...entry,
      displayLabel: `Shape ${String(shapeNumber).padStart(2, '0')}`,
      shapeNumber,
      sourceKind: 'experiment',
      };
    });
    const experimentEntries = [...numberedExperiments].sort((a, b) => {
      const aTime = Date.parse(a.createdAt ?? a.generatedAt ?? '') || 0;
      const bTime = Date.parse(b.createdAt ?? b.generatedAt ?? '') || 0;
      return bTime - aTime;
    });
    if (experimentEntries.length > 1 && experimentEntries.every((entry) => !(Date.parse(entry.createdAt ?? entry.generatedAt ?? '') > 0))) experimentEntries.reverse();
    const preparedEntries = fixtures.map((entry, index) => ({
      ...entry,
      displayLabel: `Prepared ${String.fromCharCode(65 + index)}`,
      sourceKind: 'prepared',
    }));
    const entries = [...experimentEntries, ...preparedEntries];
    fixtureEntries = entries;
    el.fixture.innerHTML = `<option value="">Choose a study…</option>${entries.map((entry, index) => `<option value="${index}">${entry.displayLabel}</option>`).join('')}`;
    el.fixture.addEventListener('change', async () => {
      if (el.fixture.value === '') return;
      const id = ++requestId;
      const index = Number(el.fixture.value);
      try {
        const response = await fetch(entries[index].url);
        if (!response.ok) throw new Error(`Fixture request failed (${response.status}).`);
        const text = await response.text();
        if (text.length > MAX_IMPORT_BYTES) throw new Error('Fixture exceeds the 5 MB viewer limit.');
        if (id === requestId) loadModel(JSON.parse(text), entries[index].displayLabel, `fixture:${entries[index].id ?? entries[index].url}`);
      } catch (error) { if (id === requestId) showNotice('error', error.validation?.errors ?? [error.message]); }
    });
    if (entries.length) {
      el.fixture.value = '0';
      if (initId === requestId) await loadFixture(entries[0], entries[0].displayLabel, `fixture:${entries[0].id ?? entries[0].url}`, initId);
    }
  } catch (error) {
    el.fixture.innerHTML = '<option value="">No fixtures available</option>';
    if (initId === requestId) showNotice('error', [error.message]);
  }
}

function renderComparison() {
  const costBasis = el['comparison-cost-basis'].value;
  const rows = sortComparisonRows(filterComparisonRows(comparisonRows, el['comparison-search'].value), el['comparison-sort'].value, costBasis);
  el['comparison-assumption'].hidden = costBasis === 'observed';
  if (!rows.length) {
    el['comparison-table'].innerHTML = '<p class="comparison-empty">No saved shapes match this search.</p>';
    return;
  }
  el['comparison-table'].innerHTML = `<table><thead><tr><th>Shape</th><th>Subject</th><th>Time</th><th>API estimate</th><th>Feedback</th><th>Details</th></tr></thead><tbody>${rows.map((row, index) => {
    const selectedCost = comparisonCost(row, costBasis);
    const estimate = Number.isFinite(selectedCost) ? formatUsd(selectedCost) : '—';
    const recorded = Number.isFinite(row.recordedCostUsd) ? formatUsd(row.recordedCostUsd) : '—';
    const details = [
      ['Requested setup', `${row.model ?? 'unknown'} · ${row.reasoning ?? 'reasoning unreported'}`],
      ['Timing scope', row.timingScope ?? 'scope unreported'],
      ['Charge basis', row.billingLabel ?? 'Unknown'],
      ['Recorded cost', recorded],
      ['Estimate basis', row.estimateBasis ?? 'Not available'],
      ...(costBasis === 'observed' ? [] : [['Normalized basis', row.standardizedBasis ?? 'Not available']]),
    ];
    return `<tr><td><button class="shape-link" data-comparison-index="${index}">Shape ${escapeHtml(String(row.shape).padStart(2, '0'))}</button></td><td><strong>${escapeHtml(row.subject ?? 'Unlabeled')}</strong></td><td>${formatSeconds(row.generationMs)}</td><td>${estimate}</td><td>${escapeHtml(row.feedback ?? '—')}</td><td><details class="row-details"><summary>View</summary><dl>${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></details></td></tr>`;
  }).join('')}</tbody></table>`;
  el['comparison-table'].querySelectorAll('[data-comparison-index]').forEach((button) => button.addEventListener('click', () => {
    const row = rows[Number(button.dataset.comparisonIndex)];
    const fixtureIndex = findFixtureIndex(row, fixtureEntries);
    if (fixtureIndex < 0) return showNotice('error', [`${button.textContent} is not present in the current study index.`]);
    el.fixture.value = String(fixtureIndex);
    el.fixture.dispatchEvent(new Event('change'));
    document.querySelector('main').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

async function initializeComparison() {
  try {
    const response = await fetch('/examples/comparison.json');
    if (!response.ok) throw new Error(response.status === 404 ? 'No comparison data published yet.' : `Comparison request failed (${response.status}).`);
    const data = await response.json();
    comparisonRows = Array.isArray(data) ? data : data.rows;
    if (!Array.isArray(comparisonRows)) throw new Error('Comparison data must contain a rows array.');
    renderComparison();
  } catch (error) {
    el['comparison-table'].innerHTML = `<p class="comparison-empty">${escapeHtml(error.message)}</p>`;
  }
}

async function initializeAttempts() {
  try {
    const response = await fetch('/examples/attempts.json');
    if (!response.ok) {
      if (response.status === 404) throw new Error('No attempt records published yet.');
      throw new Error(`Attempt index request failed (${response.status}).`);
    }
    const attempts = await response.json();
    if (attempts?.status === 'private-records-not-included') {
      el['attempt-count'].textContent = '0';
      el.attempts.innerHTML = `<small>${escapeHtml(attempts.message ?? 'Private generation-attempt records are not included in this public dataset.')}</small>`;
      return;
    }
    if (!Array.isArray(attempts)) throw new Error('Attempt index must be an array.');
    const chronological = [...attempts].sort((a, b) => String(a.createdAt ?? a.id).localeCompare(String(b.createdAt ?? b.id)));
    el['attempt-count'].textContent = chronological.length;
    el.attempts.innerHTML = chronological.length ? chronological.map((attempt, index) => {
      const label = `Attempt ${String(index + 1).padStart(2, '0')}`;
      const timing = Number.isFinite(attempt.generationMs) ? `${(attempt.generationMs / 1000).toFixed(1)} s` : 'not measured';
      const prompt = attempt.prompt ? `<p><strong>Prompt</strong><br>${escapeHtml(attempt.prompt)}</p>` : '';
      const error = attempt.errorSummary ? `<p class="attempt-error">${escapeHtml(attempt.errorSummary)}</p>` : '';
      return `<details class="attempt"><summary><strong>${label}</strong><span>${escapeHtml(attempt.method ?? 'unspecified')}</span><span>${timing}</span><em class="status ${escapeHtml(attempt.status ?? 'unknown')}">${escapeHtml(attempt.status ?? 'unknown')}</em></summary>${prompt}${error}</details>`;
    }).join('') : '<small>No generation attempts recorded.</small>';
  } catch (error) {
    el['attempt-count'].textContent = '0';
    el.attempts.innerHTML = `<small>${escapeHtml(error.message)}</small>`;
  }
}

el['prompt-toggle'].addEventListener('click', () => {
  el.prompt.hidden = !el.prompt.hidden;
  el['prompt-toggle'].textContent = el.prompt.hidden ? 'Reveal prompt' : 'Hide prompt';
});
el['shape-only'].addEventListener('click', () => {
  const pressed = el['shape-only'].getAttribute('aria-pressed') !== 'true';
  el['shape-only'].setAttribute('aria-pressed', String(pressed));
  viewer.setShapeOnly(pressed);
});
document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b === button));
  viewer.setView(button.dataset.view);
}));
el['import-file'].addEventListener('change', async () => {
  const file = el['import-file'].files?.[0];
  if (!file) return;
  const id = ++requestId;
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('File exceeds the 5 MB import limit.');
    const text = await file.text();
    if (id !== requestId) return;
    loadModel(JSON.parse(text), file.name, `import:${file.name}:${file.size}:${file.lastModified}`);
    el.fixture.value = '';
  } catch (error) {
    if (id === requestId) showNotice('error', error.validation?.errors ?? [error instanceof SyntaxError ? 'File is not valid JSON.' : error.message]);
  } finally { el['import-file'].value = ''; }
});
el.export.addEventListener('click', () => {
  if (!current) return;
  const scores = Object.fromEntries(RUBRIC.map(([key]) => [key, Number(document.querySelector(`input[name="${key}"]:checked`)?.value ?? NaN)]).filter(([,v]) => Number.isFinite(v)));
  const isVoxel = current.kind === 'voxels';
  const result = { exportedAt: new Date().toISOString(), assessmentStage: isVoxel ? 'raw-shape' : 'brick-geometry', label: currentLabel, model: current, provenance: current.meta?.provenance ?? 'unspecified', scores, validation: currentValidation };
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
  link.download = `${(currentLabel || 'geometry-result').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-score.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

initializeFixtures();
initializeAttempts();
el['comparison-search'].addEventListener('input', renderComparison);
el['comparison-cost-basis'].addEventListener('change', renderComparison);
el['comparison-sort'].addEventListener('change', renderComparison);
initializeComparison();
