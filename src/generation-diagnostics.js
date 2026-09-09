function formatSeconds(milliseconds) {
  return Number.isFinite(milliseconds) ? `${(milliseconds / 1000).toFixed(1)} seconds` : null;
}

export function generationDiagnosticRows(result, browserWaitMs) {
  if (result?.cacheHit) {
    return [{ label: 'Generation', value: 'Exact-prompt cache hit · no new generation usage' }];
  }
  if (!Number.isFinite(browserWaitMs) || !result?.metadata) return [];

  const metadata = result.metadata;
  return [
    { label: 'Generation', value: formatSeconds(metadata.generationMs) ?? 'Not reported' },
    { label: 'Browser wait', value: formatSeconds(browserWaitMs) },
    { label: 'Model', value: metadata.actualModel || metadata.requestedModel || 'Not reported' },
    { label: 'Timing scope', value: metadata.timingScope || 'Generation only' },
  ];
}
