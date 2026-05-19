import { useState } from 'react';
import type { Brick, VoxelGrid } from '../voxel/types.ts';
import { Scene } from '../render/Scene.tsx';
import { sampleDuck } from '../voxel/sampleDuck.ts';
import { sampleTree } from '../voxel/sampleTree.ts';
import { sampleHouse } from '../voxel/sampleHouse.ts';
import { rotateGrid, type Rotation } from '../voxel/transform.ts';
import { analyze, type Connectivity } from '../voxel/analyze.ts';

type GeneratedModule = {
  default: VoxelGrid;
  term?: string;
};

// Current pipeline outputs land flat in /src/voxel/generated/*.ts.
// Saved snapshots from earlier approaches live in named subfolders
// (baseline-llm, future: baseline-trellis, etc.). The gallery groups
// by source so the current pipeline can be compared against snapshots.
const currentMods = import.meta.glob<GeneratedModule>('/src/voxel/generated/*.ts', {
  eager: true,
});
const baselineLlmMods = import.meta.glob<GeneratedModule>(
  '/src/voxel/generated/baseline-llm/*.ts',
  { eager: true },
);

function voxelsToCubes(grid: VoxelGrid): Brick[] {
  return grid.voxels.map(v => ({
    x: v.x,
    y: v.y,
    z: v.z,
    w: 1,
    d: 1,
    color: v.color,
  }));
}

function termFromPath(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.ts$/, '');
}

type Entry = { term: string; grid: VoxelGrid };

function toEntries(mods: Record<string, GeneratedModule>): Entry[] {
  const out: Entry[] = [];
  for (const [pathKey, mod] of Object.entries(mods)) {
    out.push({ term: mod.term ?? termFromPath(pathKey), grid: mod.default });
  }
  out.sort((a, b) => a.term.localeCompare(b.term));
  return out;
}

const REFERENCES: Entry[] = [
  { term: 'duck (reference)', grid: sampleDuck },
  { term: 'tree (reference)', grid: sampleTree },
  { term: 'house (reference)', grid: sampleHouse },
];

type TileProps = {
  term: string;
  grid: VoxelGrid;
  conn: Connectivity;
};

function ConnectivityBadge({ conn }: { conn: Connectivity }) {
  const broken = conn.components > 1 || !conn.touchesGround;
  if (broken) {
    const parts: string[] = [];
    if (conn.components > 1) parts.push(`${conn.components} parts`);
    if (!conn.touchesGround) parts.push('floats');
    return <span className="gallery__badge gallery__badge--broken">{parts.join(' · ')}</span>;
  }
  if (conn.floatingCount > 0) {
    return <span className="gallery__badge gallery__badge--warn">{conn.floatingCount} unsupported</span>;
  }
  return <span className="gallery__badge gallery__badge--ok">solid</span>;
}

function Tile({ term, grid, conn }: TileProps) {
  const [rotation, setRotation] = useState<Rotation>(0);
  const rotated = rotateGrid(grid, rotation);
  const cycle = () => setRotation(r => ((r + 1) % 4) as Rotation);

  const broken = conn.components > 1 || !conn.touchesGround;
  const cls = `gallery__tile${broken ? ' gallery__tile--broken' : ''}`;

  return (
    <figure className={cls}>
      <button type="button" className="gallery__scene" onClick={cycle} aria-label="rotate">
        <Scene
          cumulative={[]}
          fresh={voxelsToCubes(rotated)}
          unit={28}
          margin={20}
          style="cube"
        />
        <span className="gallery__rotation">{rotation * 90}°</span>
      </button>
      <figcaption>
        <span className="gallery__term">{term}</span>
        <ConnectivityBadge conn={conn} />
        <span className="gallery__count">{grid.voxels.length}v</span>
      </figcaption>
    </figure>
  );
}

type Section = {
  title: string;
  subtitle: string;
  entries: Entry[];
};

function withConn(entries: Entry[]): Array<Entry & { conn: Connectivity }> {
  return entries.map(e => ({ ...e, conn: analyze(e.grid) }));
}

function brokenIn(entries: Array<Entry & { conn: Connectivity }>): number {
  return entries.filter(e => e.conn.components > 1 || !e.conn.touchesGround).length;
}

export function Gallery() {
  const currentEntries = withConn(toEntries(currentMods));
  const baselineLlmEntries = withConn(toEntries(baselineLlmMods));
  const referenceEntries = withConn(REFERENCES);

  const sections: Array<{
    title: string;
    subtitle: string;
    entries: Array<Entry & { conn: Connectivity }>;
  }> = [];

  if (currentEntries.length > 0) {
    sections.push({
      title: 'Current pipeline',
      subtitle: `${currentEntries.length} model${currentEntries.length === 1 ? '' : 's'} from the latest generation pipeline.`,
      entries: currentEntries,
    });
  } else {
    sections.push({
      title: 'Current pipeline',
      subtitle: 'No outputs yet. Run `npm run generate -- "<term>"` to add models here.',
      entries: [],
    });
  }

  if (baselineLlmEntries.length > 0) {
    const broken = brokenIn(baselineLlmEntries);
    sections.push({
      title: 'Baseline — LLM-only (draft + revise)',
      subtitle: `${baselineLlmEntries.length} models, saved snapshot. ${broken > 0 ? `${broken} broken. ` : ''}See NEXT-DIRECTION.md for why this is preserved.`,
      entries: baselineLlmEntries,
    });
  }

  sections.push({
    title: 'Hand-authored references',
    subtitle: 'Used as worked examples in prompts. Ground truth for the renderer.',
    entries: referenceEntries,
  });

  return (
    <div className="gallery">
      <header className="gallery__header">
        <h1>blawx — voxel generation spike</h1>
        <p>Click any tile to rotate the view 90°.</p>
      </header>
      {sections.map(s => (
        <section key={s.title} className="gallery__section">
          <h2 className="gallery__section-title">{s.title}</h2>
          <p className="gallery__section-subtitle">{s.subtitle}</p>
          {s.entries.length > 0 && (
            <div className="gallery__grid">
              {s.entries.map(({ term, grid, conn }) => (
                <Tile key={term} term={term} grid={grid} conn={conn} />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
