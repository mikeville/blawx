import { mountModelStage } from './model-stage.js';

export function formatAge(createdAt, now = Date.now()) {
  const time = Date.parse(createdAt);
  if (!Number.isFinite(time)) return '';
  const minutes = Math.floor(Math.max(0, now - time) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

export function mergeFeedPage(existing, page) {
  const items = [];
  const ids = new Set();
  for (const item of [...existing, ...(page?.items ?? [])]) {
    if (!item?.id || ids.has(item.id)) continue;
    ids.add(item.id);
    items.push(item);
  }
  return { items, nextCursor: page?.nextCursor ?? null };
}

export function restoredFeedTarget(loadedCount, restoreCount = 9) {
  return Math.max(0, Math.max(Number(loadedCount) || 0, Number(restoreCount) || 0));
}

export function mountRecentFeed(host, {
  client,
  previewClient,
  onOpenSet,
  examples = false,
  initialPage = null,
  restoreCount = 9,
  onChange = null,
}) {
  const records = new Map();
  let items = [];
  let cursor = null;
  let disposed = false;
  let suspended = false;
  let generation = 0;
  let listController = null;
  let operation = Promise.resolve();
  let retryOperation = null;

  host.innerHTML = `<div class="feed-heading"><h1>${examples ? 'Examples' : 'Recently made'}</h1></div><div class="feed-grid"></div><p class="feed-error" role="status"></p><button class="feed-more" type="button">Show more</button>`;
  const grid = host.querySelector('.feed-grid');
  const more = host.querySelector('.feed-more');
  const error = host.querySelector('.feed-error');

  const observer = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const record = records.get(entry.target.dataset.resultId);
      if (!record) continue;
      record.visible = entry.isIntersecting;
      if (!record.visible) {
        record.controller?.abort();
        record.controller = null;
        record.stage?.dispose();
        record.stage = null;
      } else loadStage(record);
    }
  }, { rootMargin: '80px 0px' }) : null;

  function announceChange() {
    onChange?.({ count: items.length, ids: items.map(item => item.id) });
  }
  function loadStage(record) {
    if (disposed || suspended || record.stage || record.controller) return;
    const controller = new AbortController();
    const currentGeneration = generation;
    record.controller = controller;
    record.host.classList.remove('is-unavailable');
    client.getResult(record.item.id, { signal: controller.signal })
      .then(result => previewClient.prepare(result.model, { signal: controller.signal }))
      .then(model => {
        if (disposed || suspended || controller.signal.aborted || currentGeneration !== generation
          || record.visible === false || !record.host.isConnected) return;
        record.stage = mountModelStage(record.host, {
          model,
          label: `${record.item.prompt}, interactive 3D LEGO-style set`,
          onOpen: () => onOpenSet(record.item.id),
          animate: false,
        });
      })
      .catch(cause => {
        if (cause?.name !== 'AbortError' && !disposed && currentGeneration === generation) {
          record.host.classList.add('is-unavailable');
          record.host.setAttribute('aria-label', `${record.item.prompt}, preview unavailable`);
        }
      })
      .finally(() => { if (record.controller === controller) record.controller = null; });
  }
  function createCard(item) {
    const card = document.createElement('article');
    card.className = 'feed-card';
    const stageHost = document.createElement('div');
    stageHost.className = 'feed-stage';
    stageHost.dataset.resultId = item.id;
    const caption = document.createElement('button');
    caption.type = 'button';
    caption.className = 'feed-caption';
    const prompt = document.createElement('span');
    prompt.className = 'feed-prompt';
    prompt.textContent = item.prompt;
    caption.append(prompt);
    const age = examples ? '' : formatAge(item.createdAt);
    if (age) {
      const time = document.createElement('time');
      time.className = 'feed-time';
      time.dateTime = item.createdAt;
      time.textContent = age;
      caption.append(time);
    }
    card.append(stageHost, caption);
    card.addEventListener('click', event => {
      if (event.target.closest('canvas')) return;
      onOpenSet(item.id);
    });
    grid.append(card);
    const record = { item, host: stageHost, stage: null, controller: null, visible: !observer };
    records.set(item.id, record);
    if (observer) observer.observe(stageHost); else loadStage(record);
  }
  function render(nextItems, nextCursor, { reset = false } = {}) {
    if (reset) {
      for (const record of records.values()) {
        observer?.unobserve(record.host);
        record.controller?.abort();
        record.stage?.dispose();
      }
      records.clear();
      grid.replaceChildren();
    }
    for (const item of nextItems) if (!records.has(item.id)) createCard(item);
    items = nextItems;
    cursor = nextCursor;
    more.hidden = !cursor;
    more.textContent = 'Show more';
    retryOperation = null;
    error.textContent = '';
    announceChange();
  }
  async function fetchPage(nextCursor, token) {
    listController?.abort();
    const controller = new AbortController();
    listController = controller;
    try {
      const page = await client.list({ cursor: nextCursor, signal: controller.signal });
      if (disposed || token !== generation) return null;
      return page;
    } finally {
      if (listController === controller) listController = null;
    }
  }
  function serialize(task) {
    operation = operation.catch(() => {}).then(task);
    return operation;
  }
  async function loadTo(target, { reset = false, firstPage = null } = {}) {
    const token = reset ? ++generation : generation;
    more.disabled = true;
    try {
      let merged = reset ? { items: [], nextCursor: null } : { items, nextCursor: cursor };
      let page = firstPage;
      let nextCursor = reset ? null : cursor;
      do {
        page ??= await fetchPage(nextCursor, token);
        if (!page) return;
        merged = mergeFeedPage(merged.items, page);
        render(merged.items, merged.nextCursor, { reset: reset && nextCursor === null });
        nextCursor = merged.nextCursor;
        page = null;
      } while (merged.items.length < target && nextCursor);
    } catch (cause) {
      if (cause?.name !== 'AbortError' && !disposed && token === generation) {
        error.textContent = examples ? 'Examples couldn’t load.' : 'Recent sets couldn’t load';
        more.textContent = 'Retry';
        more.hidden = false;
        retryOperation = () => loadTo(target, { reset });
      }
    } finally {
      if (!disposed && token === generation) more.disabled = false;
    }
  }

  more.onclick = () => serialize(retryOperation ?? (() => loadTo(items.length + 1)));
  const ready = serialize(() => loadTo(restoredFeedTarget(0, restoreCount), { reset: true, firstPage: initialPage }));
  return {
    ready,
    get count() { return items.length; },
    refresh: () => serialize(() => loadTo(restoredFeedTarget(items.length, restoreCount), { reset: true })),
    suspend() {
      suspended = true;
      for (const record of records.values()) {
        record.controller?.abort();
        record.controller = null;
        record.stage?.dispose();
        record.stage = null;
      }
    },
    resume() {
      suspended = false;
      for (const record of records.values()) if (record.visible) loadStage(record);
    },
    dispose() {
      disposed = true;
      generation += 1;
      listController?.abort();
      observer?.disconnect();
      for (const record of records.values()) { record.controller?.abort(); record.stage?.dispose(); }
      host.replaceChildren();
    },
  };
}
