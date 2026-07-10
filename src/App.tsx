import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { Shell } from './shell/Shell.tsx';
import { Booklet } from './booklet/Booklet.tsx';
import { Surface } from './surface/Surface.tsx';
import { buildHeroPool, pickOne, loadBricksForNoun } from './surface/heroSets.ts';
import { buildSteps, allBricks } from './voxel/steps.ts';
import type { Brick } from './voxel/types.ts';
import { setNumberFor, slug } from './api/slug.ts';
import { generate, type GenerateResult } from './api/generateClient.ts';

// Names only — the booklet's geometry now comes from the Worker (KV),
// not the bundle. Non-eager so the JSON isn't pulled into the main
// chunk; we read just the filenames to build the landing's library
// index. `misses` (ledger) and `run` (verb / poor gen) aren't entries.
const seed4Paths = import.meta.glob('../runs/seed4-16char-mixed/*.json');
const EXCLUDE = new Set(['misses', 'run']);

function seed4Nouns(): string[] {
  return Object.keys(seed4Paths)
    .map((p) => p.match(/\/([^/]+)\.json$/)?.[1])
    .filter((n): n is string => !!n && !EXCLUDE.has(n))
    .sort();
}

type View = { status: 'loading' } | GenerateResult;

function ResultMessage({
  children,
  onReset,
}: {
  children: ReactNode;
  onReset: () => void;
}) {
  return (
    <div className="result-msg">
      <p className="result-msg__text">{children}</p>
      <button type="button" className="result-msg__back" onClick={onReset}>
        Back
      </button>
    </div>
  );
}

function readQuery(): string | null {
  return new URLSearchParams(window.location.search).get('q');
}

export default function App() {
  const nouns = useMemo(seed4Nouns, []);
  const heroPool = useMemo(() => buildHeroPool(nouns), [nouns]);

  const [q, setQ] = useState<string | null>(readQuery);
  // Bumped on reset so returning to idle re-rolls the stage's random set.
  const [idleNonce, setIdleNonce] = useState(0);
  const [view, setView] = useState<View>({ status: 'loading' });

  // The one thing the persistent stage shows: the idle random set while
  // idle, the finished model once a build resolves. Held across the
  // idle → loading transition so the stage never blanks out (3b will
  // assemble the front layer here during the wait).
  const [stageBricks, setStageBricks] = useState<Brick[]>([]);

  useEffect(() => {
    let alive = true;
    if (q === null) {
      const noun = pickOne(heroPool);
      if (!noun) {
        setStageBricks([]);
        return;
      }
      loadBricksForNoun(noun).then((bricks) => {
        if (alive) setStageBricks(bricks);
      });
      return () => {
        alive = false;
      };
    }
    setView({ status: 'loading' });
    generate(slug(q)).then((r) => {
      if (!alive) return;
      setView(r);
      if (r.status === 'ok') setStageBricks(allBricks(buildSteps(r.grid)));
    });
    return () => {
      alive = false;
    };
  }, [q, idleNonce, heroPool]);

  useEffect(() => {
    const onPop = () => setQ(readQuery());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  function navigate(term: string) {
    const s = slug(term);
    window.history.pushState({}, '', `?q=${encodeURIComponent(s)}`);
    setQ(s);
    window.scrollTo(0, 0);
  }

  function reset() {
    window.history.pushState({}, '', './');
    setQ(null);
    setIdleNonce((n) => n + 1);
    window.scrollTo(0, 0);
  }

  const s = q === null ? null : slug(q);
  const setNumber = s !== null && view.status === 'ok' ? setNumberFor(s) : undefined;

  function content() {
    if (s === null) return <Surface nouns={nouns} onSubmit={navigate} />;
    if (view.status === 'loading') {
      return (
        <div className="result-msg">
          <p className="result-msg__text">
            building <code>{s}</code>…
          </p>
        </div>
      );
    }
    if (view.status === 'ok') {
      return (
        <Booklet grid={view.grid} term={s} setNumber={setNumberFor(s)} onReset={reset} />
      );
    }
    return (
      <ResultMessage onReset={reset}>
        {view.status === 'miss' ? (
          <>
            no cached build for <code>{s}</code> yet.
          </>
        ) : (
          <>
            couldn’t reach the builder for <code>{s}</code>
            {view.message ? ` (${view.message})` : ''}.
          </>
        )}
      </ResultMessage>
    );
  }

  return (
    <Shell stageBricks={stageBricks} setNumber={setNumber}>
      {content()}
    </Shell>
  );
}
