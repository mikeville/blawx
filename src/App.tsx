import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { Shell } from './shell/Shell.tsx';
import { Booklet } from './booklet/Booklet.tsx';
import { Surface } from './surface/Surface.tsx';
import { BuildLog, type LogStep } from './build/BuildLog.tsx';
import { buildHeroPool, pickOne, loadBricksForNoun } from './surface/heroSets.ts';
import { buildSteps, allBricks } from './voxel/steps.ts';
import { frontMaskToBricks } from './voxel/frontLayer.ts';
import { overlayToBricks } from './voxel/colorOverlay.ts';
import type { Brick } from './voxel/types.ts';
import { setNumberFor, slug } from './api/slug.ts';
import { generate, type GenerateResult } from './api/generateClient.ts';
import { MotionDevPanel } from './dev/MotionDevPanel.tsx';

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

// Distinct, honest copy per failure — never one generic "something went
// wrong". A miss says we don't have it (and why); an error says the build
// couldn't finish (and whether retrying helps).
function failureText(
  view: Extract<GenerateResult, { status: 'miss' } | { status: 'error' }>,
  term: string,
): ReactNode {
  if (view.status === 'miss') {
    return view.code === 'no-source' ? (
      <>
        no starting outline for <code>{term}</code> yet.
      </>
    ) : (
      <>
        no cached build for <code>{term}</code> yet.
      </>
    );
  }
  switch (view.kind) {
    case 'rate-limit':
      return <>5 fresh builds an hour — cached sets are free. try one from the shelf.</>;
    case 'network':
      return (
        <>
          couldn’t reach the builder for <code>{term}</code>.
        </>
      );
    case 'config':
      return <>the builder isn’t configured ({view.message}).</>;
    default:
      return (
        <>
          couldn’t finish <code>{term}</code> — try again.
        </>
      );
  }
}

// Stage 4 dev harness: an isolated playground for comparing stop-motion
// assembly profiles, gated behind ?dev so it never enters the shipped
// path. A hook-free wrapper picks between the two components rather than
// early-returning inside one — each of AppMain / MotionDevPanel calls its
// own hooks unconditionally, satisfying the rules of hooks.
export default function App() {
  if (new URLSearchParams(window.location.search).has('dev')) {
    return <MotionDevPanel />;
  }
  return <AppMain />;
}

function AppMain() {
  const nouns = useMemo(seed4Nouns, []);
  const heroPool = useMemo(() => buildHeroPool(nouns), [nouns]);

  const [q, setQ] = useState<string | null>(readQuery);
  // Bumped on reset so returning to idle re-rolls the stage's random set.
  const [idleNonce, setIdleNonce] = useState(0);
  const [view, setView] = useState<View>({ status: 'loading' });

  // The honest build log during a live generation — one row per real
  // pipeline op, streamed from the Worker. Empty while idle / on a hit.
  const [logSteps, setLogSteps] = useState<LogStep[]>([]);

  // The one thing the persistent stage shows: the idle random set while
  // idle; the front brick layer (from the FA mask, known at t=0) during the
  // model wait; the finished model once a build resolves. Held across the
  // idle → loading transition so the stage never blanks out.
  const [stageBricks, setStageBricks] = useState<Brick[]>([]);
  // Bumped alongside each new stage set so the shell replays the stop-motion
  // assembly from frame 0 (a set change without a trigger bump would render
  // frozen at the previous animation's final frame).
  const [stageTrigger, setStageTrigger] = useState(0);

  useEffect(() => {
    let alive = true;
    if (q === null) {
      const noun = pickOne(heroPool);
      if (!noun) {
        setStageBricks([]);
        return;
      }
      loadBricksForNoun(noun).then((bricks) => {
        if (!alive) return;
        setStageBricks(bricks);
        setStageTrigger((n) => n + 1);
      });
      return () => {
        alive = false;
      };
    }
    setView({ status: 'loading' });
    setLogSteps([]);
    generate(slug(q), (e) => {
      if (!alive) return;
      if (e.kind === 'front') {
        // Front silhouette in hand before any depth — assemble it on the
        // stage so the wait shows the real build starting, not a spinner.
        setStageBricks(frontMaskToBricks(e.mask, e.color));
        setStageTrigger((n) => n + 1);
      } else if (e.kind === 'paint') {
        // Same geometry as the front mask already assembling, now with the
        // model's real per-cell colors. Deliberately do NOT bump
        // stageTrigger: useStopMotion.ts keys its start frames off brick
        // coordinates, so swapping in same-geometry/new-color bricks without
        // a trigger bump repaints in place mid-assembly instead of
        // restarting the animation from frame 0.
        const bricks = overlayToBricks(e.overlay);
        if (bricks.length > 0) setStageBricks(bricks);
      } else {
        setLogSteps((prev) => [...prev, { id: e.id, label: e.label }]);
      }
    }).then((r) => {
      if (!alive) return;
      setView(r);
      if (r.status === 'ok') {
        setStageBricks(allBricks(buildSteps(r.grid)));
        setStageTrigger((n) => n + 1);
      }
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
      return <BuildLog term={s} steps={logSteps} />;
    }
    if (view.status === 'ok') {
      return (
        <Booklet grid={view.grid} term={s} setNumber={setNumberFor(s)} onReset={reset} />
      );
    }
    return <ResultMessage onReset={reset}>{failureText(view, s)}</ResultMessage>;
  }

  return (
    <Shell stageBricks={stageBricks} stageTrigger={stageTrigger} setNumber={setNumber}>
      {content()}
    </Shell>
  );
}
