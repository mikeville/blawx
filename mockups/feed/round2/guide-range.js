import { formatGuideStepRange } from '../../../src/guide-numbering.js';
import { escapeMarkup } from '../../../src/part-illustration.js';

export function guideRangeMarkup(range) {
  const formatted = formatGuideStepRange(range);
  const separator = formatted.indexOf('–');
  if (separator < 0) return escapeMarkup(formatted);
  const start = formatted.slice(0, separator);
  const end = formatted.slice(separator + 1);
  return `${escapeMarkup(start)}<span class="r2-guide__range-dash">–</span>${escapeMarkup(end)}`;
}
