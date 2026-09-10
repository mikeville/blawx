const FINISHING_LABEL = 'finishing touches';
const FINISHING_BEATS = Object.freeze([
  'Oops. More finishing touches.',
  'Finishing touches, apparently',
  'Still finishing touches',
  'Okay, now finishing touches',
]);
const MORE_NOUNS = new Set(['body', 'shape', 'details', 'material']);

function normalize(label) {
  return label.trim().replace(/\s+/gu, ' ').toLowerCase();
}

function baseLabelFor(section) {
  return typeof section.baseLabel === 'string' ? section.baseLabel : section.label;
}

function stableHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mixedHash(value) {
  let hash = stableHash(value);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function guideSeed(sections) {
  return stableHash(sections.map((section, index) => [
    section.id ?? index,
    baseLabelFor(section),
    section.repeatCount ?? 1,
  ].join('\0')).join('\u0001'));
}

function lowerInitialTitlecase(label) {
  return /^\p{Lu}\p{Ll}/u.test(label) ? `${label[0].toLowerCase()}${label.slice(1)}` : label;
}

function allowsMore(label) {
  const lastWord = normalize(label).split(' ').at(-1);
  if (MORE_NOUNS.has(lastWord)) return true;
  return /[a-z]{3,}s$/u.test(lastWord) && !/(?:ss|us|is)$/u.test(lastWord);
}

function renderOrdinary(template, label) {
  switch (template) {
    case 'more': return `More ${lowerInitialTitlecase(label)}`;
    case 'continued': return `${label}, continued`;
    case 'next': return `Next: ${lowerInitialTitlecase(label)}`;
    case 'hello': return `Hello, ${lowerInitialTitlecase(label)}`;
    case 'ah': return `Ah, ${lowerInitialTitlecase(label)}`;
    default: return `${label}, again`;
  }
}

function chooseTemplate(candidates, state, seed, identity, sectionIndex) {
  const withoutImmediateRepeat = candidates.length > 1
    ? candidates.filter((template) => template !== state.lastTemplate)
    : candidates;
  const pool = withoutImmediateRepeat.length ? withoutImmediateRepeat : candidates;
  const selected = [...pool].sort((left, right) => {
    const leftUsage = state.usage.get(left) ?? { count: 0, lastIndex: -Infinity };
    const rightUsage = state.usage.get(right) ?? { count: 0, lastIndex: -Infinity };
    return leftUsage.count - rightUsage.count
      || mixedHash(`${seed}:${identity}:${left}`) - mixedHash(`${seed}:${identity}:${right}`)
      || leftUsage.lastIndex - rightUsage.lastIndex;
  })[0];
  const usage = state.usage.get(selected) ?? { count: 0, lastIndex: -Infinity };
  state.usage.set(selected, { count: usage.count + 1, lastIndex: sectionIndex });
  state.lastTemplate = selected;
  return selected;
}

function finishingBeat(seed, occurrence, total, state, sectionIndex) {
  const nearEnd = occurrence >= 3 && occurrence >= total - 1;
  const eligible = FINISHING_BEATS.filter((beat) => nearEnd || !beat.startsWith('Okay,'));
  return chooseTemplate(eligible, state, seed, `finishing:${occurrence}`, sectionIndex);
}

export function varyGuideSectionLabels(sections) {
  const seed = guideSeed(sections);
  const eligibleFinishingIndexes = sections.flatMap((section, index) => (
    section.repeatCount > 1 || normalize(String(baseLabelFor(section) ?? '')) !== FINISHING_LABEL ? [] : [index]
  ));
  const finishingRepeats = eligibleFinishingIndexes.length > 1;
  const jokeLimit = finishingRepeats ? 1 : 2;
  const jokeState = { count: 0, lastIndex: -Infinity };
  const templateState = { usage: new Map(), lastTemplate: null };
  const finishingState = { usage: new Map(), lastTemplate: null };
  const occurrences = new Map();
  let previousCountedKey = null;

  return sections.map((section, sectionIndex) => {
    const baseLabel = baseLabelFor(section);
    if (section.repeatCount > 1 || typeof baseLabel !== 'string' || !baseLabel.trim()) {
      previousCountedKey = null;
      return { ...section, baseLabel, label: baseLabel };
    }

    const key = normalize(baseLabel);
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    if (key === FINISHING_LABEL) {
      previousCountedKey = key;
      if (occurrence === 1) return { ...section, baseLabel, label: baseLabel };
      const actualLastEntry = sectionIndex === sections.length - 1;
      return {
        ...section,
        baseLabel,
        label: actualLastEntry ? 'Finishing touches. For real.'
          : finishingBeat(seed, occurrence, eligibleFinishingIndexes.length, finishingState, sectionIndex),
      };
    }
    if (occurrence === 1) {
      previousCountedKey = key;
      return { ...section, baseLabel, label: baseLabel };
    }

    const adjacent = previousCountedKey === key;
    const ordinaryCandidates = adjacent
      ? [...(allowsMore(baseLabel) ? ['more'] : []), 'continued', 'next']
      : ['again', 'next'];
    const jokeAvailable = !adjacent && occurrence >= 3 && jokeState.count < jokeLimit
      && sectionIndex - jokeState.lastIndex >= 2
      && stableHash(`${seed}:${key}:${sectionIndex}:joke`) % 3 === 0;
    if (jokeAvailable) ordinaryCandidates.push('hello', 'ah');
    const template = chooseTemplate(
      ordinaryCandidates,
      templateState,
      seed,
      `${key}:${occurrence}:${sectionIndex}`,
      sectionIndex,
    );
    if (template === 'hello' || template === 'ah') {
      jokeState.count += 1;
      jokeState.lastIndex = sectionIndex;
    }
    previousCountedKey = key;
    return { ...section, baseLabel, label: renderOrdinary(template, baseLabel) };
  });
}
