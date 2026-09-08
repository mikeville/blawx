import { SETS, FEATURED_IDS, RECENT_IDS } from './data.js';
import { mountHero } from './hero.js';
import { mountGuide } from './guide.js';
import { mountViewportLayout } from './viewport.js';
import { mountComposer } from './composer.js';
import { mountGuideNavigation } from './guide-navigation.js';
import { createEntranceGate } from './hero-motion.js';

const setById = new Map(SETS.map(set => [set.id, set]));
const featured = FEATURED_IDS.map(id => setById.get(id)).filter(Boolean);
const recent = RECENT_IDS.map(id => setById.get(id)).filter(Boolean);

const homeView = document.querySelector('#home-view');
const detailView = document.querySelector('#detail-view');
const homeHeroHost = document.querySelector('#home-hero');
const detailHeroHost = document.querySelector('#detail-hero');
const guideHost = document.querySelector('#guide-host');
const form = document.querySelector('#prompt-form');
const promptInput = document.querySelector('#prompt');
const formMessage = document.querySelector('#form-message');
const gallery = document.querySelector('#gallery');
const showMore = document.querySelector('#show-more');
const detailTitle = document.querySelector('#detail-title');
const detailPrompt = document.querySelector('#detail-prompt');
const brandHome = document.querySelector('#brand-home');
const composer = document.querySelector('.composer');

const requestedComposer = new URLSearchParams(window.location.search).get('composer');
const composerMode = ['inline', 'fixed', 'floating'].includes(requestedComposer) ? requestedComposer : 'fixed';
document.body.dataset.composer = composerMode;
if (composerMode === 'floating') document.body.append(composer);
const composerController = mountComposer({ composer, promptInput, form, mode: composerMode });
const viewportLayout = mountViewportLayout({ composer, promptInput });
const guideNavigation = mountGuideNavigation({ host: guideHost, detailView });

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
document.body.classList.add('input-type');
brandHome.href = `${window.location.pathname}${window.location.search}`;

const entrance = createEntranceGate();
let galleryCount = Math.min(3, recent.length);
let homeScrollY = 0;
let homeHero;
let detailHero;
let guide;
let detailSelected = false;
let returningHome = false;
let homeReturnFocus;
const galleryStages = new Map();

// Only visible gallery models own GPU resources. Scrolling never generates a set.
const galleryObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const record = galleryStages.get(entry.target);
    if (!record) continue;
    record.visible = entry.isIntersecting;
    if (record.visible && !detailSelected) {
      record.viewer ??= mountHero(entry.target, { set: record.set, animate: false, onOpen: () => openSet(record.set) });
    } else {
      record.viewer?.dispose();
      record.viewer = undefined;
    }
  }
}, { rootMargin: '60px 0px' });

function disposeGallery() {
  for (const record of galleryStages.values()) {
    record.viewer?.dispose();
    record.viewer = undefined;
  }
}

function assertContract() {
  if (!SETS.length || !featured.length || !recent.length) {
    throw new Error('Round 2 data contract requires non-empty SETS, FEATURED_IDS, and RECENT_IDS.');
  }
  if (typeof mountHero !== 'function' || typeof mountGuide !== 'function') {
    throw new TypeError('Round 2 renderer contract is unavailable.');
  }
}

function currentFeatured() {
  return featured[0];
}

function takeEntrance() {
  return entrance(reducedMotion.matches);
}

function renderGallery() {
  gallery.append(...recent.slice(gallery.children.length, galleryCount).map(set => {
    const card = document.createElement('article');
    card.className = 'set-card';
    const stage = document.createElement('div');
    stage.className = 'card-stage';
    stage.dataset.set = set.id;
    galleryStages.set(stage, { set, viewer: undefined, visible: false });
    galleryObserver.observe(stage);

    const caption = document.createElement('button');
    caption.type = 'button';
    caption.className = 'card-caption';
    caption.setAttribute('aria-label', `Open set: ${set.prompt}`);
    const prompt = document.createElement('span');
    prompt.className = 'card-prompt';
    prompt.textContent = set.prompt;
    caption.append(prompt);
    card.append(stage, caption);
    card.addEventListener('click', event => {
      // Dragging the canvas must never open the detail via a bubbling click.
      if (!event.target.closest('.card-stage')) openSet(set);
    });
    return card;
  }));
  showMore.hidden = galleryCount >= recent.length;
}

