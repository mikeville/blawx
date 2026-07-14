import type { ReactNode } from 'react';
import { AnimatedStage } from '../render/AnimatedStage.tsx';
import { DEFAULT_PROFILES } from '../design/motionProfiles.ts';
import type { Brick } from '../voxel/types.ts';
import './shell.css';

type Props = {
  stageBricks: Brick[];
  /** Bumped by the caller on each new stage set, to replay the assembly. */
  stageTrigger: number;
  setNumber?: string;
  /** Wordmark click — returns to idle (and re-rolls the stage's set). */
  onHome: () => void;
  children: ReactNode;
};

// The persistent surface. The masthead and the iso stage never unmount
// across idle → loading → result — only the content *below the seam rule*
// swaps (the idle form, the build log, or the booklet). The single black
// rule between stage and content is the visible seam of the fixed-stage /
// swappable-content split, and the one landmark shared by every state.
export function Shell({
  stageBricks,
  stageTrigger,
  setNumber,
  onHome,
  children,
}: Props) {
  return (
    <div className="shell">
      <div className="shell__sheet">
        <header className="shell__masthead">
          <button type="button" className="shell__mark" onClick={onHome}>
            Blawx
          </button>
          <span className="shell__tagline">{setNumber ?? 'LEGO generator'}</span>
        </header>
        <div className="shell__stage">
          <AnimatedStage
            bricks={stageBricks}
            profile={DEFAULT_PROFILES.legoMovie}
            trigger={stageTrigger}
            unit={24}
            margin={16}
          />
        </div>
        <div className="shell__content">{children}</div>
      </div>
    </div>
  );
}
