const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function streamError(message, state) {
  const error = new Error(message);
  error.partialResponse = state.raw;
  error.eventLedger = state.ledger;
  error.streamTimings = state.timings;
  error.terminalResponse = state.terminalResponse;
  error.outputText = state.outputText;
  return error;
}

function terminalText(response) {
  const texts = [];
  for (const item of response?.output ?? []) {
    if (item?.type !== 'message' || item.role !== 'assistant') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') texts.push(content.text);
    }
  }
  return texts.join('');
}

export async function readResponseSse(response, {
  maxBytes = DEFAULT_MAX_BYTES,
  elapsedMs = () => 0,
  signal,
} = {}) {
  if (!response.body?.getReader) throw new Error('Streaming response body must expose getReader().');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = {
    raw: '', ledger: [], outputText: '', terminalResponse: null,
    timings: { firstEventMs: null, firstTextMs: null, lastTextMs: null, terminalMs: null, eofMs: null },
  };
  let bytes = 0;
  let buffer = '';
  let sequence = 0;
  let terminalSeen = false;

  const cancelReader = () => {
    try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {}
  };

  const read = async () => {
    if (!signal) return reader.read();
    if (signal.aborted) throw signal.reason ?? new Error('Streaming response aborted.');
    let onAbort;
    const aborted = new Promise((_resolve, reject) => {
      onAbort = () => reject(signal.reason ?? new Error('Streaming response aborted.'));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try { return await Promise.race([reader.read(), aborted]); }
    finally { signal.removeEventListener('abort', onAbort); }
  };

  const dispatch = (block) => {
    if (!block || block.split('\n').every((line) => line === '' || line.startsWith(':'))) return;
    let eventName = null;
    const data = [];
    for (const line of block.split('\n')) {
      if (line.startsWith(':')) continue;
      const colon = line.indexOf(':');
      const field = colon === -1 ? line : line.slice(0, colon);
      let value = colon === -1 ? '' : line.slice(colon + 1);
      if (value.startsWith(' ')) value = value.slice(1);
      if (field === 'event') eventName = value;
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) throw streamError('SSE event has no data field.', state);
    const joined = data.join('\n');
    if (joined === '[DONE]') throw streamError('Unexpected [DONE] sentinel; a response.completed event is required.', state);
    let payload;
    try { payload = JSON.parse(joined); } catch { throw streamError('Malformed JSON in SSE event.', state); }
    const type = payload?.type;
    if (typeof type !== 'string') throw streamError('SSE event payload has no type.', state);
    if (eventName && eventName !== type) throw streamError(`Contradictory SSE event types: ${eventName} and ${type}.`, state);
    if (terminalSeen) throw streamError('Received an event after the terminal event.', state);
    const atMs = elapsedMs();
    state.timings.firstEventMs ??= atMs;
    state.ledger.push({ sequence: sequence++, providerSequence: payload.sequence_number ?? null, type, receivedMs: atMs });
    if (type === 'response.output_text.delta') {
      if (typeof payload.delta !== 'string') throw streamError('output_text delta must be a string.', state);
      state.outputText += payload.delta;
      if (payload.delta.length > 0) {
        state.timings.firstTextMs ??= atMs;
        state.timings.lastTextMs = atMs;
      }
    } else if (type === 'response.completed') {
      state.terminalResponse = payload.response ?? null;
      if (payload.response?.status !== 'completed') throw streamError('Completed event must contain a completed response.', state);
      state.timings.terminalMs = atMs;
      terminalSeen = true;
    } else if (type === 'response.failed' || type === 'response.incomplete' || type === 'error') {
      state.terminalResponse = payload.response ?? null;
      state.timings.terminalMs = atMs;
      throw streamError(`Streaming response ended with ${type}.`, state);
    }
  };

  try {
    while (true) {
      const { done, value } = await read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw streamError(`Response body exceeds ${maxBytes} bytes.`, state);
      const decoded = decoder.decode(value, { stream: true });
      state.raw += decoded;
      buffer += decoded;
      let match;
      while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buffer))) {
        const block = buffer.slice(0, match.index).replace(/\r\n|\r/g, '\n');
        buffer = buffer.slice(match.index + match[0].length);
        dispatch(block);
      }
    }
    const tail = decoder.decode();
    state.raw += tail;
    buffer += tail;
    if (buffer.trim()) dispatch(buffer.replace(/\r\n|\r/g, '\n'));
    state.timings.eofMs = elapsedMs();
    if (!state.terminalResponse) throw streamError('Stream ended without a response.completed event.', state);
    const completedText = terminalText(state.terminalResponse);
    if (completedText !== state.outputText) throw streamError('Streamed output text does not match terminal response output.', state);
    return { ...state };
  } catch (error) {
    cancelReader();
    if (error.partialResponse === undefined) {
      error.partialResponse = state.raw;
      error.eventLedger = state.ledger;
      error.streamTimings = state.timings;
      error.terminalResponse = state.terminalResponse;
      error.outputText = state.outputText;
    }
    throw error;
  }
}
