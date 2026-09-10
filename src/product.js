import './composer.css';
import './product.css';
import './generation-progress.css';
import { createGenerationClient, createStaticGenerationClient } from './generation-client.js';
import { createFeedClient } from './feed-client.js';
import { createExampleClient } from './example-client.js';
import { createPreviewClient } from './preview-client.js';
import { mountModelStage } from './model-stage.js';
import { mountRecentFeed } from './recent-feed.js';
import { mountConstructionComparison } from './construction-comparison.js';
import { mountComposer } from './composer.js';
import { mountViewportLayout } from './viewport-layout.js';
import { loadViewState, saveViewState } from './feed-view-state.js';
import { FEATURED_SET_IDS } from './featured-sets.js';
import { generationDiagnosticRows } from './generation-diagnostics.js';
import { HERO_ROTATION_DEFAULTS } from './hero-rotation.js';
import { mountPromptField } from './prompt-field.js';
import { mountGenerationProgress } from './generation-progress.js';
import { isGenerationEnabled, isLocalSemanticNamingEnabled } from './app-path.js';
import { isDeveloperMode } from './developer-mode.js';
import { mountScrollAwareHeader } from './scroll-aware-header.js';
import { openFullscreenLayer } from './fullscreen-layer.js';
import { MAX_PROMPT_CHARACTERS, promptSizeTier, truncatePrompt } from './prompt-policy.js';
import { homeHref, resultHref, shouldHandleLinkClick } from './link-navigation.js';

