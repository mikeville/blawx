import type { Brick } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';

type Props = {
  bricks: Brick[];
  term: string;
  setNumber: string;
  stepCount: number;
};

function displayTerm(term: string): string {
  return term.replace(/-/g, ' ');
}

// The hero: the finished build as the manual's cover. Masthead + the
// completed iso model + the term as a giant flat headline + machine
// metadata (set number, piece / step counts) in mono. This is the
// persistent iso stage carried through from the idle surface into the
// result — the constant motif — now showing the thing you named.
export function TitlePage({ bricks, term, setNumber, stepCount }: Props) {
  return (
    <section className="page page--title">
      <header className="masthead">
        <span className="masthead__mark">blawx</span>
        <span className="masthead__set">{setNumber}</span>
      </header>
      <div className="hero">
        <Scene cumulative={[]} fresh={bricks} unit={24} margin={12} />
      </div>
      <div className="hero__label">
        <h1 className="hero__term">{displayTerm(term)}</h1>
        <p className="hero__meta">
          {bricks.length} pieces · {stepCount} steps
        </p>
      </div>
    </section>
  );
}
