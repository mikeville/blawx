import { PALETTE } from './geometry.js';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from './semantic-guide.js';

const GENERIC_LABELS = new Set(['body', 'details', 'structure']);
const BRICK_HEIGHT = 1.2;
const COLOR_LABELS = Object.freeze(Object.fromEntries(Object.keys(PALETTE).map((color) => [
  color,
  color.replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase().replace(/^./u, (character) => character.toUpperCase()),
])));

function boundsFor(bricks) {
  if (bricks.length === 0) return null;
  const bounds = {
    x: { min: Infinity, maxExclusive: -Infinity },
    y: { min: Infinity, maxExclusive: -Infinity },
    z: { min: Infinity, maxExclusive: -Infinity },
  };
  for (const [, x, y, z, width, depth] of bricks) {
    bounds.x.min = Math.min(bounds.x.min, x);
    bounds.x.maxExclusive = Math.max(bounds.x.maxExclusive, x + width);
    bounds.y.min = Math.min(bounds.y.min, y * BRICK_HEIGHT);
    bounds.y.maxExclusive = Math.max(bounds.y.maxExclusive, (y + 1) * BRICK_HEIGHT);
    bounds.z.min = Math.min(bounds.z.min, z);
    bounds.z.maxExclusive = Math.max(bounds.z.maxExclusive, z + depth);
  }
  return bounds;
}

function chapterBrickIds(input, section, stepIndexById) {
  const start = stepIndexById.get(section.startStepId);
  const end = stepIndexById.get(section.endStepId);
  const ids = new Set();
  for (let index = start; index <= end; index += 1) {
    for (const brickId of input.steps[index].newBrickIds) ids.add(brickId);
  }
  return ids;
}

function protectedSectionKeys(input) {
  return new Set(input.protectedRanges.map(({ startStepId, endStepId }) => `${startStepId}\0${endStepId}`));
}

function regionQualifier(chapterBounds, wholeBounds) {
  if (!chapterBounds || !wholeBounds) return null;
  const minimum = wholeBounds.y.min;
  const maximum = wholeBounds.y.maxExclusive;
  const span = maximum - minimum;
  const half = minimum + span / 2;
  if (chapterBounds.y.maxExclusive <= half) return 'Lower';
  if (chapterBounds.y.min >= half) return 'Upper';
  if (chapterBounds.y.min >= minimum + span * 0.25
    && chapterBounds.y.maxExclusive <= minimum + span * 0.75) return 'Middle';
  return null;
}

function colorEvidence(bricks) {
  const volumes = new Map();
  let total = 0;
  for (const [, , , , width, depth, color] of bricks) {
    const volume = width * depth;
    total += volume;
    volumes.set(color, (volumes.get(color) ?? 0) + volume);
  }
  const fractions = Object.fromEntries([...volumes.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([color, volume]) => [color, volume / total]));
  const [dominantColor, dominantVolume = 0] = [...volumes.entries()]
    .sort(([leftColor, leftVolume], [rightColor, rightVolume]) => rightVolume - leftVolume
      || leftColor.localeCompare(rightColor))[0] ?? [];
  return {
    occupiedCellVolume: total,
    fractions,
    dominantColor: dominantColor ?? null,
    dominantFraction: total ? dominantVolume / total : 0,
  };
}

function qualifiedLabel(qualifier, label) {
  return `${qualifier} ${label.toLowerCase()}`;
}

export function refineSemanticLabelDetails(rawInput, rawAnnotation) {
  const input = validateSemanticGuideInput(rawInput);
  const originalAnnotation = validateSemanticGuideAnnotation(input, rawAnnotation);
  const stepIndexById = new Map(input.steps.map((step, index) => [step.id, index]));
  const bricksById = new Map(input.bricks.map((brick) => [brick[0], brick]));
  const wholeBounds = boundsFor(input.bricks);
  const protectedKeys = protectedSectionKeys(input);
  const changes = [];
  const evidence = [];

  const sections = originalAnnotation.sections.map((section, index) => {
    const ids = chapterBrickIds(input, section, stepIndexById);
    const bricks = [...ids].map((brickId) => bricksById.get(brickId));
    const chapterBounds = boundsFor(bricks);
    const colors = colorEvidence(bricks);
    const protectedRepeat = protectedKeys.has(`${section.startStepId}\0${section.endStepId}`);
    const generic = typeof section.label === 'string'
      && GENERIC_LABELS.has(section.label.toLowerCase());
    let qualifier = null;
    let rule = section.label === null ? 'null-label' : generic ? 'no-qualifier' : 'not-generic';

    if (generic && bricks.length === 0) {
      rule = 'empty-chapter-skipped';
    } else if (generic && protectedRepeat) {
      rule = 'protected-repeat-skipped';
    } else if (generic) {
      qualifier = regionQualifier(chapterBounds, wholeBounds);
      if (qualifier) {
        rule = `physical-y-${qualifier.toLowerCase()}`;
      } else if (colors.dominantFraction >= 0.95 && COLOR_LABELS[colors.dominantColor]) {
        qualifier = COLOR_LABELS[colors.dominantColor];
        rule = 'palette-color-95-percent';
      }
    }

    const label = qualifier ? qualifiedLabel(qualifier, section.label) : section.label;
    if (label !== section.label) changes.push({
      chapterIndex: index + 1,
      startStepId: section.startStepId,
      endStepId: section.endStepId,
      from: section.label,
      to: label,
      rule,
    });
    evidence.push({
      chapterIndex: index + 1,
      startStepId: section.startStepId,
      endStepId: section.endStepId,
      originalLabel: section.label,
      derivedLabel: label,
      protectedRepeat,
      wholeBounds,
      chapterBounds,
      colors,
      rule,
      fingerprint: input.fingerprint,
    });
    return { ...section, label };
  });

  const annotation = validateSemanticGuideAnnotation(input, {
    ...originalAnnotation,
    sections,
  });
  return {
    originalAnnotation,
    annotation,
    evidence,
    changes,
    fingerprint: input.fingerprint,
  };
}
