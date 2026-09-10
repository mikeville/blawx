import { MAX_PROMPT_CHARACTERS, PROMPT_TOO_LONG_MESSAGE, promptCharacterCount } from '../src/prompt-policy.js';

const SUBJECT_LINE = /^USER PROMPT:.*$/gm;

export function normalizeSubject(value) {
  if (typeof value !== 'string') throw new TypeError('Prompt must be a string.');
  const subject = value.trim().replace(/\s+/g, ' ');
  if (!subject) throw new TypeError('Prompt must not be empty.');
  if (promptCharacterCount(subject) > MAX_PROMPT_CHARACTERS) throw new RangeError(PROMPT_TOO_LONG_MESSAGE);
  return subject;
}

export function substituteSubject(template, subject) {
  const normalized = normalizeSubject(subject);
  const matches = [...template.matchAll(SUBJECT_LINE)];
  if (matches.length !== 1) throw new Error('Generation template must contain exactly one USER PROMPT line.');
  return template.replace(SUBJECT_LINE, () => `USER PROMPT: ${normalized}`);
}
