const SLUG_RE = /^[a-z0-9](?:[a-z0-9 -]{0,38}[a-z0-9])?$/;

export function slug(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

export function validateTerm(raw: string): string | null {
  const s = slug(raw);
  if (!s) return 'enter a word or two.';
  if (s.length > 40) return 'keep it under 40 characters.';
  if (!SLUG_RE.test(s)) return 'use letters, numbers, spaces, or hyphens.';
  return null;
}

// Stable 4-digit set number from a term — lets every search render a
// matching "set #" in the booklet header without persisting anything.
export function setNumberFor(term: string): string {
  let h = 0;
  for (let i = 0; i < term.length; i++) {
    h = (h * 31 + term.charCodeAt(i)) >>> 0;
  }
  return String(1000 + (h % 9000));
}
