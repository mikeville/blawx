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

const generated = import.meta.glob<GeneratedModule>('/src/voxel/generated/*.ts', {
  eager: true,
});

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

function loadEntries(): Entry[] {
  const entries: Entry[] = [];
  for (const [pathKey, mod] of Object.entries(generated)) {
    entries.push({
      term: mod.term ?? termFromPath(pathKey),
      grid: mod.default,
    });
  }
  entries.push({ term: 'duck (reference)', grid: sampleDuck });
  entries.push({ term: 'tree (reference)', grid: sampleTree });
  entries.push({ term: 'house (reference)', grid: sampleHouse });
  entries.sort((a, b) => a.term.localeCompare(b.term));
  return entries;
}

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

export function Gallery() {
  const entries = loadEntries();
  const analyzed = entries.map(e => ({ ...e, conn: analyze(e.grid) }));
  const brokenCount = analyzed.filter(e => e.conn.components > 1 || !e.conn.touchesGround).length;

  return (
    <div className="gallery">
      <header className="gallery__header">
        <h1>blawx — voxel generation spike</h1>
        <p>
          {entries.length} model{entries.length === 1 ? '' : 's'}
          {brokenCount > 0 ? ` · ${brokenCount} broken (multi-part or floating)` : ''}
          . Click a tile to rotate the view 90°.
        </p>
      </header>
      <div className="gallery__grid">
        {analyzed.map(({ term, grid, conn }) => (
          <Tile key={term} term={term} grid={grid} conn={conn} />
        ))}
      </div>
    </div>
  );
}
