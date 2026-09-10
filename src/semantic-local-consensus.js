import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from './semantic-guide.js';

// This vocabulary is intentionally about ordinary visible parts. It contains no
// subjects, saved labels, coordinates, or fixture-specific corrections.
const TAXONOMY = Object.freeze([
  ['Head details', ['facial details', 'face details', 'head details', 'eye', 'eyes', 'ear', 'ears', 'nose', 'mouth', 'whisker', 'whiskers', 'hair']],
  ['Finishing details', ['finishing detail', 'finishing details', 'trim', 'trims', 'accent', 'accents', 'decoration', 'decorations']],
  ['Appendage', ['appendage', 'appendages', 'limb', 'limbs', 'leg', 'legs', 'arm', 'arms', 'tail', 'tails', 'wing', 'wings', 'fin', 'fins', 'paw', 'paws', 'foot', 'feet', 'hand', 'hands', 'tentacle', 'tentacles']],
  ['Body', ['body', 'bodies', 'torso', 'torsos', 'chassis', 'hull', 'hulls', 'fuselage', 'fuselages', 'shell', 'shells', 'bodywork', 'cab', 'cabs', 'cabin', 'cabins', 'cockpit', 'cockpits']],
  ['Head', ['head', 'heads', 'face', 'faces', 'snout', 'snouts', 'muzzle', 'muzzles']],
  ['Wheel', ['wheel', 'wheels', 'tire', 'tires', 'tyre', 'tyres']],
  ['Panels', ['panel', 'panels', 'wall', 'walls', 'siding']],
  ['Base', ['base', 'bases', 'foundation', 'foundations', 'platform', 'platforms', 'floor', 'floors', 'groundwork']],
  ['Roof', ['roof', 'roofs', 'canopy', 'canopies', 'cover', 'covers', 'covering', 'coverings', 'cap', 'caps']],
  ['Openings', ['opening', 'openings', 'window', 'windows', 'door', 'doors', 'doorway', 'doorways']],
  ['Lights', ['light', 'lights', 'lamp', 'lamps', 'beacon', 'beacons', 'headlight', 'headlights', 'lantern', 'lanterns']],
  ['Bumpers', ['bumper', 'bumpers']],
  ['Screens', ['screen', 'screens']],
  ['Antennas', ['antenna', 'antennas']],
  ['Supports', ['support', 'supports', 'brace', 'braces', 'pillar', 'pillars', 'column', 'columns', 'stand', 'stands']],
  ['Natural details', ['foliage', 'tree', 'trees', 'plant', 'plants', 'coral', 'vegetation']],
  ['Structure', ['structure', 'structures', 'framework', 'frame', 'frames']],
  ['Details', ['detail', 'details', 'feature', 'features']],
]);

const PARENT = new Map([
  ['Head details', 'Head'],
  ['Head', 'Body'],
  ['Body', 'Structure'],
  ['Appendage', 'Structure'],
  ['Panels', 'Structure'],
  ['Base', 'Structure'],
  ['Roof', 'Structure'],
  ['Supports', 'Structure'],
  ['Finishing details', 'Details'],
  ['Openings', 'Details'],
  ['Lights', 'Details'],
  ['Bumpers', 'Details'],
  ['Screens', 'Details'],
  ['Antennas', 'Details'],
  ['Wheel', 'Details'],
  ['Natural details', 'Details'],
]);

const ALIASES = TAXONOMY.flatMap(([category, aliases]) => aliases.map((alias) => ({
  alias,
  category,
  words: alias.split(' ').length,
}))).sort((a, b) => b.words - a.words || b.alias.length - a.alias.length);

