import { normalizeSetHash } from './routes.js';

const SIZES = new Set(['desktop', 'tablet', 'phone']);
const appFrame = document.querySelector('#app-frame');
const studyFrame = document.querySelector('#study-frame');
const studiesView = document.querySelector('#studies-view');
const viewport = document.querySelector('.viewport');
const studiesLink = document.querySelector('#studies-link');
const backLink = document.querySelector('#back-link');
const openLink = document.querySelector('#open-link');
const roundOneLink = document.querySelector('#round-one-link');
let studyMode = null;

function parseRoute(hash = location.hash) {
  const current = normalizeSetHash(hash);
  if (current || !hash) return { archive: false, mode: 'circle', setHash: current };
  const match = hash.match(/^#studies(?:\/(inline|fixed|floating))?(?:\/set\/([A-Za-z0-9_-]+))?$/);
  if (!match) return { archive: false, mode: 'circle', setHash: '' };
  return { archive: true, mode: match[1] ?? 'inline', setHash: match[2] ? `#set/${match[2]}` : '' };
}

function archiveHash(mode, setHash) {
  return `#studies/${mode}${setHash ? setHash.replace(/^#/, '/') : ''}`;
}

function appSource(mode, setHash, preview = true) {
  return `./app.html?composer=${mode}${preview ? '&preview=1' : ''}${setHash}`;
}

function setParentRoute(hash, { replace = false, state = history.state } = {}) {
  if (hash === location.hash) return render();
  const url = `${location.pathname}${location.search}${hash}`;
  if (replace) history.replaceState(state, '', url);
  else history.pushState(state, '', url);
  render();
}

function desiredChildHash(frame) {
  const route = parseRoute();
  if (frame === appFrame) return route.archive ? normalizeSetHash(history.state?.blawxReturnHash) : route.setHash;
  return route.archive ? route.setHash : '';
}

function sendRoute(frame) {
  frame.contentWindow?.postMessage({ type: 'blawx:route', hash: desiredChildHash(frame) }, location.origin);
}

function currentPreviewUrl(route) {
  const currentHash = route.archive
    ? normalizeSetHash(history.state?.blawxReturnHash)
    : route.setHash;
  return `${location.origin}${location.pathname}${location.search}${currentHash}`;
}

function migrateLegacyUrl() {
  const params = new URLSearchParams(location.search);
  const legacy = params.get('composer');
  if (!['inline', 'fixed', 'floating', 'circle'].includes(legacy)) return;
  params.delete('composer');
  const setHash = normalizeSetHash(location.hash);
  const hash = legacy === 'circle' ? setHash : archiveHash(legacy, setHash);
  const query = params.toString();
  history.replaceState(history.state, '', `${location.pathname}${query ? `?${query}` : ''}${hash}`);
}

function render() {
  const route = parseRoute();
  const requestedSize = new URLSearchParams(location.search).get('size');
  const size = SIZES.has(requestedSize) ? requestedSize : 'phone';
  viewport.dataset.size = size;
  document.querySelectorAll('[data-size]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.size === size)));
  appFrame.hidden = route.archive;
  studiesView.hidden = !route.archive;
  studiesLink.hidden = route.archive;
  backLink.href = history.state?.blawxReturnHash || location.pathname + location.search;
  if (!appFrame.getAttribute('src')) appFrame.src = appSource('circle', desiredChildHash(appFrame));
  sendRoute(appFrame);
  if (route.archive) {
    const source = appSource(route.mode, route.setHash);
    if (!studyFrame.getAttribute('src')) studyFrame.src = source;
    else if (studyMode !== route.mode) studyFrame.contentWindow.location.replace(source);
    else sendRoute(studyFrame);
    studyMode = route.mode;
  }
  document.querySelectorAll('[data-study]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.study === route.mode)));
  openLink.href = appSource(route.mode, route.setHash, false);
  roundOneLink.href = `../index.html?returnTo=${encodeURIComponent(currentPreviewUrl(route))}`;
}

document.querySelectorAll('[data-size]').forEach(button => button.addEventListener('click', () => {
  const params = new URLSearchParams(location.search);
  params.set('size', button.dataset.size);
  history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`);
  render();
}));
document.querySelectorAll('[data-study]').forEach(button => button.addEventListener('click', () => {
  const route = parseRoute();
  setParentRoute(archiveHash(button.dataset.study, route.setHash), { state: { ...history.state, blawxReturnHash: history.state?.blawxReturnHash || '' } });
}));
studiesLink.addEventListener('click', event => {
  event.preventDefault();
  const route = parseRoute();
  setParentRoute(archiveHash('inline', route.setHash), { state: { ...history.state, blawxReturnHash: route.setHash } });
});
backLink.addEventListener('click', event => {
  event.preventDefault();
  setParentRoute(normalizeSetHash(history.state?.blawxReturnHash));
});
window.addEventListener('message', event => {
  if (event.origin !== location.origin || ![appFrame.contentWindow, studyFrame.contentWindow].includes(event.source)) return;
  if (event.data?.type === 'blawx:ready') return sendRoute(event.source === appFrame.contentWindow ? appFrame : studyFrame);
  if (event.data?.type !== 'blawx:navigate') return;
  const route = parseRoute();
  const activeFrame = route.archive ? studyFrame : appFrame;
  if (event.source !== activeFrame.contentWindow) return;
  const setHash = normalizeSetHash(event.data.hash);
  setParentRoute(route.archive ? archiveHash(route.mode, setHash) : setHash, { replace: event.data.replace === true });
});
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);
migrateLegacyUrl();
render();
