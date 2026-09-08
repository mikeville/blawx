import { ProductViewer } from '../../../src/product-viewer.js';
import { createGuideSections } from '../../../src/guide-sections.js';
import { deriveGuidePresentation } from '../../../src/guide-presentation.js';
import { createGuideNumbering, formatGuideStepRange } from '../../../src/guide-numbering.js';
import { escapeMarkup as escape, inventoryMarkup, tallyParts } from '../../../src/part-illustration.js';
import { createSemanticGuideClient, nameConstructionGuide } from '../../../src/semantic-guide-client.js';
import { getSavedResult } from './data.js';

const semanticClient = createSemanticGuideClient();
const sortedInventory = items => [...items].sort((a, b) =>
  a.color.localeCompare(b.color) || (b.w * b.d) - (a.w * a.d));

function resultModel(result, byId, ids) {
  return {
    ...result.brickModel,
    kind: 'bricks',
    bricks: ids.map(id => byId.get(id)).filter(Boolean),
  };
}

export function mountGuide(host, { set }) {
  const controller = new AbortController();
  let disposed = false;
  let request = 0;
  let observer = null;
  let activeChapter = null;
  const mounted = new Map();
  const visible = new Set();

  host.classList.add('r2-guide');
  host.innerHTML = '<p class="r2-guide__loading" role="status">Preparing instructions…</p>';

  function release(canvas) {
    const record = mounted.get(canvas);
    if (!record) return;
    canvas.dataset.azimuth = String(record.viewer.azimuth);
    record.viewer.dispose();
    mounted.delete(canvas);
    const replacement = canvas.cloneNode(false);
    observer?.unobserve(canvas);
    visible.delete(canvas);
    canvas.replaceWith(replacement);
    observer?.observe(replacement);
  }

  function releaseAll() {
    observer?.disconnect();
    observer = null;
    visible.clear();
    for (const canvas of [...mounted.keys()]) {
      mounted.get(canvas)?.viewer.dispose();
      mounted.delete(canvas);
    }
  }

  function mountCanvas(canvas, specs, result, byId) {
    if (disposed || mounted.has(canvas) || mounted.size >= 3) return;
    const spec = specs[Number(canvas.dataset.diagram)];
    if (!spec) return;
    const viewer = new ProductViewer(canvas);
    canvas.removeEventListener('pointermove', viewer.onMove);
    viewer.onMove = (event) => {
      if (!viewer.dragStart) return;
      viewer.azimuth = viewer.dragStart.azimuth - (event.clientX - viewer.dragStart.x) * 0.012;
      viewer.updateCamera();
    };
    canvas.addEventListener('pointermove', viewer.onMove);
    const visibleModel = resultModel(result, byId, spec.visible);
    viewer.setModel(visibleModel, {
      frameModel: visibleModel,
      highlightIds: new Set(spec.highlight),
      insertionDirection: spec.insertionDirection,
      animate: false,
    });
    if (canvas.dataset.azimuth) {
      viewer.azimuth = Number(canvas.dataset.azimuth);
      viewer.updateCamera();
    }
    mounted.set(canvas, { viewer });
    canvas.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      viewer.turn(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  function fillAvailable(specs, result, byId) {
    for (const canvas of visible) {
      if (mounted.size >= 3) break;
      if (canvas.isConnected) mountCanvas(canvas, specs, result, byId);
    }
  }

  function renderChapter(details, section, context) {
    releaseAll();
    activeChapter = details;
    const { result, plan, numbering, byId, byStep } = context;
    const specs = [];
    const diagrams = section.groups.flatMap(group => group.stepIds).map(stepId => {
      const step = byStep.get(stepId);
      if (!step) return '';
      const specIndex = specs.push({
        visible: step.visibleBrickIds,
        highlight: step.highlightBrickIds,
        insertionDirection: step.insertionDirection,
      }) - 1;
      const number = numbering.byStepId.get(step.id);
      const warning = step.kind === 'unresolved' || step.issues?.length
        ? '<span class="r2-guide__issue" title="Connection needs review" aria-label="Connection needs review">△</span>'
        : '';
      const direction = step.insertionDirection === 'up'
        ? '<span class="r2-guide__direction">From below</span>'
        : '';
      return `<figure class="r2-guide__diagram">
        <figcaption><strong>${number}</strong>${direction}${warning}</figcaption>
        <div class="r2-guide__canvas-wrap"><canvas tabindex="0" data-diagram="${specIndex}" aria-label="${escape(section.label)}, step ${number}"></canvas></div>
      </figure>`;
    });

    const readingParts = section.parts ?? [];
    let diagramCursor = 0;
    const diagramMarkup = readingParts.length > 1
      ? readingParts.map((part, index) => {
          const count = part.stepIds.length;
          const contents = diagrams.slice(diagramCursor, diagramCursor + count).join('');
          diagramCursor += count;
          const range = numbering.partRanges.get(part.id);
          return `<details class="r2-guide__range" ${index === 0 ? 'open' : ''}>
            <summary aria-label="Steps ${range.start} through ${range.end}">${formatGuideStepRange(range)}</summary>${contents}
          </details>`;
        }).join('')
      : diagrams.join('');

    let placement = '';
    if (section.repeatCount > 1) {
      const highlight = section.instances.flatMap(instance => instance.brickIds);
      const index = specs.push({ visible: plan.bricks.map(brick => brick.id), highlight }) - 1;
      placement = `<figure class="r2-guide__diagram r2-guide__placement">
        <figcaption><strong>${section.repeatCount}×</strong></figcaption>
        <div class="r2-guide__canvas-wrap"><canvas tabindex="0" data-diagram="${index}" aria-label="${escape(section.label)}, all ${section.repeatCount} positions"></canvas></div>
      </figure>`;
    }

    details.querySelector('.r2-guide__chapter-body').innerHTML = `
      <details class="r2-guide__section-parts"><summary>Parts</summary>
        <ul class="r2-guide__parts">${inventoryMarkup(sortedInventory(section.totalInventory ?? section.inventory))}</ul>
      </details>${diagramMarkup}${placement}`;

    details.querySelectorAll('.r2-guide__range').forEach(range => range.addEventListener('toggle', () => {
      if (!range.open) range.querySelectorAll('canvas').forEach(release);
    }));

    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const range = entry.target.closest('.r2-guide__range');
        if (entry.isIntersecting && (!range || range.open)) visible.add(entry.target);
        else {
          visible.delete(entry.target);
          release(entry.target);
        }
      }
      fillAvailable(specs, result, byId);
    }, { rootMargin: '100px 0px' });
    details.querySelectorAll('canvas').forEach(canvas => observer.observe(canvas));
  }

  async function load() {
    const token = ++request;
    try {
      const savedResult = await getSavedResult(set.id);
      if (disposed || token !== request) return;
      const subject = savedResult.rawModel?.meta?.prompt ?? set.prompt;
      const result = await nameConstructionGuide(savedResult, {
        subject,
        client: semanticClient,
        signal: controller.signal,
        allowInference: false,
      });
      if (disposed || token !== request) return;
      const plan = result.instructionPlan ?? result.assemblyPlan;
      if (!plan) throw new Error('No assembly plan');
      const guide = result.semanticGuide ?? result.guide ?? createGuideSections(plan);
      const presentation = deriveGuidePresentation({ plan, guide, subject });
      const numbering = createGuideNumbering(presentation.sections);
      const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
      const byStep = new Map(plan.steps.map(step => [step.id, step]));
      const inventory = plan.inventory ?? tallyParts(plan.bricks);
      const unresolved = plan.steps.filter(step => step.kind === 'unresolved' || step.issues?.length).length;

      host.innerHTML = `<div class="r2-guide__inner">
        <header class="r2-guide__title"><h2>Instructions</h2></header>
        <details class="r2-guide__total-parts"><summary><span>Parts</span><b>${plan.bricks.length}</b></summary>
          <ul class="r2-guide__parts">${inventoryMarkup(sortedInventory(inventory))}</ul>
        </details>
        <div class="r2-guide__chapters">${presentation.sections.map((section, index) => {
          const range = numbering.sectionRanges.get(section.id);
          return `<details class="r2-guide__chapter" data-index="${index}">
            <summary><strong>${formatGuideStepRange(range)}</strong><span>${escape(section.label)}</span>${section.repeatCount > 1 ? `<b>${section.repeatCount}×</b>` : ''}</summary>
            <div class="r2-guide__chapter-body"></div>
          </details>`;
        }).join('')}</div>
        <details class="r2-guide__developer"><summary>Developer</summary>
          <p>Draft · Saved ${escape(set.id)} · ${plan.bricks.length} bricks · ${numbering.diagramCount} diagrams · ${unresolved} connection-review diagrams.</p>
          <p>Frozen baseline snapshot; adjustment and refinement are not applied in this layout study.</p>
          ${result.semanticAnnotation ? '<p>Section names are inferred from the saved guide and its geometry. Structural coverage is validated; semantic accuracy is unverified.</p>' : ''}
          ${result.semanticMetadata?.correction?.provenance ? `<p>${escape(result.semanticMetadata.correction.provenance)}</p>` : ''}
          ${plan.limitations?.length ? `<p>${escape(plan.limitations.join(' '))}</p>` : ''}
        </details>
      </div>`;

      const chapters = [...host.querySelectorAll('.r2-guide__chapter')];
      const context = { result, plan, numbering, byId, byStep };
      let anchorFrame = 0;
      const restoreSummaryPosition = (summary, top) => {
        if (!summary.isConnected) return;
        // Sticky summary bounds are clamped to 64px and hide the real
        // document shift. Anchor from its non-sticky chapter instead.
        const chapter = summary.parentElement;
        const border = parseFloat(getComputedStyle(chapter).borderTopWidth) || 0;
        const flowTop = chapter.getBoundingClientRect().top + window.scrollY + border;
        window.scrollTo(0, Math.max(0, flowTop - Math.max(64, top)));
      };
      const toggleChapter = (details, summary) => {
        const top = summary.getBoundingClientRect().top;
        const willOpen = !details.open;

        if (activeChapter && activeChapter !== details) {
          releaseAll();
          activeChapter.querySelector('.r2-guide__chapter-body').replaceChildren();
          activeChapter.open = false;
          activeChapter = null;
        }

        if (!willOpen) {
          if (activeChapter === details) {
            releaseAll();
            activeChapter = null;
            details.querySelector('.r2-guide__chapter-body').replaceChildren();
          }
          details.open = false;
        } else {
          details.open = true;
          renderChapter(details, presentation.sections[Number(details.dataset.index)], context);
        }

        restoreSummaryPosition(summary, top);
        cancelAnimationFrame(anchorFrame);
        anchorFrame = requestAnimationFrame(() => {
          restoreSummaryPosition(summary, top);
        });
      };
      chapters.forEach(details => details.querySelector(':scope > summary').addEventListener('click', event => {
        event.preventDefault();
        toggleChapter(details, event.currentTarget);
      }));
      if (chapters[0]) {
        chapters[0].open = true;
        renderChapter(chapters[0], presentation.sections[0], context);
      }
    } catch (error) {
      if (!disposed && token === request) host.innerHTML = '<p class="r2-guide__loading">Instructions unavailable</p>';
    }
  }

  load();
  return {
    dispose() {
      disposed = true;
      request += 1;
      controller.abort();
      releaseAll();
      host.replaceChildren();
      host.classList.remove('r2-guide');
    },
  };
}
