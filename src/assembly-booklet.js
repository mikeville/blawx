import { ProductViewer } from './product-viewer.js';
import { createGuideSections } from './guide-sections.js';
import { deriveGuidePresentation } from './guide-presentation.js';
import { createGuideNumbering, formatGuideStepRange } from './guide-numbering.js';
import { escapeMarkup as escape, inventoryMarkup } from './part-illustration.js';

export function mountAssemblyBooklet(host, {
  result, subject = null, diagnosticsHost, onReaderStateChange = null, readerState = null,
}) {
  const sourcePlan = result.assemblyPlan;
  const plan = result.instructionPlan ?? sourcePlan;
  if (!plan) {
    host.innerHTML = '<p>Instructions unavailable</p>';
    if (diagnosticsHost) diagnosticsHost.textContent = result.assemblyError ?? 'No assembly plan returned.';
    return () => host.replaceChildren();
  }
  const sourceGuide = result.guide ?? createGuideSections(plan);
  const guide = result.semanticGuide ?? sourceGuide;
  const presentation = deriveGuidePresentation({ plan, guide, subject });
  const numbering = createGuideNumbering(presentation.sections);
  const byId = new Map(plan.bricks.map(brick => [brick.id, brick]));
  const byStep = new Map(plan.steps.map(step => [step.id, step]));
  const mounted = new Map();
  let disposed = false;
  let observer = null;
  let activeDetails = null;
  const sorted = inventory => [...inventory].sort((a,b) => a.color.localeCompare(b.color) || b.w*b.d-a.w*a.d);
  const model = ids => ({ ...result.brickModel, bricks: ids.map(id=>byId.get(id)).filter(Boolean) });

  host.innerHTML = `<div class="manual-scroll">
    <div class="manual-title"><h2>Instructions</h2><span class="manual-draft">Draft</span></div>
    <details class="manual-total-parts"${readerState?.partsOpen === false ? '' : ' open'}><summary><span>Parts</span><span>${plan.bricks.length}</span></summary><ul class="manual-inventory-grid">${inventoryMarkup(sorted(plan.inventory))}</ul></details>
    <div class="manual-sections">${presentation.sections.map((section,index)=>`<details class="manual-chapter" data-chapter="${index}" data-first-step="${escape(section.groups.flatMap(group=>group.stepIds)[0] ?? '')}"><summary><strong>${index+1}</strong><span>${escape(section.label)}</span>${section.repeatCount>1 ? `<b class="manual-repeat">${section.repeatCount}×</b>` : ''}</summary><div class="manual-chapter-body"></div></details>`).join('')}</div>
  </div>`;

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
      `<li>${escape(section.label ?? 'Uncertain section')} (${escape(section.confidence)}): ${escape(section.evidence)}</li>`).join('') ?? '';
    const semanticMetadata = result.semanticMetadata
      ? `${result.semanticMetadata.cacheHit ? 'Saved receipt' : 'New receipt'}${result.semanticMetadata.actualModel ? ` · ${escape(result.semanticMetadata.actualModel)}` : ''}${Number.isFinite(result.semanticMetadata.annotationMs) ? ` · ${Math.round(result.semanticMetadata.annotationMs)} ms` : ''}`
      : '';
    const semanticCorrection = result.semanticMetadata?.correction?.provenance;
    diagnosticsHost.innerHTML = `<details><summary>Assembly diagnostics</summary><p>${plan.bricks.length} bricks · ${sourceGuide.sections.length} source sections · ${presentation.sections.length} displayed sections · ${numbering.diagramCount} numbered diagrams.</p><p>${plan.stats.unresolvedStepCount} unresolved diagrams · ${plan.stats.rootFailureCount} unsupported roots · ${plan.stats.unresolvedBrickCount} unresolved bricks. Coverage: ${plan.stats.coverageComplete ? 'complete' : 'incomplete'}.</p><p>${escape(plan.limitations.join(' '))}</p>${result.semanticStatus ? `<p>${escape(result.semanticStatus)}</p>` : ''}${semanticMetadata ? `<p>${semanticMetadata}</p>` : ''}${semanticCorrection ? `<p>${escape(semanticCorrection)}</p>` : ''}${semanticEvidence ? `<ol>${semanticEvidence}</ol>` : ''}<p>Repetition changes presentation only; inventory includes every instance.</p><ol>${plan.steps.filter(step=>step.issues.length).map(step=>`<li>${escape(step.id)} — ${escape([...new Set(step.issues.map(issue=>issue.message))].join(' '))}</li>`).join('')}</ol></details>`;
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
  }

  function release(canvas) {
    const item = mounted.get(canvas);
    if (!item) return;
    canvas.dataset.azimuth = String(item.viewer.azimuth);
    item.viewer.dispose();
    mounted.delete(canvas);
    // A disposed WebGL context cannot be reused on the same canvas.
    // Keep its accessible label and view angle, then lazily allocate a fresh one.
    const replacement = canvas.cloneNode(false);
    replacement.removeAttribute('data-rendered');
    observer?.unobserve(canvas);
    canvas.replaceWith(replacement);
    observer?.observe(replacement);
  }
  function releaseAll() {
    observer?.disconnect();
    observer = null;
    for (const canvas of [...mounted.keys()]) release(canvas);
  }
  function mountDiagram(canvas, spec) {
    if (disposed || mounted.has(canvas)) return;
    const viewer = new ProductViewer(canvas);
    viewer.setModel(model(spec.visible), { frameModel:model(spec.visible), highlightIds:new Set(spec.highlight), insertionDirection:spec.insertionDirection, joinContext:spec.joinContext, animate:false });
    if (canvas.dataset.azimuth) {
      viewer.azimuth = +canvas.dataset.azimuth;
      viewer.updateCamera();
    }
    mounted.set(canvas,{viewer,spec});
    canvas.dataset.rendered = 'true';
    canvas.onkeydown = event => {
      if (event.key==='ArrowLeft' || event.key==='ArrowRight') {
        event.preventDefault();viewer.turn(event.key==='ArrowLeft'?-1:1);
      }
    };
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
    const specs = [];
    const warning = '<span class="manual-issue" title="Connection needs review" aria-label="Connection needs review">△</span>';
    const groupFigures = section.groups.map(group=>{
      return group.stepIds.map(id=>{
        const step = byStep.get(id);
        const joinContext = step.kind === 'join' ? step.joinContext : null;
        const specIndex = specs.push({ visible:step.visibleBrickIds, highlight:step.highlightBrickIds, insertionDirection:step.insertionDirection, joinContext })-1;
        const number = String(numbering.byStepId.get(id));
        const downwardJoin = joinContext?.direction === 'down';
        const direction = downwardJoin ? '<span class="manual-direction">Attach</span>'
          : step.insertionDirection === 'up' ? '<span class="manual-direction">From below</span>' : '';
        const supportCount = joinContext?.supportGroups?.length ?? 0;
        const action = downwardJoin ? ` · lower the assembled section onto ${supportCount} ${supportCount === 1 ? 'support' : 'supports'}`
          : step.insertionDirection === 'up' ? ' · attach from below' : '';
        return `<figure class="manual-diagram"><figcaption><strong>${number}</strong>${direction}${step.kind==='unresolved' ? warning : ''}</figcaption><div class="manual-canvas-wrap"><canvas tabindex="0" data-diagram="${specIndex}" aria-label="${escape(section.label)} · step ${number}${action}"></canvas></div></figure>`;
      }).join('');
    });
    const readingParts = section.parts ?? [{groupIds:section.groups.map(group=>group.id)}];
    const figures = readingParts.length === 1 ? groupFigures.join('') : readingParts.map((part,index)=>{
      const indexes = part.groupIds.map(id=>section.groups.findIndex(group=>group.id===id));
      const range = numbering.partRanges.get(part.id);
      return `<details class="manual-reading" ${index===0?'open':''}><summary aria-label="Steps ${range.start} through ${range.end}">${formatGuideStepRange(range)}</summary>${indexes.map(i=>groupFigures[i]).join('')}</details>`;
    }).join('');
    let placements = '';
    if (section.repeatCount>1) {
      const ids = section.instances.flatMap(instance=>instance.brickIds);
      const specIndex = specs.push({ visible:plan.bricks.map(brick=>brick.id), highlight:ids })-1;
      placements = `<figure class="manual-diagram manual-placement"><figcaption><strong>${section.repeatCount}×</strong></figcaption><div class="manual-canvas-wrap"><canvas tabindex="0" data-diagram="${specIndex}" aria-label="${escape(section.label)} · positions of all ${section.repeatCount} copies"></canvas></div></figure>`;
    }
    details.querySelector('.manual-chapter-body').innerHTML = `<details class="manual-section-parts"><summary>Parts</summary><ul class="manual-inventory-grid">${inventoryMarkup(sorted(section.totalInventory ?? section.inventory))}</ul></details>${figures}${placements}`;
    details.querySelectorAll('.manual-reading').forEach(part=>{
      part.addEventListener('toggle',()=>{
        if (!part.open) {
          part.querySelectorAll('canvas').forEach(release);
          return;
        }
        if (!details.open) return;
        details.querySelectorAll('.manual-reading').forEach(other=>{if(other!==part) other.open=false;});
        part.querySelector('summary').scrollIntoView({block:'start'});
      });
    });
    const canvases = [...details.querySelectorAll('canvas')];
    observer = new IntersectionObserver(entries=>{
      for (const entry of entries) {
        const reading = entry.target.closest('.manual-reading');
        if (entry.isIntersecting && details.open && (!reading || reading.open)) mountDiagram(entry.target,specs[+entry.target.dataset.diagram]);
        else release(entry.target);
      }
    }, {rootMargin:'80px 0px'});
    canvases.forEach(canvas=>observer.observe(canvas));
    details.querySelector('summary').scrollIntoView({block:'start'});
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
  return ()=>{disposed=true;releaseAll();host.replaceChildren();diagnosticsHost?.replaceChildren();};
}
