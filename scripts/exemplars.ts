// Hand-authored 8×8 worked-example exemplars used in probe prompts. Each
// exemplar's three masks are hand-checked against the strict hull lift
// (see validate-exemplars.ts) — do not "improve" the art without re-running
// that check; small changes to a solid silhouette can break reprojection.

export type Exemplar = {
  /** Noun used to label the worked example in the prompt. */
  label: string;
  bodyPlan: string; // 'quadruped' | 'bird' | 'fish' — plain string is fine
  bounds: string;   // the exact bounds line, e.g. 'bounds x:0-7 y:0-7 z:2-5'
  front: string[];  // 8 rows of 8 chars, '#'/'.'
  side: string[];
  top: string[];
};

export const DOG: Exemplar = {
  label: 'dog',
  bodyPlan: 'quadruped',
  bounds: 'bounds x:0-7 y:0-7 z:2-5',
  front: [
    '##......',
    '##.....#',
    '########',
    '########',
    '.#....#.',
    '.#....#.',
    '.#....#.',
    '.#....#.',
  ],
  side: [
    '..##....',
    '..##....',
    '..####..',
    '..####..',
    '..#..#..',
    '..#..#..',
    '..#..#..',
    '..#..#..',
  ],
  top: [
    '........',
    '........',
    '########',
    '########',
    '########',
    '########',
    '........',
    '........',
  ],
};

export const SPARROW: Exemplar = {
  label: 'sparrow',
  bodyPlan: 'bird',
  bounds: 'bounds x:0-7 y:0-7 z:2-5',
  front: [
    '.##.....',
    '###....#',
    '.#####.#',
    '.#######',
    '..#####.',
    '...#....',
    '...#....',
    '..###...',
  ],
  side: [
    '...##...',
    '...##...',
    '..####..',
    '..####..',
    '..####..',
    '...##...',
    '...##...',
    '...##...',
  ],
  top: [
    '........',
    '........',
    '..####..',
    '########',
    '########',
    '..####..',
    '........',
    '........',
  ],
};

export const CARP: Exemplar = {
  label: 'carp',
  bodyPlan: 'fish',
  bounds: 'bounds x:0-7 y:0-4 z:3-4',
  front: [
    '........',
    '........',
    '........',
    '...##...',
    '.#####.#',
    '########',
    '########',
    '.#####.#',
  ],
  side: [
    '........',
    '........',
    '........',
    '...#....',
    '...##...',
    '...##...',
    '...##...',
    '...##...',
  ],
  top: [
    '........',
    '........',
    '........',
    '########',
    '########',
    '........',
    '........',
    '........',
  ],
};

export const EXEMPLARS: Exemplar[] = [DOG, SPARROW, CARP];
