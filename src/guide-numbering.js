function sameOrder(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function numberRange(numbers) {
  if (!numbers.length) return null;
  return { start: numbers[0], end: numbers.at(-1) };
}

export function formatGuideStepRange(range) {
  if (!range) return '';
  return range.start === range.end ? String(range.start) : `${range.start}–${range.end}`;
}

export function createGuideNumbering(sections) {
  if (!Array.isArray(sections)) throw new TypeError('Displayed guide sections must be an array.');
  const byStepId = new Map();
  const sectionRanges = new Map();
  const partRanges = new Map();
  let nextNumber = 1;

  for (const section of sections) {
    if (typeof section?.id !== 'string' || !Array.isArray(section.groups) || !Array.isArray(section.stepIds)) {
      throw new TypeError('Each displayed guide section must contain an id, groups, and stepIds.');
    }
    const displayedStepIds = section.groups.flatMap(group => {
      if (!Array.isArray(group?.stepIds)) throw new TypeError(`Guide section ${section.id} has a group without stepIds.`);
      return group.stepIds;
    });
    if (!sameOrder(displayedStepIds, section.stepIds)) {
      throw new RangeError(`Guide section ${section.id} must retain its step order across displayed groups.`);
    }
    const sectionNumbers = displayedStepIds.map(stepId => {
      if (typeof stepId !== 'string' || byStepId.has(stepId)) {
        throw new RangeError('Displayed guide step IDs must be unique strings.');
      }
      const number = nextNumber++;
      byStepId.set(stepId, number);
      return number;
    });
    sectionRanges.set(section.id, numberRange(sectionNumbers));

    for (const part of section.parts ?? []) {
      if (typeof part?.id !== 'string' || !Array.isArray(part.stepIds) || partRanges.has(part.id)) {
        throw new TypeError(`Guide section ${section.id} has an invalid reading part.`);
      }
      const numbers = part.stepIds.map(stepId => {
        const number = byStepId.get(stepId);
        if (number == null) throw new RangeError(`Reading part ${part.id} references an undisplayed step.`);
        return number;
      });
      partRanges.set(part.id, numberRange(numbers));
    }
  }

  return { byStepId, sectionRanges, partRanges, diagramCount: nextNumber - 1 };
}
