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

// probe8 variant of DOG with a z-ASYMMETRIC top view: the head hugs the
// front half of the depth (z:2-3) and the tail the back half (z:4-5), so the
// top view itself demonstrates the back-to-front row convention. DOG's top
// is front-back symmetric and carries no information about that convention —
// the suspected cause of probe7's 9/10 top-view z-mirror first drafts.
// DOG is kept untouched so probe6/probe7 prompt scripts stay reproducible.
export const DOG_Z: Exemplar = {
  label: 'dog-z',
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
    '..####..',
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
    '.#######',
    '.#######',
    '#######.',
    '#######.',
    '........',
    '........',
  ],
};

export const EXEMPLARS: Exemplar[] = [DOG, SPARROW, CARP, DOG_Z];
