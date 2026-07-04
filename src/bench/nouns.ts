// Fixed benchmark noun list. Do not reorder or swap nouns between runs —
// scores are only comparable across pipeline versions on the same list.

export type BenchCategory = 'structural' | 'organic' | 'hard';

export type BenchNoun = { noun: string; category: BenchCategory };

export const NOUNS: BenchNoun[] = [
  // easy structural — should work from day one; regressions here are alarms
  { noun: 'mug', category: 'structural' },
  { noun: 'chair', category: 'structural' },
  { noun: 'house', category: 'structural' },
  { noun: 'table', category: 'structural' },
  { noun: 'sword', category: 'structural' },
  { noun: 'sailboat', category: 'structural' },
  { noun: 'lighthouse', category: 'structural' },
  { noun: 'ladder', category: 'structural' },
  { noun: 'car', category: 'structural' },
  { noun: 'hat', category: 'structural' },

  // organic — the known failure zone (caricature transform required)
  { noun: 'fox', category: 'organic' },
  { noun: 'bird', category: 'organic' },
  { noun: 'fish', category: 'organic' },
  { noun: 'flower', category: 'organic' },
  { noun: 'tree', category: 'organic' },
  { noun: 'cat', category: 'organic' },
  { noun: 'duck', category: 'organic' },
  { noun: 'mushroom', category: 'organic' },
  { noun: 'frog', category: 'organic' },
  { noun: 'snail', category: 'organic' },
  { noun: 'horse', category: 'organic' },
  { noun: 'penguin', category: 'organic' },

  // hard — complex body plans, abstraction, multi-word phrases
  { noun: 'octopus', category: 'hard' },
  { noun: 'dragon', category: 'hard' },
  { noun: 'robot', category: 'hard' },
  { noun: 'spider', category: 'hard' },
  { noun: 'love', category: 'hard' },
  { noun: 'palm tree', category: 'hard' },
  { noun: 'ice cream cone', category: 'hard' },
  { noun: 'rocket ship', category: 'hard' },
];
