export const MAX_PROMPT_CHARACTERS = 280;

export const PROMPT_TOO_LONG_MESSAGE = `Keep the set description to ${MAX_PROMPT_CHARACTERS} characters or fewer.`;

export function promptCharacterCount(value) {
  return Array.from(typeof value === 'string' ? value : '').length;
}

export function truncatePrompt(value, maximum = MAX_PROMPT_CHARACTERS) {
  return Array.from(typeof value === 'string' ? value : '').slice(0, maximum).join('');
}

export function promptSizeTier(value) {
  const length = promptCharacterCount(typeof value === 'string' ? value.trim() : '');
  if (length <= 56) return 'short';
  if (length <= 112) return 'medium';
  if (length <= 196) return 'long';
  return 'extended';
}
