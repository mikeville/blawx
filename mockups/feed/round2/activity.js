// Fictional creation dates for a deterministic layout study. These are not the
// saved Shapes' research timestamps, cache-access times, or live visitor events.
// Integration: replace with API item.createdAt and use Date.now() as the clock.
export const PREVIEW_NOW = Date.parse('2026-09-07T16:00:00Z');
export const PREVIEW_CREATED_AT = Object.freeze({
  tv: '2026-09-07T15:55:00Z',
  spaghetti: '2026-09-07T15:42:00Z',
  dragon: '2026-09-07T15:18:00Z',
  pickup: '2026-09-07T14:30:00Z',
  cat: '2026-09-07T12:40:00Z',
  reef: '2026-09-06T19:10:00Z',
});

export function formatCreationAge(createdAt, now = Date.now()) {
  const created = typeof createdAt === 'string' ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(created) || !Number.isFinite(now)) return '';
  const minutes = Math.floor(Math.max(0, now - created) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 365 ? `${days}d ago` : `${Math.floor(days / 365)}y ago`;
}
