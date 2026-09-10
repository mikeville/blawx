import { mountAssemblyBooklet } from './assembly-booklet.js';
import { createConstructionClient } from './construction-client.js';
import { createSemanticGuideClient, nameConstructionGuide } from './semantic-guide-client.js';

const client = createConstructionClient();
const semanticClient = createSemanticGuideClient(fetch, { persist: true });
const number = value => Number(value ?? 0).toLocaleString();

export function mountConstructionComparison(host, {
  rawModel, sourceProgram = null, viewer, devHost, subject = null, allowSemanticInference = false,
  constructionClient = client, namingClient = semanticClient, onPhase, onReady, onError, hideLoadingMessage = false,
}) {
  const controller = new AbortController();
  let operationId = 0;
  const results = new Map();
  let active = 'adjusted';
  let requestedStage = 'adjusted';
  let pending = null;
  let disposed = false;
  let disposeBooklet = null;
  let bookletResult = null;
  let deferredSemanticResult = null;
  let semanticRequested = false;
  let initialGuideReady = false;
  host.innerHTML = `<p class="guide-loading" role="status">Preparing instructions…</p><div class="assembly-booklet"></div>`;
  const loading = host.querySelector(".guide-loading");
  loading.hidden = hideLoadingMessage;
  devHost.innerHTML = `<div class="comparison-choices" role="group" aria-label="Preview stage">
    <button type="button" data-stage="raw" aria-pressed="true">Raw shape</button>
    <button type="button" data-stage="bricks" aria-pressed="false">Bricks</button>
    <button type="button" data-stage="adjusted" aria-pressed="false">Adjusted</button>
  </div>
  <p class="conversion-note" role="status">Converting locally… Raw geometry is preserved.</p>
  <div class="construction-details"></div><div class="assembly-diagnostics"></div>`;
  const note = devHost.querySelector('.conversion-note');
  const details = devHost.querySelector('.construction-details');
  const buttons = [...devHost.querySelectorAll('[data-stage]')];

  function captureReaderState() {
    const summaries = [...host.querySelectorAll('.manual-chapter > summary')];
    const anchor = summaries.find(summary => summary.getBoundingClientRect().bottom >= 64) ?? summaries.at(-1);
    return {
      partsOpen: host.querySelector('.manual-total-parts')?.open ?? true,
      scrollY: window.scrollY,
      anchorStepId: anchor?.parentElement?.dataset.firstStep ?? null,
      anchorTop: anchor?.getBoundingClientRect().top ?? null,
      openChapterStepId: host.querySelector('.manual-chapter[open]')?.dataset.firstStep ?? null,
    };
  }

  function isReadingOpenChapter() {
    const open = host.querySelector('.manual-chapter[open]');
    if (!open) return false;
    const bounds = open.getBoundingClientRect();
    return bounds.top < window.innerHeight && bounds.bottom > 64;
  }

  function applyDeferredSemanticResult() {
    if (disposed || !deferredSemanticResult || active !== 'adjusted') return;
    if (results.get('adjusted') !== deferredSemanticResult) return;
    if (isReadingOpenChapter()) return;
    const result = deferredSemanticResult;
    deferredSemanticResult = null;
    describe(result, { preserveReaderState: true });
  }

  function describe(result, { preserveReaderState = false } = {}) {
    if (bookletResult !== result) {
      const readerState = preserveReaderState ? captureReaderState() : null;
      disposeBooklet?.();
      bookletResult = result;
      disposeBooklet = mountAssemblyBooklet(host.querySelector(".assembly-booklet"), {
        result,
        subject,
        diagnosticsHost: devHost.querySelector(".assembly-diagnostics"),
        onReaderStateChange: applyDeferredSemanticResult,
        readerState,
      });
    }
    const { metrics: m, diagnostics: d } = result;
    const s = d.stats;
    const partCounts = new Map();
    for (const b of result.brickModel.bricks) {
      const size = `${Math.min(b.w,b.d)}×${Math.max(b.w,b.d)}`;
      partCounts.set(size, (partCounts.get(size) ?? 0) + 1);
    }
    const partMix = [...partCounts].sort((a,b) => b[1]-a[1]).map(([size,count]) => `${size}: ${number(count)}`).join(' · ');
    const bounds = rawModel.cells.reduce((b, c) => ({ minX: Math.min(b.minX,c.x), maxX: Math.max(b.maxX,c.x+1), minY: Math.min(b.minY,c.y), maxY: Math.max(b.maxY,c.y+1), minZ: Math.min(b.minZ,c.z), maxZ: Math.max(b.maxZ,c.z+1) }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity });
    const dimensions = [bounds.maxX-bounds.minX,bounds.maxY-bounds.minY,bounds.maxZ-bounds.minZ].map(n => (n*m.scale.voxelMm/10).toFixed(1)).join(' × ');
    const scaleDescription = '1 stud per source voxel; heights rounded to 9.6 mm courses. Thin features can change.';
    details.innerHTML = `<details><summary>Construction checks · ${number(m.brickCount)} bricks</summary><dl>
      <div><dt>Local conversion</dt><dd>${Math.round(m.conversionMs)} ms · excludes rendering</dd></div>
      <div><dt>Scale</dt><dd>${scaleDescription}</dd></div>
      <div><dt>Raw envelope</dt><dd>${dimensions} cm (W × H × D)</dd></div>
      <div><dt>Geometry change</dt><dd>+${Number(m.addedVolumeVoxelEquivalent).toFixed(1)} / −${Number(m.removedVolumeVoxelEquivalent).toFixed(1)} voxel volume; ${(m.relativeVolumeChange*100).toFixed(2)}% net</dd></div>
      <div><dt>Color change</dt><dd>${Number(m.recoloredVolumeVoxelEquivalent).toFixed(1)} voxel volume differs from the source</dd></div>
      <div><dt>Rectangular parts</dt><dd>${d.checks.legalFootprints ? 'Allowed footprints' : 'Unresolved'}. Part/color availability unverified.</dd></div>
      <div><dt>Brick selection</dt><dd>Prefer 2×4 and 2×2; smaller bricks for fit and detail.</dd></div>
      <div><dt>Part counts</dt><dd>${partMix}</dd></div>
      <div><dt>Collisions</dt><dd>${number(s.collisionPairCount)} overlapping pairs</dd></div>
      <div><dt>Stud graph</dt><dd>${number(s.componentCount)} components; ${number(s.groundlessComponentCount)} without a path to ground</dd></div>
      <div><dt>Below support</dt><dd>${number(s.unsupportedBrickCount)} bricks with none; ${number(s.weakSupportBrickCount)} with less than 25%</dd></div>
      ${m.adjustmentSearch ? `<div><dt>Adjustment result</dt><dd>${m.adjustmentSearch.before.groundlessComponentCount} → ${m.adjustmentSearch.after.groundlessComponentCount} components without ground connection; ${m.adjustmentSearch.before.unsupportedBrickCount} → ${m.adjustmentSearch.after.unsupportedBrickCount} bricks without below support. ${m.adjustmentSearch.packingRetiled ? "Packing reworked." : ""}</dd></div>` : ""}
      ${m.assemblyFeedback ? `<div><dt>Assembly feedback</dt><dd>${m.assemblyFeedback.baseline ? `${m.assemblyFeedback.baseline.rootFailureCount} → ${m.assemblyFeedback.final.rootFailureCount} unsupported placement roots; ${m.assemblyFeedback.rejected} candidates rejected by assembly checks.` : 'Planner unavailable; original packing retained.'}</dd></div>` : ''}
      ${result.packingRefinement ? `<div><dt>Brick refinement</dt><dd>${result.packingRefinement.before.brickCount} → ${result.packingRefinement.after.brickCount} parts; ${result.packingRefinement.before.partHistogram['1x1']??0} → ${result.packingRefinement.after.partHistogram['1x1']??0} single-stud bricks. ${result.packingRefinement.accepted.length} exact local retilings; ${Math.round(result.packingRefinement.refinementMs)} ms. Geometry/color changes: 0. Search ${result.packingRefinement.limitReached||result.packingRefinement.searchLimitReached?'bounded; alternatives remain unexplored':'finished within bounds'}.</dd></div><div><dt>Refined assembly</dt><dd>${result.packingRefinement.before.unresolvedCellCount} → ${result.packingRefinement.after.unresolvedCellCount} unresolved occupied cells. Automatic underside workarounds are disabled; unresolved operations remain flagged.</dd></div>` : ''}
      <div><dt>Layer interlock</dt><dd>${number(s.bridgingBrickCount)} bricks span multiple lower bricks</dd></div>
    </dl><p class="construction-limit">Connection and support heuristics only. Strength, balance, clutch, assembly order and part/color catalog are unverified. Side contact is not stud engagement.</p>
    <button type="button" class="download-construction">Save placements + report</button></details>`;
    details.querySelector('.download-construction').onclick = () => {
      const currentResult = active === 'raw'
        ? results.get('bricks') ?? results.get('adjusted')
        : results.get(active) ?? result;
      const json = JSON.stringify({ sourceProgram, rawModel, conversion: currentResult }, null, 2);
      // Embedded browsers may not support Blob downloads. Always expose the
      // exact same payload as selectable text, without relying on permissions.
      let copy = details.querySelector('.export-copy');
      if (!copy) {
        copy = document.createElement('details');
        copy.className = 'export-copy';
        copy.innerHTML = '<summary>View / copy JSON</summary><textarea readonly aria-label="Construction JSON"></textarea>';
        details.querySelector('details').append(copy);
      }
      copy.querySelector('textarea').value = json;
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = `blawx-${active === 'raw' ? 'bricks' : active}-construction.json`;
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
  }

  async function nameAdjustedGuide(result) {
    if (semanticRequested) return;
    semanticRequested = true;
    const named = await nameConstructionGuide(result, {
      subject,
      client: namingClient,
      signal: controller.signal,
      allowInference: allowSemanticInference,
    });
    if (disposed || results.get('adjusted') !== result) return;
    results.set('adjusted', named);
    if (active !== 'adjusted') return;
    if (!named.semanticGuide) {
      // A failed lookup must not rebuild the already usable generic booklet.
      let status = devHost.querySelector('.semantic-status');
      if (!status) {
        status = document.createElement('p');
        status.className = 'semantic-status';
        devHost.querySelector('.assembly-diagnostics').append(status);
      }
      status.textContent = named.semanticStatus ?? '';
      return;
    }
    if (isReadingOpenChapter()) deferredSemanticResult = named;
    else describe(named, { preserveReaderState: true });
  }

  function show(stage) {
    active = stage;
    buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stage === stage)));
    const result = stage === 'raw' ? results.get('bricks') ?? results.get('adjusted') : results.get(stage);
    viewer.setModel(stage === 'raw' ? rawModel : result.brickModel, { frameModel: rawModel });
    note.textContent = stage === 'raw' ? 'Original geometry and colors. No construction changes.' : stage === 'adjusted'
      ? `${number(result.metrics.structuralAddedVoxelCount)} source voxels added for local connections. ${result.metrics.adjustmentSearch?.packingRetiled ? "Packing reworked. " : ""}Height rounding also applies. Buildability unverified.`
      : 'Bricks with measured height rounding. Thin details may change; buildability unverified.';
    if (result) describe(result);
  }

  async function convert(stage, selectWhenReady) {
    if (pending) return;
    const currentOperation = ++operationId;
    pending = stage;
    buttons.filter(b => b.dataset.stage !== 'raw').forEach(b => { b.disabled = true; });
    note.textContent = stage === 'adjusted' ? 'Checking bounded local adjustments…' : 'Converting locally… Raw geometry is preserved.';
    try {
      const result = await constructionClient.convert({ rawModel, sourceProgram, adjustments: stage === 'adjusted' }, { signal: controller.signal });
      if (disposed || currentOperation !== operationId) return;
      results.set(stage, result);
      if (!initialGuideReady) onPhase?.('guide');
      loading.hidden = true;
      if (selectWhenReady && requestedStage === stage) show(stage);
      else { describe(results.get('bricks') ?? result); note.textContent = 'Original preserved. Bricks are ready to compare.'; }
      if (!initialGuideReady) {
        initialGuideReady = true;
        if (result.instructionPlan ?? result.assemblyPlan) onReady?.(result);
        else onError?.(new Error(result.assemblyError || 'No assembly plan returned.'));
      }
      if (stage === 'adjusted') nameAdjustedGuide(result).catch(error => {
        if (!disposed && error.name !== 'AbortError') note.textContent = `Section naming stopped: ${error.message}`;
      });
    } catch (error) {
      if (!disposed && currentOperation === operationId && error.name !== 'AbortError') {
        note.textContent = `Conversion stopped: ${error.message}`;
        loading.textContent = 'Instructions unavailable';
        loading.hidden = false;
        if (!initialGuideReady) onError?.(error);
      }
    } finally {
      if (!disposed && currentOperation === operationId) {
        pending = null;
        buttons.forEach(b => { b.disabled = false; });
      }
    }
  }
  buttons.forEach(button => { button.onclick = () => {
    const stage = button.dataset.stage;
    requestedStage = stage;
    if (stage === 'raw' || results.has(stage)) show(stage);
    else convert(stage, true);
  }; });
  const onReaderScroll = () => applyDeferredSemanticResult();
  window.addEventListener('scroll', onReaderScroll, { passive: true });
  convert('adjusted', true);
  return () => {
    disposed = true;
    controller.abort();
    window.removeEventListener('scroll', onReaderScroll);
    disposeBooklet?.();
  };
}
