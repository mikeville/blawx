import { createGuideSections } from '../../../src/guide-sections.js';
import { deriveGuidePresentation } from '../../../src/guide-presentation.js';
import { createGuideNumbering } from '../../../src/guide-numbering.js';
import { escapeMarkup as escape, inventoryMarkup, tallyParts } from '../../../src/part-illustration.js';
import { nameConstructionGuide } from '../../../src/semantic-guide-client.js';
import { getSavedResult } from './data.js';
import { createSharedGuideRenderer } from './guide-renderer.js';
import { guideRangeMarkup } from './guide-range.js';
import { createSemanticReviewClient } from './semantic-review-client.js';

const semanticClient = createSemanticReviewClient({ search: globalThis.location?.search ?? '' });
const sortedInventory = items => [...items].sort((a, b) =>
  a.color.localeCompare(b.color) || (b.w * b.d) - (a.w * a.d));

export function mountGuide(host, { set }) {
  const controller = new AbortController();
  let disposed = false;
  let request = 0;
  let diagramRenderer = null;
  let activeChapter = null;

  host.classList.add('r2-guide');
  host.innerHTML = '<p class="r2-guide__loading" role="status">Preparing instructions…</p>';

  function releaseAll() {
    diagramRenderer?.dispose();
    diagramRenderer = null;
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

    let placement = '';
    if (section.repeatCount > 1) {
      const highlight = section.instances.flatMap(instance => instance.brickIds);
      const index = specs.push({ visible: plan.bricks.map(brick => brick.id), highlight }) - 1;
      placement = `<figure class="r2-guide__diagram r2-guide__placement">
        <figcaption><strong>${section.repeatCount}×</strong></figcaption>
        <div class="r2-guide__canvas-wrap"><canvas tabindex="0" data-diagram="${index}" aria-label="${escape(section.label)}, all ${section.repeatCount} positions"></canvas></div>
      </figure>`;
    }

    const readingParts = section.parts ?? [];
    let diagramCursor = 0;
    const diagramMarkup = readingParts.length > 1
      ? readingParts.map((part, index) => {
          const count = part.stepIds.length;
          const contents = diagrams.slice(diagramCursor, diagramCursor + count).join('');
          diagramCursor += count;
          const range = numbering.partRanges.get(part.id);
          const finalPlacement = index === readingParts.length - 1 ? placement : '';
          return `<details class="r2-guide__range" ${index === 0 ? 'open' : ''}>
            <summary aria-label="Steps ${range.start} through ${range.end}"><span class="r2-guide__range-label">${guideRangeMarkup(range)}</span></summary>
            <div class="r2-guide__diagram-grid">${contents}${finalPlacement}</div>
          </details>`;
        }).join('')
      : `<div class="r2-guide__diagram-grid">${diagrams.join('')}${placement}</div>`;

    details.querySelector('.r2-guide__chapter-body').innerHTML = `
      <details class="r2-guide__section-parts"><summary>Parts</summary>
        <ul class="r2-guide__parts">${inventoryMarkup(sortedInventory(section.totalInventory ?? section.inventory))}</ul>
      </details>${diagramMarkup}`;

    details.querySelectorAll('.r2-guide__range').forEach(range => range.addEventListener('toggle', () => {
      diagramRenderer?.refreshWithin(range);
    }));
    diagramRenderer = createSharedGuideRenderer({ result, byId });
    details.querySelectorAll('canvas').forEach(canvas => {
      const spec = specs[Number(canvas.dataset.diagram)];
      if (spec) diagramRenderer.observe(canvas, spec);
    });
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
            <summary><strong class="r2-guide__range-label">${guideRangeMarkup(range)}</strong><span>${escape(section.label)}</span>${section.repeatCount > 1 ? `<b>${section.repeatCount}×</b>` : ''}</summary>
            <div class="r2-guide__chapter-body"></div>
          </details>`;
        }).join('')}</div>
        <details class="r2-guide__developer"><summary>Developer</summary>
          <p>Draft · Saved ${escape(set.id)} · ${plan.bricks.length} bricks · ${numbering.diagramCount} diagrams · ${unresolved} connection-review diagrams.</p>
          <p>Frozen baseline snapshot; adjustment and refinement are not applied in this layout study.</p>
          ${semanticClient.reviewId ? `<p>Naming review ${escape(semanticClient.reviewId)} · saved exact-fingerprint candidate.</p>` : ''}
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