function plainLabel(value, name) {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${name} must be text or null.`);
  const result = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!result || [...result].length > 64 || /[\u0000-\u001f\u007f]/u.test(result)) {
    throw new RangeError(`${name} must be 1-64 plain-text characters.`);
  }
  return result;
}

function words(value) {
  return value.toLocaleLowerCase('en-US')
    .replace(/[’']/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
}

function parts(value) {
  return value.split(/\s*(?:,|&|\+|\/|\band\b)\s*/iu).filter(Boolean);
}

function titleLabel(value) {
  if (value === value.toLocaleUpperCase('en-US') || value === value.toLocaleLowerCase('en-US')) {
    const lower = value.toLocaleLowerCase('en-US');
    return lower.charAt(0).toLocaleUpperCase('en-US') + lower.slice(1);
  }
  return value.charAt(0).toLocaleUpperCase('en-US') + value.slice(1);
}

function classify(part) {
  let normalized = words(part);
  for (const wrapper of [' section', ' sections', ' part', ' parts']) {
    if (!normalized.endsWith(wrapper)) continue;
    const candidate = normalized.slice(0, -wrapper.length);
    if (ALIASES.some((entry) => entry.alias === candidate)) normalized = candidate;
    break;
  }
  for (const entry of ALIASES) {
    if (normalized === entry.alias || normalized.endsWith(` ${entry.alias}`)) {
      return { category: entry.category, normalized };
    }
  }
  return { category: null, normalized };
}

function semanticPartKey(part) {
  const result = classify(part);
  return result.category ? `category:${result.category}` : `unknown:${result.normalized}`;
}

function normalizedLabel(value) {
  return parts(value).map(semanticPartKey).sort().join('|');
}

function ancestors(category) {
  const result = [category];
  while (PARENT.has(result.at(-1))) result.push(PARENT.get(result.at(-1)));
  return result;
}

function categoryConsensus(first, second) {
  if (first === second) return first;
  const firstAncestors = ancestors(first);
  const secondAncestors = ancestors(second);
  if (firstAncestors.includes(second)) return second;
  if (secondAncestors.includes(first)) return first;
  return null;
}

function commonAncestor(categories) {
  if (!categories.length) return null;
  return ancestors(categories[0]).find((candidate) => (
    categories.slice(1).every((category) => ancestors(category).includes(candidate))
  )) ?? null;
}

function uniqueClassifications(label) {
  const result = [];
  for (const part of parts(label).map((entry) => ({ raw: entry, ...classify(entry) }))) {
    const key = part.category ? `category:${part.category}` : `unknown:${part.normalized}`;
    if (!result.some((entry) => entry.key === key)) result.push({ ...part, key });
  }
  return result;
}

function subsetLabel(first, second) {
  const shorterParts = parts(first);
  const longerParts = parts(second);
  if (shorterParts.length >= longerParts.length) return null;
  const shorterKeys = new Set(shorterParts.map(semanticPartKey));
  if (![...shorterKeys].every((key) => longerParts.some((part) => semanticPartKey(part) === key))) return null;
  const classifications = [...shorterParts, ...longerParts].map(classify);
  if (classifications.some(({ category }) => category === null)) return null;
  const category = classifications[0].category;
  if (!classifications.every((entry) => entry.category === category)) return null;
  return titleLabel(first);
}

function matchCategories(first, second) {
  if (first.some(({ category }) => category === null) || second.some(({ category }) => category === null)
    || first.length !== second.length) return null;
  const remaining = [...second];
  const labels = [];
  for (const entry of first) {
    let best = remaining.findIndex((candidate) => candidate.category === entry.category);
    if (best < 0) best = remaining.findIndex((candidate) => categoryConsensus(entry.category, candidate.category));
    if (best < 0) return null;
    labels.push(categoryConsensus(entry.category, remaining[best].category));
    remaining.splice(best, 1);
  }
  return [...new Set(labels)];
}

function describeDecision(firstValue, secondValue) {
  const first = plainLabel(firstValue, 'First semantic label');
  const second = plainLabel(secondValue, 'Second semantic label');
  if (first === null || second === null) {
    return { label: null, rule: 'uncertain-choice', normalizedFirst: first, normalizedSecond: second, firstCategories: [], secondCategories: [] };
  }

  const firstNormalized = normalizedLabel(first);
  const secondNormalized = normalizedLabel(second);
  const firstClassifications = uniqueClassifications(first);
  const secondClassifications = uniqueClassifications(second);
  const evidence = {
    normalizedFirst: firstNormalized,
    normalizedSecond: secondNormalized,
    firstCategories: firstClassifications.map(({ category }) => category),
    secondCategories: secondClassifications.map(({ category }) => category),
  };

  if (words(first) === words(second)) {
    return { label: titleLabel(first), rule: 'normalized-exact', ...evidence };
  }
  if (firstNormalized === secondNormalized && !firstNormalized.includes('|')) {
    const firstCategory = firstClassifications[0]?.category;
    const secondCategory = secondClassifications[0]?.category;
    return {
      label: categoryConsensus(firstCategory, secondCategory) ?? titleLabel(first),
      rule: 'shared-category',
      ...evidence,
    };
  }

  const contained = subsetLabel(first, second) ?? subsetLabel(second, first);
  if (contained) return { label: contained, rule: 'broader-contained-label', ...evidence };

  const matched = matchCategories(firstClassifications, secondClassifications);
  if (matched?.length) {
    const label = matched.join(' and ');
    if (label.split(/\s+/u).length <= 5 && [...label].length <= 64) {
      return { label, rule: matched.length === 1 ? 'shared-category' : 'shared-mixed-categories', ...evidence };
    }
  }

  const hasKnownCategory = [...firstClassifications, ...secondClassifications]
    .every(({ category }) => category !== null);
  const parent = hasKnownCategory ? commonAncestor([
    ...firstClassifications.map(({ category }) => category),
    ...secondClassifications.map(({ category }) => category),
  ]) : null;
  if (parent) return { label: parent, rule: 'shared-parent-category', ...evidence };
  return { label: hasKnownCategory ? 'Details' : null, rule: hasKnownCategory ? 'details-fallback' : 'no-safe-category', ...evidence };
}

export function generalizeSemanticLabels(first, second) {
  return describeDecision(first, second).label;
}

function rangeKey({ startStepId, endStepId }) {
  return `${startStepId}\0${endStepId}`;
}

function assertSameRanges(proposal, caption) {
  if (proposal.sections.length !== caption.sections.length
    || proposal.sections.some((section, index) => rangeKey(section) !== rangeKey(caption.sections[index]))) {
    throw new RangeError('Semantic consensus annotations must use the same exact chapter ranges.');
  }
}

function assertRepeatNames(input, annotation, name) {
  const sectionsByRange = new Map(annotation.sections.map((section) => [rangeKey(section), section]));
  const labelsByGroup = new Map();
  for (const range of input.protectedRanges) {
    const label = sectionsByRange.get(rangeKey(range))?.label ?? null;
    const normalized = label === null ? null : words(label);
    if (labelsByGroup.has(range.repeatGroupId) && labelsByGroup.get(range.repeatGroupId) !== normalized) {
      throw new RangeError(`${name} protected repeat chapters must use the same normalized label.`);
    }
    labelsByGroup.set(range.repeatGroupId, normalized);
  }
}

export function generalizeSemanticAnnotation(rawInput, rawProposal, rawCaptionAnnotation) {
  const input = validateSemanticGuideInput(rawInput);
  const proposal = validateSemanticGuideAnnotation(input, rawProposal);
  const captionAnnotation = validateSemanticGuideAnnotation(input, rawCaptionAnnotation);
  assertSameRanges(proposal, captionAnnotation);
  assertRepeatNames(input, proposal, 'Proposal');
  assertRepeatNames(input, captionAnnotation, 'Caption');

  const repeatByRange = new Map(input.protectedRanges.map((range) => [rangeKey(range), range.repeatGroupId]));
  const decisions = proposal.sections.map((section, index) => {
    const captionSection = captionAnnotation.sections[index];
    const decision = describeDecision(section.label, captionSection.label);
    return {
      chapter: index + 1,
      startStepId: section.startStepId,
      endStepId: section.endStepId,
      repeatGroupId: repeatByRange.get(rangeKey(section)) ?? null,
      proposalLabel: section.label,
      captionLabel: captionSection.label,
      proposalEvidence: section.evidence,
      captionEvidence: captionSection.evidence,
      ...decision,
    };
  });
  const annotation = validateSemanticGuideAnnotation(input, {
    version: 1,
    fingerprint: input.fingerprint,
    sections: proposal.sections.map((section, index) => ({
      startStepId: section.startStepId,
      endStepId: section.endStepId,
      label: decisions[index].label,
      confidence: decisions[index].label === null ? 'uncertain' : 'inferred',
      evidence: section.evidence,
    })),
  });
  return { annotation, decisions };
}
