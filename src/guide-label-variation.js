const FOLLOW_UPS = Object.freeze([
  { prefix: 'More', exclamation: false },
  { prefix: 'Extra', exclamation: false },
  { prefix: 'Yes,', exclamation: true },
  { prefix: 'Encore,', exclamation: true },
]);

function normalizedLabel(label) {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function lowerInitialTitlecase(label) {
  return /^\p{Lu}\p{Ll}/u.test(label) ? `${label[0].toLowerCase()}${label.slice(1)}` : label;
}

function followUpLabel(baseLabel, occurrence) {
  const { prefix, exclamation } = FOLLOW_UPS[(occurrence - 2) % FOLLOW_UPS.length];
  const label = `${prefix} ${lowerInitialTitlecase(baseLabel)}`;
  return exclamation ? `${label}!` : label;
}

export function varyGuideSectionLabels(sections) {
  const occurrences = new Map();
  return sections.map((section) => {
    const baseLabel = typeof section.baseLabel === 'string' ? section.baseLabel : section.label;
    if (section.repeatCount > 1 || typeof baseLabel !== 'string' || !baseLabel.trim()) {
      return { ...section, baseLabel, label: baseLabel };
    }
    const key = normalizedLabel(baseLabel);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    return {
      ...section,
      baseLabel,
      label: occurrence === 1 ? baseLabel : followUpLabel(baseLabel, occurrence),
    };
  });
}