export function mountProductApp(host, options = {}) {
  const {
  generationClient: providedGenerationClient,
  generationEnabled = isGenerationEnabled(),
  feedClient = createFeedClient(),
  exampleClient = createExampleClient(),
  previewClient = createPreviewClient(),
  allowSemanticInference = isLocalSemanticNamingEnabled(),
  constructionClient,
  stageFactory = mountModelStage,
  comparisonFactory = mountConstructionComparison,
  progressFactory = mountGenerationProgress,
  recentFactory = mountRecentFeed,
  composerFactory = mountComposer,
  viewportFactory = mountViewportLayout,
  promptFieldFactory = mountPromptField,
  scrollHeaderFactory = mountScrollAwareHeader,
  generationEstimateRange = null,
  developerMode = isDeveloperMode(),
  } = options;
  const generationClient = providedGenerationClient ?? (generationEnabled ? createGenerationClient() : createStaticGenerationClient());
  const developerFooter = developerMode
    ? `<footer class="developer-footer"><details class="developer-tools"><summary>Developer</summary><div class="developer-body"><p class="developer-record"></p><div class="developer-generation"></div><div class="developer-construction"></div></div></details></footer>`
    : '';
  host.innerHTML = `<header class="brand-strip"><a class="brand" href="#" aria-label="Blawx home">Blawx</a><button class="about-link" type="button">About</button></header>
    <main><div id="home-view"><section class="home-lead" aria-label="Featured set and prompt"><div class="home-hero"><div class="hero-mount"></div></div>
      <div class="composer"><form id="prompt-form" novalidate><label class="sr-only" for="prompt">What would you like to build?</label><div class="prompt-field"><div class="prompt-invitation" aria-hidden="true"><span>What would you</span> <span>like to build?<span class="invitation-caret"></span></span></div><textarea id="prompt" rows="1" maxlength="${MAX_PROMPT_CHARACTERS}" autocomplete="off" spellcheck="true" placeholder=" " enterkeyhint="go"></textarea></div><button class="make-button" type="submit">Make it</button><div class="prompt-status"><p id="public-use" class="public-use" hidden>Prompts &amp; sets are public</p></div></form><p id="form-message" class="form-message" role="status"></p></div></section><section class="recent-host"></section></div>
      <div id="detail-view" hidden><article class="set-detail"><div class="detail-hero hero-mount"></div><header class="detail-copy"><h1 id="detail-title" tabindex="-1"></h1><div class="generation-progress-host"></div><p class="detail-prompt"></p><span class="result-note" role="status"></span></header></article><section class="instructions"><div class="guide-host"></div></section></div></main>
    ${developerFooter}`;

  const home = host.querySelector('#home-view');
  const detail = host.querySelector('#detail-view');
  const composer = host.querySelector('.composer');
  const form = host.querySelector('#prompt-form');
  const input = host.querySelector('#prompt');
  const promptStatus = host.querySelector('.prompt-status');
  const publicUse = promptStatus.querySelector('#public-use');
  const message = host.querySelector('.form-message');
  const recentHost = host.querySelector('.recent-host');
  const homeHeroHost = host.querySelector('.home-hero .hero-mount');
  const detailHeroHost = host.querySelector('.detail-hero');
  const detailTitle = host.querySelector('.detail-copy h1');
  const detailPrompt = host.querySelector('.detail-copy p');
  const progressHost = host.querySelector('.generation-progress-host');
  const resultNote = host.querySelector('.result-note');
  const instructions = host.querySelector('.instructions');
  const guideHost = host.querySelector('.guide-host');
  const devRecord = host.querySelector('.developer-record') ?? document.createElement('p');
  const devGeneration = host.querySelector('.developer-generation') ?? document.createElement('div');
  const devConstruction = host.querySelector('.developer-construction') ?? document.createElement('div');
  const brand = host.querySelector('.brand');
  brand.setAttribute('href', homeHref(location));
  const aboutLink = host.querySelector('.about-link');
  const scrollHeader = scrollHeaderFactory(host.querySelector('.brand-strip'));
  const makeButton = form.querySelector('.make-button');
  const storageMode = `product:${location.pathname}`;
  const restored = loadViewState({ mode: storageMode, recentCount: 9999 });
  input.value = truncatePrompt(restored.prompt);
  form.classList.toggle('has-prompt', Boolean(input.value.trim()));
  document.body.dataset.composer = 'circle';
  const composerController = composerFactory({ composer, promptInput: input, form, mode: 'circle', homeHost: host.querySelector('.home-lead') });
  const viewport = viewportFactory({ composer, promptInput: input });
  const promptField = promptFieldFactory({ input, form, publicNote: publicUse });
  const promptStatusParent = promptStatus.parentNode;
  const promptStatusNext = promptStatus.nextSibling;
  const generated = new Map();
  let activeFeedClient = feedClient;
  let feed;
  let homeStage;
  let detailStage;
  let comparisonDispose;
  let progressController;
  let activeRequest;
  let lastPrompt = '';
  let homeScrollY = restored.homeScrollY;
  let disposed = false;
  let entranceAvailable = true;
  let routeVersion = 0;
  let featuredResult;
  let detailRequest;
  let galleryCount = Math.max(9, restored.galleryCount);
  let sourceFocusId = null;
  let handledLocation = '';
  let aboutLayer = null;

  const locationKey = () => `${location.pathname}${location.search}${location.hash}`;

  const mobileProgress = window.matchMedia?.('(max-width: 760px)') ?? { matches: false };

  function placePendingPromptStatus() {
    if (!activeRequest || !progressController) return;
    const target = mobileProgress.matches ? document.body : progressController.statusHost;
    (target ?? document.body).append(promptStatus);
  }

  const onProgressViewportChange = () => placePendingPromptStatus();
  mobileProgress.addEventListener?.('change', onProgressViewportChange);

  function restorePromptStatus() {
    promptStatusParent.insertBefore(promptStatus, promptStatusNext?.parentNode === promptStatusParent ? promptStatusNext : null);
  }

  function persist() {
    saveViewState({ mode: storageMode, recentCount: 9999, state: { prompt: truncatePrompt(input.value), galleryCount, homeScrollY: home.hidden ? homeScrollY : window.scrollY } });
  }
  function setDetailTitle(text, { prompt = false } = {}) {
    detailTitle.textContent = text;
    if (prompt) detailTitle.dataset.promptSize = promptSizeTier(text);
    else delete detailTitle.dataset.promptSize;
  }
  function showMessage(text, actionLabel, action) {
    message.replaceChildren(document.createTextNode(text));
    if (!actionLabel) return;
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = actionLabel; button.onclick = action;
    message.append(' ', button);
  }
  function openAbout() {
    const content = document.createElement('div');
    content.className = 'fullscreen-about-content';
    content.innerHTML = `<p>An <a href="https://github.com/mikeville/blawx" target="_blank" rel="noreferrer">open-source</a> community project, not affiliated with or endorsed by the LEGO Group.</p><p>See <a href="https://mikemake.com/" target="_blank" rel="noreferrer">more projects</a> by Mike.</p>`;
    aboutLayer = openFullscreenLayer({
      content,
      className: 'fullscreen-about',
      label: 'About Blawx',
      returnFocus: aboutLink,
      onClose: () => { aboutLayer = null; },
    });
  }
  async function refreshLibrary() {
    if (activeFeedClient !== exampleClient) { void feed?.refresh(); return; }
    const page = await feedClient.list().catch(() => null);
    if (disposed || !page?.items.length) return;
    feed?.dispose();
    activeFeedClient = feedClient;
    feed = recentFactory(recentHost, {
      client: feedClient, previewClient, onOpenSet: openId, initialPage: page,
      onChange: ({ count }) => { galleryCount = count; persist(); },
    });
    if (home.hidden) feed.suspend();
  }
  function resultClientFor(id) { return id.startsWith('example-') ? exampleClient : feedClient; }
  async function getResult(id, options) { return generated.get(id) ?? resultClientFor(id).getResult(id, options); }
  function clearDetail() {
    detailRequest?.abort(); detailRequest = null;
    detailStage?.dispose(); detailStage = null;
    comparisonDispose?.(); comparisonDispose = null;
    progressController?.dispose(); progressController = null;
    restorePromptStatus();
    detailHeroHost.replaceChildren(); guideHost.replaceChildren(); devConstruction.replaceChildren();
    devRecord.textContent = ''; devGeneration.replaceChildren();
    detail.classList.remove('is-generated-result');
    instructions.hidden = false;
  }

  function setSubmissionPending(pending) {
    if (pending) form.setAttribute('aria-busy', 'true');
    else form.removeAttribute('aria-busy');
    input.readOnly = pending;
    makeButton.disabled = pending;
    promptStatus.classList.toggle('is-pending', pending);
    promptField.sync();
  }

  function finishActiveRequest(job) {
    if (activeRequest !== job) return false;
    activeRequest = null;
    progressController?.complete(); progressController = null;
    restorePromptStatus();
    setSubmissionPending(false);
    return true;
  }

  function cancelActiveRequest({ returnHome = false } = {}) {
    const job = activeRequest;
    if (!job) return false;
    activeRequest = null;
    job.controller.abort();
    comparisonDispose?.(); comparisonDispose = null;
    progressController?.dispose(); progressController = null;
    restorePromptStatus();
    setSubmissionPending(false);
    if (returnHome) {
      history.replaceState(null, '', location.pathname + location.search);
      handledLocation = locationKey();
      message.textContent = '';
      void mountHome();
    }
    return true;
  }
  function renderGenerationDiagnostics(result) {
    const rows = generationDiagnosticRows(result, result.browserWaitMs);
    if (!rows.length) { devGeneration.replaceChildren(); return; }
    const list = document.createElement('dl');
    for (const row of rows) {
      const item = document.createElement('div');
      const term = document.createElement('dt'); term.textContent = row.label;
      const value = document.createElement('dd'); value.textContent = row.value;
      item.append(term, value); list.append(item);
    }
    if (result.saveStatus === 'failed' && !result.cacheHit) {
      const note = document.createElement('p'); note.textContent = 'Result-store save failed';
      devGeneration.replaceChildren(list, note);
    } else devGeneration.replaceChildren(list);
  }
  async function mountFeatured() {
    try {
      if (!featuredResult) {
        for (const id of FEATURED_SET_IDS) {
          try { featuredResult = await getResult(id); break; } catch {}
        }
      }
      if (!featuredResult) throw new Error('Featured set unavailable.');
      const model = await previewClient.prepare(featuredResult.model);
      if (disposed || home.hidden || homeStage) return;
      homeStage = stageFactory(homeHeroHost, { model, label: `${featuredResult.prompt}, featured interactive 3D LEGO-style set`, onOpen: () => openId(featuredResult.id), animate: entranceAvailable, heroRotation: HERO_ROTATION_DEFAULTS });
      entranceAvailable = false;
    } catch {
      if (!disposed && !home.hidden) homeHeroHost.innerHTML = '<span class="stage-unavailable">Featured set unavailable</span>';
    }
  }
  function openId(id) {
    if (!detail.hidden) return;
    homeScrollY = window.scrollY; persist();
    sourceFocusId = id;
    navigateId(id);
  }
  function navigateId(id) {
    const next = resultHref(id);
    if (location.hash === next) route(true);
    else location.hash = next;
  }

  async function chooseLibrary() {
    if (!generationEnabled) return { client: exampleClient, page: await exampleClient.list() };
    try {
      const page = await feedClient.list();
      if (page.items.length) return { client: feedClient, page };
    } catch { return { client: feedClient, page: null }; }
    return { client: exampleClient, page: await exampleClient.list() };
  }

  async function mountHome() {
    const currentRoute = ++routeVersion;
    clearDetail(); detail.hidden = true; home.hidden = false; composerController.setRoute(false);
    setSubmissionPending(false);
    input.value = '';
    input.closest('.prompt-field').classList.remove('is-invited');
    promptField.sync();
    document.title = 'Blawx';
    mountFeatured();
    if (!feed) {
      const library = await chooseLibrary();
      if (disposed || currentRoute !== routeVersion) return;
      activeFeedClient = library.client;
      feed = recentFactory(recentHost, {
        client: activeFeedClient, previewClient, examples: activeFeedClient === exampleClient, onOpenSet: openId,
        initialPage: library.page, restoreCount: galleryCount,
        onChange: ({ count }) => { galleryCount = count; persist(); },
      });
    }
    feed?.resume();
    await feed?.ready;
    if (disposed || currentRoute !== routeVersion) return;
    requestAnimationFrame(() => {
      if (currentRoute !== routeVersion) return;
      window.scrollTo(0, homeScrollY);
      if (sourceFocusId) host.querySelector(`[data-result-id="${CSS.escape(sourceFocusId)}"]`)?.closest('.feed-card')?.focus({ preventScroll: true });
    });
  }

  function beginGeneratedDetail(job) {
    job.routeVersion = ++routeVersion;
    if (!home.hidden) { homeScrollY = window.scrollY; persist(); }
    home.hidden = true;
    detail.hidden = false;
    composerController.setRoute(true);
    feed?.suspend();
    homeStage?.dispose(); homeStage = null;
    clearDetail();
    detail.classList.add('is-generated-result');
    instructions.hidden = true;
    input.blur();
    setSubmissionPending(true);
    window.scrollTo(0, 0);
    setDetailTitle(job.prompt, { prompt: true });
    detailPrompt.textContent = '';
    resultNote.textContent = '';
    document.title = `${job.prompt} — Blawx`;
    detailStage = stageFactory(detailHeroHost, {
      loading: true,
      label: `Building ${job.prompt}, interactive 3D LEGO-style set`,
      animate: false,
      heroRotation: HERO_ROTATION_DEFAULTS,
    });
    progressController = progressFactory(progressHost, {
      estimateRange: generationEstimateRange,
      elapsedHost: promptStatus,
      onCancel: () => cancelActiveRequest({ returnHome: true }),
    });
    placePendingPromptStatus();
  }

  function rememberGeneratedResult(result, prompt, browserWaitMs) {
    const id = result.resultId || `unsaved-${result.requestId}`;
    const publicResult = {
      ...result,
      id,
      createdAt: result.createdAt ?? new Date().toISOString(),
      browserWaitMs: result.cacheHit ? undefined : browserWaitMs,
    };
    if (result.saveStatus === 'failed') {
      generated.set(id, publicResult);
      if (generated.size > 8) generated.delete(generated.keys().next().value);
    } else feedClient.remember?.(publicResult);
    input.value = result.submittedPrompt ?? prompt;
    promptField.sync();
    persist();
    return publicResult;
  }

  async function continueGeneratedDetail(job, result) {
    const id = result.id;
    const next = resultHref(id);
    history.pushState(null, '', next);
    handledLocation = locationKey();
    job.resultId = id;
    sourceFocusId = null;
    setDetailTitle(result.submittedPrompt ?? job.prompt, { prompt: true });
    detailPrompt.textContent = '';
    resultNote.textContent = result.saveStatus === 'failed' ? 'This set wasn’t added to Recently made.' : '';
    document.title = `${detailTitle.textContent} — Blawx`;
    devRecord.textContent = typeof result.provenance === 'string' ? result.provenance : result.saveStatus === 'failed' ? 'Unsaved local result' : `Public result · ${result.id}`;
    renderGenerationDiagnostics(result);

    job.phase = 'bricks';
    progressController?.setPhase('bricks');
    detailStage?.setModel(result.model, {
      animate: true,
      frameModel: result.model,
      label: `${result.prompt}, 1×1 brick preview; final pieces and instructions in progress`,
    });
    detailStage?.setLoading?.(false);
    entranceAvailable = false;

    const finishGuide = () => {
      if (disposed || activeRequest !== job || job.routeVersion !== routeVersion) return;
      instructions.hidden = false;
      finishActiveRequest(job);
    };
    try {
      comparisonDispose = comparisonFactory(guideHost, {
        rawModel: result.model,
        sourceProgram: result.sourceProgram ?? null,
        viewer: detailStage,
        devHost: devConstruction,
        subject: result.prompt,
        allowSemanticInference: !result.example && allowSemanticInference,
        constructionClient,
        hideLoadingMessage: true,
        onPhase: phase => {
          if (phase !== 'guide' || disposed || activeRequest !== job || job.routeVersion !== routeVersion) return;
          job.phase = phase;
          progressController?.setPhase(phase);
        },
        onReady: finishGuide,
        onError: finishGuide,
      });
    } catch (error) {
      if (disposed || activeRequest !== job || job.routeVersion !== routeVersion) return;
      guideHost.innerHTML = '<p class="guide-loading" role="status">Instructions unavailable</p>';
      instructions.hidden = false;
      finishActiveRequest(job);
    }
    if (result.saveStatus !== 'failed' && !result.cacheHit) void refreshLibrary();
  }

  async function mountDetail(id) {
    const currentRoute = ++routeVersion;
    if (!home.hidden) { homeScrollY = window.scrollY; persist(); }
    home.hidden = true; detail.hidden = false; composerController.setRoute(true);
    feed?.suspend();
    homeStage?.dispose(); homeStage = null; clearDetail();
    detailRequest = new AbortController();
    const signal = detailRequest.signal;
    window.scrollTo(0, 0);
    setDetailTitle('Loading set'); detailPrompt.textContent = ''; resultNote.textContent = '';
    try {
      const result = await getResult(id, { signal });
      if (disposed || currentRoute !== routeVersion) return;
      setDetailTitle(result.prompt, { prompt: true });
      detailPrompt.textContent = '';
      resultNote.textContent = result.saveStatus === 'failed' ? 'This set wasn’t added to Recently made.' : '';
      document.title = `${detailTitle.textContent} — Blawx`;
      detailStage = stageFactory(detailHeroHost, { model: result.model, label: `${result.prompt}, 1×1 brick preview; final pieces and instructions in progress`, animate: entranceAvailable, heroRotation: HERO_ROTATION_DEFAULTS });
      entranceAvailable = false;
      devRecord.textContent = typeof result.provenance === 'string' ? result.provenance : result.example ? 'Saved example' : result.saveStatus === 'failed' ? 'Unsaved local result' : `Public result · ${result.id}`;
      renderGenerationDiagnostics(result);
      instructions.hidden = true;
      progressController = progressFactory(progressHost, { initialPhase: 'bricks' });
      const finishDetail = () => {
        if (disposed || currentRoute !== routeVersion) return;
        instructions.hidden = false;
        progressController?.complete();
        progressController = null;
      };
      try {
        comparisonDispose = comparisonFactory(guideHost, {
          rawModel: result.model,
          sourceProgram: result.sourceProgram ?? null,
          viewer: detailStage,
          devHost: devConstruction,
          subject: result.prompt,
          allowSemanticInference: !result.example && allowSemanticInference,
          constructionClient,
          hideLoadingMessage: true,
          onPhase: phase => {
            if (phase === 'guide' && !disposed && currentRoute === routeVersion) progressController?.setPhase(phase);
          },
          onReady: finishDetail,
          onError: finishDetail,
        });
      } catch {
        guideHost.innerHTML = '<p class="guide-loading" role="status">Instructions unavailable</p>';
        finishDetail();
      }
      detailTitle.focus({ preventScroll: true });
    } catch (error) {
      if (disposed || currentRoute !== routeVersion || error.name === 'AbortError') return;
      setDetailTitle('Set unavailable'); detailPrompt.textContent = error.message;
    }
  }

  function route(force = false) {
    const nextLocation = locationKey();
    if (force !== true && nextLocation === handledLocation) return;
    handledLocation = nextLocation;
    cancelActiveRequest();
    setSubmissionPending(false);
    message.textContent = '';
    const match = location.hash.match(/^#set\/([A-Za-z0-9_-]+)$/);
    if (!match) { mountHome(); return; }
    let id = ''; try { id = decodeURIComponent(match[1]); } catch {}
    if (!id) { history.replaceState(null, '', location.pathname + location.search); mountHome(); return; }
    mountDetail(id);
  }

  async function generate(prompt) {
    if (activeRequest) return;
    if (!generationEnabled) {
      showMessage('Live generation is being prepared. Explore the saved sets below, or clone the repo and use your own API key to generate freely.');
      return;
    }
    const job = { controller: new AbortController(), prompt, phase: 'designing', routeVersion: 0 };
    activeRequest = job;
    lastPrompt = prompt;
    message.textContent = '';
    beginGeneratedDetail(job);
    try {
      const startedAt = performance.now();
      const result = await generationClient.generate(prompt, { signal: job.controller.signal });
      const browserWaitMs = performance.now() - startedAt;
      if (activeRequest !== job || job.controller.signal.aborted || disposed || job.routeVersion !== routeVersion) return;
      await continueGeneratedDetail(job, rememberGeneratedResult(result, prompt, browserWaitMs));
    } catch (error) {
      if (activeRequest !== job || error.name === 'AbortError') return;
      activeRequest = null;
      progressController?.dispose(); progressController = null;
      restorePromptStatus();
      setSubmissionPending(false);
      history.replaceState(null, '', location.pathname + location.search);
      handledLocation = locationKey();
      await mountHome();
      if (!disposed && !home.hidden) {
        if (error.code === 'static-demo') showMessage(error.message);
        else showMessage(error.message || 'Couldn’t make that set.', 'Try again', () => generate(lastPrompt));
      }
    }
  }

  form.addEventListener('submit', event => { if (event.defaultPrevented) return; event.preventDefault(); const value = input.value.trim(); if (!value) { input.closest('.prompt-field').classList.add('is-invited'); input.focus({ preventScroll: true }); return; } generate(value); });
  input.addEventListener('input', () => { if (!activeRequest) message.textContent = ''; input.closest('.prompt-field').classList.remove('is-invited'); form.classList.toggle('has-prompt', Boolean(input.value.trim())); persist(); });
  brand.addEventListener('click', event => {
    if (!shouldHandleLinkClick(event)) return;
    event.preventDefault();
    if (activeRequest) { cancelActiveRequest({ returnHome: true }); return; }
    if (location.hash) location.hash = '';
    else if (home.hidden) void mountHome();
    else window.scrollTo(0, 0);
  });
  aboutLink.addEventListener('click', openAbout);
  const onPageHide = () => { persist(); cancelActiveRequest(); };
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  window.addEventListener('pagehide', onPageHide);
  route();

  return { dispose() { disposed = true; aboutLayer?.close({ restoreFocus: false }); aboutLayer = null; aboutLink.removeEventListener('click', openAbout); cancelActiveRequest(); feed?.dispose(); homeStage?.dispose(); clearDetail(); previewClient.dispose?.(); promptField.dispose(); composerController.dispose(); viewport.dispose(); scrollHeader.dispose(); mobileProgress.removeEventListener?.('change', onProgressViewportChange); window.removeEventListener('hashchange', route); window.removeEventListener('popstate', route); window.removeEventListener('pagehide', onPageHide); host.replaceChildren(); } };
}

const defaultHost = document.querySelector('#app');
if (defaultHost && !defaultHost.children.length) mountProductApp(defaultHost);
