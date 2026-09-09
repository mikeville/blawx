function createWorkerConverter(makeWorker = () => new Worker(new URL('./preview-worker.js', import.meta.url), { type: 'module' }), timeoutMs = 30_000) {
  return { convert(model, { signal } = {}) { return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Preview cancelled.', 'AbortError'));
    const worker = makeWorker();
    let settled = false;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(value);
    };
    const abort = () => finish(new DOMException('Preview cancelled.', 'AbortError'));
    signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.model);
    worker.onerror = () => finish(new Error('Preview conversion stopped.'));
    timer = setTimeout(() => finish(new Error('Preview conversion timed out.')), timeoutMs);
    try { worker.postMessage(model); } catch (error) { finish(error); }
  }); } };
}
export function createPreviewClient(converter = createWorkerConverter(), { maxPending = 12 } = {}) {
  const tasks = new WeakMap();
  const queue = [];
  let active = null;
  let disposed = false;

  function settleWaiter(waiter, value, error = null) {
    waiter.signal?.removeEventListener('abort', waiter.abort);
    if (error) waiter.reject(error); else waiter.resolve(value);
  }

  function complete(task, value) {
    task.state = 'done';
    task.value = value;
    for (const waiter of task.waiters) settleWaiter(waiter, value);
    task.waiters.clear();
  }

  function cancelTask(task) {
    tasks.delete(task.model);
    if (task.state === 'queued') {
      const index = queue.indexOf(task);
      if (index >= 0) queue.splice(index, 1);
      task.state = 'cancelled';
    } else if (task.state === 'active') {
      task.state = 'cancelled';
      task.controller.abort();
    }
  }

  function runNext() {
    if (disposed || active || !queue.length) return;
    active = queue.shift();
    active.state = 'active';
    converter.convert(active.model, { signal: active.controller.signal })
      .then(
        model => { if (active.state !== 'cancelled') complete(active, model); },
        () => { if (active.state !== 'cancelled') complete(active, active.model); },
      )
      .finally(() => { active = null; runNext(); });
  }

  function attach(task, signal) {
    if (signal?.aborted) return Promise.reject(new DOMException('Preview cancelled.', 'AbortError'));
    if (task.state === 'done') return Promise.resolve(task.value);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject, signal, abort: null };
      waiter.abort = () => {
        if (!task.waiters.delete(waiter)) return;
        settleWaiter(waiter, null, new DOMException('Preview cancelled.', 'AbortError'));
        if (!task.waiters.size) cancelTask(task);
      };
      signal?.addEventListener('abort', waiter.abort, { once: true });
      task.waiters.add(waiter);
    });
  }

  function prepare(model, { signal } = {}) {
    if (!model || model.kind === 'bricks') return Promise.resolve(model);
    if (disposed) return Promise.resolve(model);
    if (signal?.aborted) return Promise.reject(new DOMException('Preview cancelled.', 'AbortError'));
    let task = tasks.get(model);
    if (!task) {
      if (queue.length + (active ? 1 : 0) >= maxPending) return Promise.resolve(model);
      task = { model, state: 'queued', value: null, waiters: new Set(), controller: new AbortController() };
      tasks.set(model, task);
      queue.push(task);
    }
    const promise = attach(task, signal);
    runNext();
    return promise;
  }
  return {
    prepare,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active) {
        complete(active, active.model);
        active.controller.abort();
      }
      for (const task of queue.splice(0)) complete(task, task.model);
    },
  };
}