function findSavedSet(value) {
  const normalized = value.trim().toLocaleLowerCase();
  return SETS.find(set => set.prompt.toLocaleLowerCase() === normalized || set.title.toLocaleLowerCase() === normalized);
}

function openSet(set) {
  if (!detailSelected) {
    homeScrollY = window.scrollY;
    homeReturnFocus = document.activeElement;
  }
  if (window.location.hash === `#set/${encodeURIComponent(set.id)}`) {
    composerController.setRoute(true);
    window.scrollTo(0, 0);
    detailTitle.focus({ preventScroll: true });
    return;
  }
  window.location.hash = `set/${encodeURIComponent(set.id)}`;
}

function mountHomeHero() {
  if (homeHero) return;
  homeHero = mountHero(homeHeroHost, {
    set: currentFeatured(),
    onOpen: () => openSet(currentFeatured()),
    animate: takeEntrance(),
  });
}

function disposeDetail() {
  detailHero?.dispose();
  guide?.dispose();
  detailHero = undefined;
  guide = undefined;
  detailHeroHost.replaceChildren();
  guideHost.replaceChildren();
}

function showHome() {
  detailSelected = false;
  disposeDetail();
  detailView.hidden = true;
  homeView.hidden = false;
  composerController.setRoute(false);
  mountHomeHero();
  document.title = 'Blawx';
  renderGallery();
  guideNavigation.update();
  if (returningHome) {
    requestAnimationFrame(() => {
      window.scrollTo(0, homeScrollY);
      if (homeReturnFocus?.isConnected) homeReturnFocus.focus({ preventScroll: true });
    });
    returningHome = false;
  }
}

function showDetail(set) {
  detailSelected = true;
  disposeGallery();
  homeHero?.dispose();
  homeHero = undefined;
  homeHeroHost.replaceChildren();
  disposeDetail();
  homeView.hidden = true;
  detailView.hidden = false;
  composerController.setRoute(true);
  detailTitle.textContent = set.title;
  detailPrompt.textContent = set.prompt;
  detailPrompt.hidden = set.title.toLowerCase() === set.prompt.toLowerCase();
  document.title = `${set.title} — Blawx`;
  detailHero = mountHero(detailHeroHost, { set, onOpen: undefined, animate: takeEntrance() });
  guide = mountGuide(guideHost, { set });
  window.scrollTo(0, 0);
  detailTitle.focus({ preventScroll: true });
  guideNavigation.update();
}

function route() {
  const match = window.location.hash.match(/^#set\/([^/]+)$/);
  if (!match) {
    showHome();
    return;
  }
  let id;
  try { id = decodeURIComponent(match[1]); } catch { id = ''; }
  const set = setById.get(id);
  if (!set) {
    history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    showHome();
    return;
  }
  showDetail(set);
}

form.addEventListener('submit', event => {
  if (event.defaultPrevented) return;
  event.preventDefault();
  promptInput.closest('.prompt-field')?.classList.add('is-invited');
  if (!promptInput.value.trim()) {
    formMessage.textContent = '';
    promptInput.focus({ preventScroll: true });
    return;
  }
  const set = findSavedSet(promptInput.value);
  if (!set) {
    formMessage.textContent = 'Choose a saved set for this preview.';
    return;
  }
  formMessage.textContent = '';
  openSet(set);
});

promptInput.addEventListener('input', () => {
  formMessage.textContent = '';
  form.classList.toggle('has-prompt', Boolean(promptInput.value.trim()));
});

homeHeroHost.closest('.home-hero')?.addEventListener('click', event => {
  // Canvas taps are handled by mountHero so drag gestures can be distinguished.
  if (event.target.closest('canvas')) return;
  openSet(currentFeatured());
});
showMore.addEventListener('click', () => {
  const previousCount = galleryCount;
  galleryCount = Math.min(galleryCount + 3, recent.length);
  renderGallery();
  gallery.children[previousCount]?.querySelector('button')?.focus({ preventScroll: true });
});
brandHome.addEventListener('click', event => {
  event.preventDefault();
  if (!detailSelected) {
    window.scrollTo(0, 0);
    return;
  }
  returningHome = true;
  history.pushState(null, '', `${window.location.pathname}${window.location.search}`);
  route();
});

window.addEventListener('hashchange', () => {
  returningHome = !window.location.hash;
  route();
});
window.addEventListener('pagehide', event => {
  if (!event.persisted) {
    viewportLayout.dispose();
    composerController.dispose();
    guideNavigation.dispose();
  }
});

assertContract();
renderGallery();
route();
