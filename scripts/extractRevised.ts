/**
 * Extracts the "critique:" and "revised:" sections from a sketch-and-revise
 * pass-2 response. Defensive: if either marker is missing, returns the full
 * text in both fields so downstream parseAsciiLayers can still try its luck.
 */
export function extractRevised(text: string): { critique: string; revised: string } {
  const lower = text.toLowerCase();
  const revisedIdx = lower.indexOf('revised:');
  if (revisedIdx === -1) {
    return { critique: '', revised: text };
  }
  const critiqueIdx = lower.indexOf('critique:');
  const critique =
    critiqueIdx !== -1
      ? text.slice(critiqueIdx + 'critique:'.length, revisedIdx).trim()
      : '';
  const revised = text.slice(revisedIdx + 'revised:'.length).trim();
  return { critique, revised };
}
