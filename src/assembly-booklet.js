import { escapeMarkup as escape, inventoryMarkup } from './part-illustration.js';
import { createBookletPresentation, createChapterDiagramData, guideRangeMarkup, resolveBookletInitialState } from './assembly-booklet-presentation.js';
import { createBookletRenderer } from './assembly-booklet-renderer.js';
import { mountBookletNavigation } from './assembly-booklet-navigation.js';
import './assembly-booklet.css';

export function mountAssemblyBooklet(host, {
  result, subject = null, diagnosticsHost, onReaderStateChange = null, readerState = null,
}) {
  const view = createBookletPresentation(result, subject);
  if (!view) {
    host.innerHTML = '<p>Instructions unavailable</p>';
    if (diagnosticsHost) diagnosticsHost.textContent = result.assemblyError ?? 'No assembly plan returned.';
    return () => host.replaceChildren();
  }
  const { sourcePlan, plan, sourceGuide, presentation, numbering } = view;
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const initialState = resolveBookletInitialState(readerState, presentation.sections.length);
  let disposed = false;
  let renderer = null;
  let activeDetails = null;
  const sorted = inventory => [...inventory].sort((a,b) => a.color.localeCompare(b.color) || b.w*b.d-a.w*a.d);

  host.innerHTML = `<div class="manual-scroll">
    <div class="manual-title"><h2 tabindex="-1">Instructions</h2></div>
    <details class="manual-total-parts"${initialState.partsOpen ? ' open' : ''}><summary><span>Parts</span><span>${plan.bricks.length}</span></summary><ul class="manual-inventory-grid">${inventoryMarkup(sorted(plan.inventory))}</ul></details>
    <div class="manual-sections">${presentation.sections.map((section,index)=>{const range=numbering.sectionRanges.get(section.id);return `<details class="manual-chapter" data-chapter="${index}" data-first-step="${escape(section.groups.flatMap(group=>group.stepIds)[0] ?? '')}"><summary><strong class="manual-range-label">${guideRangeMarkup(range)}</strong><span>${escape(section.label)}</span>${section.repeatCount>1 ? `<b class="manual-repeat">${section.repeatCount}×</b>` : ''}</summary><div class="manual-chapter-body"></div></details>`}).join('')}</div>
  </div>`;
  const disposeNavigation = mountBookletNavigation(host);

  if (readerState) {
    const anchorIndex = presentation.sections.findIndex(section =>
      section.groups.some(group => group.stepIds.includes(readerState.anchorStepId)));
    const anchor = anchorIndex >= 0
      ? host.querySelector(`.manual-chapter[data-chapter="${anchorIndex}"] > summary`)
      : null;
    if (anchor && Number.isFinite(readerState.anchorTop)) {
      window.scrollBy(0, anchor.getBoundingClientRect().top - readerState.anchorTop);
    } else if (Number.isFinite(readerState.scrollY)) {
      window.scrollTo(0, readerState.scrollY);
    }
  }

  if (diagnosticsHost) {
    const semanticEvidence = result.semanticAnnotation?.sections?.map(section =>
      `<li>${escape(section.label ?? 'Uncertain section')} (${section.confidence === 'uncertain' ? 'Uncertain; generic heading used' : 'Inferred; confidence not measured'}): ${escape(section.evidence)}</li>`).join('') ?? '';
    const semanticMetadata = result.semanticMetadata
      ? `${result.semanticMetadata.cacheHit ? 'Saved receipt' : 'New receipt'}${result.semanticMetadata.actualModel ? ` · ${escape(result.semanticMetadata.actualModel)}` : ''}${Number.isFinite(result.semanticMetadata.annotationMs) ? ` · ${Math.round(result.semanticMetadata.annotationMs)} ms` : ''}`
      : '';
    const semanticCorrection = result.semanticMetadata?.correction?.provenance;
    diagnosticsHost.innerHTML = `<details><summary>Assembly diagnostics</summary><p>Draft · ${plan.bricks.length} bricks · ${sourceGuide.sections.length} source sections · ${presentation.sections.length} displayed sections · ${numbering.diagramCount} numbered diagrams.</p><p>${plan.stats.unresolvedStepCount} unresolved diagrams · ${plan.stats.rootFailureCount} unsupported roots · ${plan.stats.unresolvedBrickCount} unresolved bricks. Coverage: ${plan.stats.coverageComplete ? 'complete' : 'incomplete'}.</p><p>${escape(plan.limitations.join(' '))}</p>${result.semanticStatus ? `<p>${escape(result.semanticStatus)}</p>` : ''}${semanticMetadata ? `<p>${semanticMetadata}</p>` : ''}${semanticCorrection ? `<p>${escape(semanticCorrection)}</p>` : ''}${semanticEvidence ? `<ol>${semanticEvidence}</ol>` : ''}<p>Repetition changes presentation only; inventory includes every instance.</p><ol>${plan.steps.filter(step=>step.issues.length).map(step=>`<li>${escape(step.id)} — ${escape([...new Set(step.issues.map(issue=>issue.message))].join(' '))}</li>`).join('')}</ol></details>`;
    if (result.assemblySequence) {
      const sequence = result.assemblySequence;
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>Sequence: ${escape(sequence.selectedPolicy)} · ${sequence.upwardStepCount} underside attachments · ${sequence.sequencingMs.toFixed(1)} ms. Unsupported roots ${sequence.baseline.rootFailureCount} → ${plan.stats.rootFailureCount}; unresolved bricks ${sequence.baseline.unresolvedBrickCount} → ${plan.stats.unresolvedBrickCount}. ${escape(sequence.scope)} ${escape(sequence.rejectionReasons.join('; '))}</p>`);
    }
    if (result.assemblyEvaluation) {
      const evaluation = result.assemblyEvaluation;
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>${sourcePlan.steps.length} checked source operations → ${plan.steps.length} instruction diagrams before repeated recipes. Late foundations ${evaluation.before.lateFoundationCount} → ${evaluation.after.lateFoundationCount}; downward returns ${evaluation.before.downwardReturnCount} → ${evaluation.after.downwardReturnCount}. ${escape(evaluation.scope)}</p>`);
    }
    if (result.rootRefinement) {
      const repair = result.rootRefinement;
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>Root repair: ${repair.before.rootFailureCount} → ${repair.after.rootFailureCount} unsupported roots; ${repair.before.unresolvedOldCellCount} → ${repair.after.unresolvedOldCellCount} unresolved original stud-course cells. ${repair.accepted.length} selected changes; ${repair.addedCellCount} added stud-course cells; ${repair.refinementMs.toFixed(1)} ms. ${escape(repair.limitations)}</p>`);
    }
    if (result.subassemblyRefinement) {
      const assembly = result.subassemblyRefinement;
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>Subassemblies: ${assembly.before.rootFailureCount} → ${assembly.after.rootFailureCount} unsupported roots; ${assembly.before.unresolvedBrickCount} → ${assembly.after.unresolvedBrickCount} unresolved bricks. ${assembly.evaluatedCount} candidates; ${assembly.selected ? 'one selected' : 'original retained'}; ${assembly.stageMs.toFixed(1)} ms. ${escape(assembly.limitations)}</p>`);
    }
    if (result.attachmentRefinement) {
      const repair = result.attachmentRefinement;
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>Attachment repair: ${repair.before.unresolvedBrickCount} → ${repair.after.unresolvedBrickCount} unresolved bricks; ${repair.before.groundlessComponentCount} → ${repair.after.groundlessComponentCount} detached components. ${repair.accepted.length} selected changes; ${repair.addedCellCount} added stud-course cells; ${repair.stageMs.toFixed(1)} ms. ${escape(repair.limitations)}</p>`);
    }
    if (result.workSurfaceOrdering) {
      const order = result.workSurfaceOrdering;
      const grouping = order.before.grouping && order.after.grouping
        ? ` Rectangle fill ${(order.before.grouping.rectangularCoverageRatio * 100).toFixed(1)}% → ${(order.after.grouping.rectangularCoverageRatio * 100).toFixed(1)}%; partial-line exposure ${order.before.grouping.partialLineExposure} → ${order.after.grouping.partialLineExposure}.` : '';
      diagnosticsHost.querySelector('summary').insertAdjacentHTML('afterend', `<p>Table ordering: ${order.selected ? `${escape(order.policy)} selected` : 'prior order retained'}; peak loose bricks ${order.before.canonical.peakLooseBrickCount} → ${order.after.canonical.peakLooseBrickCount}; band diagrams ${order.before.bandDiagramCount} → ${order.after.bandDiagramCount}; ${order.orderingMs.toFixed(1)} ms.${grouping} ${escape(order.rejectionReasons.join('; '))} ${escape(order.limitations)}</p>`);
    }
  }

  function releaseAll() {
    renderer?.dispose();
    renderer = null;
  }
  function expandChapter(details) {
    if (disposed) return;
    if (activeDetails && activeDetails!==details) {
      activeDetails.open = false;
      activeDetails.querySelector('.manual-chapter-body').replaceChildren();
    }
    releaseAll();
    activeDetails = details;
    const section = presentation.sections[+details.dataset.chapter];
    const chapter = createChapterDiagramData(section, plan, numbering);
    const specs = chapter.specs;
    const warning = '<span class="manual-issue" title="Connection needs review" aria-label="Connection needs review">△</span>';
    const figure = spec => {
        const number = String(spec.number);
        const downwardJoin = spec.joinContext?.direction === 'down';
        const direction = downwardJoin ? '<span class="manual-direction">Attach</span>'
          : spec.insertionDirection === 'up' ? '<span class="manual-direction">From below</span>' : '';
        const supportCount = spec.joinContext?.supportGroups?.length ?? 0;
        const action = downwardJoin ? ` · lower the assembled section onto ${supportCount} ${supportCount === 1 ? 'support' : 'supports'}`
          : spec.insertionDirection === 'up' ? ' · attach from below' : '';
        return `<figure class="manual-diagram" data-step-id="${escape(spec.stepId)}"><figcaption><strong>${number}</strong>${direction}${spec.unresolved ? warning : ''}</figcaption><div class="manual-canvas-wrap"><canvas tabindex="0" data-diagram="${spec.index}" aria-label="${escape(section.label)} · step ${number}${action}"></canvas></div></figure>`;
    };
    let placements = '';
    if (section.repeatCount>1) {
      const ids = section.instances.flatMap(instance=>instance.brickIds);
      const specIndex = specs.push({ visible:plan.bricks.map(brick=>brick.id), highlight:ids, insertionDirection:null, joinContext:null })-1;
      placements = `<figure class="manual-diagram manual-placement"><figcaption><strong>${section.repeatCount}×</strong></figcaption><div class="manual-canvas-wrap"><canvas tabindex="0" data-diagram="${specIndex}" aria-label="${escape(section.label)} · positions of all ${section.repeatCount} copies"></canvas></div></figure>`;
    }
    const figures = chapter.parts.length === 1
      ? `<div class="manual-diagram-grid">${chapter.parts[0].figures.map(figure).join('')}${placements}</div>`
      : chapter.parts.map((part,index)=>`<details class="manual-reading" ${index===0?'open':''}><summary aria-label="Steps ${part.range.start} through ${part.range.end}"><span class="manual-range-label">${guideRangeMarkup(part.range)}</span></summary><div class="manual-diagram-grid">${part.figures.map(figure).join('')}${index===chapter.parts.length-1?placements:''}</div></details>`).join('');
    details.querySelector('.manual-chapter-body').innerHTML = `<details class="manual-section-parts"><summary>Parts</summary><ul class="manual-inventory-grid">${inventoryMarkup(sorted(section.totalInventory ?? section.inventory))}</ul></details>${figures}`;
    renderer = createBookletRenderer({ result, byId });
    details.querySelectorAll('canvas').forEach(canvas=>renderer.observe(canvas,specs[+canvas.dataset.diagram]));
    details.querySelectorAll('.manual-reading').forEach(part=>{
      part.addEventListener('toggle',()=>{
        renderer?.refreshWithin(part);
        if (!part.open) return;
        if (!details.open) return;
        details.querySelectorAll('.manual-reading').forEach(other=>{if(other!==part) other.open=false;});
      });
    });
  }
  host.querySelectorAll('.manual-chapter').forEach(details=>{
    details.addEventListener('toggle',()=>{
      if (details.open) expandChapter(details);
      else if (activeDetails===details) {
        releaseAll();activeDetails=null;details.querySelector('.manual-chapter-body').replaceChildren();
      }
      onReaderStateChange?.({ hasOpenChapter: Boolean(host.querySelector('.manual-chapter[open]')) });
    });
  });
  const initial = initialState.openChapterIndex >= 0
    ? host.querySelector(`.manual-chapter[data-chapter="${initialState.openChapterIndex}"]`) : null;
  if (initial) initial.open = true;
  return ()=>{disposed=true;releaseAll();disposeNavigation();host.replaceChildren();diagnosticsHost?.replaceChildren();};
}
