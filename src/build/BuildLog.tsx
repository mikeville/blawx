import './build.css';

export type LogStep = { id: string; label: string };

/**
 * The honest build log, rendered in the shell's below-the-rule zone while
 * the Worker generates. Each row is one real pipeline op streamed from the
 * server (see the Worker's ProgressEvent); the last row is the op currently
 * running. Nearly all wall-clock is the model call(s), so that row holds
 * while the fast bookends flash past — the log tells the truth about where
 * the time goes. Meanwhile the front brick layer assembles on the stage
 * above. No spinner, no fake progress bar.
 */
export function BuildLog({ term, steps }: { term: string; steps: LogStep[] }) {
  const shown: LogStep[] = steps.length > 0 ? steps : [{ id: 'start', label: 'Starting the build' }];
  return (
    <div className="build-log">
      <p className="build-log__head">
        <span className="build-log__label">Building</span>
        <code className="build-log__term">{term}</code>
      </p>
      <ol className="build-log__steps">
        {shown.map((s, i) => {
          const active = i === shown.length - 1;
          return (
            <li
              key={`${s.id}-${i}`}
              className={`build-log__step${active ? ' is-active' : ' is-done'}`}
            >
              <span className="build-log__marker" aria-hidden="true" />
              <span className="build-log__text">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
