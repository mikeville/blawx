const FINISHING_LABEL = 'finishing touches';
const FINISHING_OOPS = 'Oops. More finishing touches.';
const FINISHING_BEATS = Object.freeze([
  'Finishing touches, apparently',
  'Still finishing touches',
  'Okay, now finishing touches',
  'Finishing touches continue',
  'And yet, finishing touches',
  'Finishing touches, ongoing',
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
    case 'onward': return `Onward: ${lowerInitialTitlecase(label)}`;
    case 'still': return `Still: ${lowerInitialTitlecase(label)}`;
    case 'revisited': return `${label}, revisited`;
    case 'resumes': return `${label} resumes`;
    case 'returns': return `${label} returns`;
    case 'continues': return `${label} continues`;
    case 'onwardSuffix': return `${label}, onward`;
    case 'encore': return `${label}, encore`;
    case 'hello': return `Hello, ${lowerInitialTitlecase(label)}`;
    case 'ah': return `Ah, ${lowerInitialTitlecase(label)}`;
    default: return `${label}, again`;
  }
}

function chooseTemplate(candidates, state, seed, identity, sectionIndex, render = (value) => value) {
  const unusedLabels = candidates.filter((template) => !state.usedLabels.has(normalize(render(template))));
  if (!unusedLabels.length) return null;
  const withoutImmediateRepeat = unusedLabels.length > 1
    ? unusedLabels.filter((template) => template !== state.lastTemplate)
    : unusedLabels;
  const pool = withoutImmediateRepeat.length ? withoutImmediateRepeat : unusedLabels;
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
  state.usedLabels.add(normalize(render(selected)));
  return selected;
}

function finishingBeat(seed, occurrence, total, state, sectionIndex) {
  if (occurrence === 2) {
    state.usedLabels.add(normalize(FINISHING_OOPS));
    return FINISHING_OOPS;
  }
  const nearEnd = occurrence >= 3 && occurrence >= total - 1;
  const eligible = FINISHING_BEATS.filter((beat) => nearEnd || !beat.startsWith('Okay,'));
  return chooseTemplate(eligible, state, seed, `finishing:${occurrence}`, sectionIndex)
    ?? `Finishing touches · ${occurrence}`;
}

export function varyGuideSectionLabels(sections) {
  const seed = guideSeed(sections);
  const sourceLabels = new Set(sections.flatMap((section) => {
    const label = baseLabelFor(section);
    return typeof label === 'string' && label.trim() ? [normalize(label)] : [];
  }));
  const eligibleFinishingIndexes = sections.flatMap((section, index) => (
    section.repeatCount > 1 || normalize(String(baseLabelFor(section) ?? '')) !== FINISHING_LABEL ? [] : [index]
  ));
  const finishingRepeats = eligibleFinishingIndexes.length > 1;
  const jokeLimit = finishingRepeats ? 1 : 2;
  const jokeState = { count: 0, lastIndex: -Infinity };
  const templateState = { usage: new Map(), usedLabels: new Set(sourceLabels), lastTemplate: null };
  const finishingState = { usage: new Map(), usedLabels: new Set(sourceLabels), lastTemplate: null };
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
    const ordinaryCandidates = [
      ...(allowsMore(baseLabel) ? ['more'] : []),
      ...(adjacent ? ['continued', 'next'] : ['again', 'next']),
      'onward',
      'still',
      'revisited',
      'resumes',
      'returns',
      'continues',
      'onwardSuffix',
      'encore',
      ...(adjacent ? ['again'] : ['continued']),
    ];
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
      (candidate) => renderOrdinary(candidate, baseLabel),
    );
    const variedLabel = template === null ? `${baseLabel} · ${occurrence}` : renderOrdinary(template, baseLabel);
    if (template === 'hello' || template === 'ah') {
      jokeState.count += 1;
      jokeState.lastIndex = sectionIndex;
    }
    previousCountedKey = key;
    return { ...section, baseLabel, label: variedLabel };
  });
}
