// A disposable worker keeps local packing off the UI thread. Cancellation also
// stops computation, rather than only ignoring an eventual result.
export function createConstructionClient(makeWorker = () => new Worker(new URL('./construction-worker.js', import.meta.url), { type: 'module' }), timeoutMs = 60_000) {
  return {
    convert(input, { signal } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Conversion cancelled.', 'AbortError'));
        const worker = makeWorker();
        let timer;
        const finish = (error, result) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          worker.terminate();
          if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(new DOMException('Conversion cancelled.', 'AbortError'));
        signal?.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }) => finish(data.error ? new Error(data.error) : null, data.result);
        worker.onerror = () => finish(new Error('The local construction worker stopped. Raw geometry is still available.'));
        timer = setTimeout(() => finish(new Error('Conversion exceeded its 60-second local limit. Raw geometry is still available.')), timeoutMs);
        try { worker.postMessage(input); } catch (error) { finish(error); }
      });
    },
  };
}
