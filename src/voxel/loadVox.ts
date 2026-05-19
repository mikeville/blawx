import type { VoxelGrid, Color } from './types.ts';

const PALETTE_INDEX_TO_COLOR: Record<number, Color> = {
  1: 'red',
  2: 'yellow',
  3: 'blue',
  4: 'green',
  5: 'white',
  6: 'black',
  7: 'lightGray',
};

export function loadVox(_buffer: ArrayBuffer): VoxelGrid {
  void PALETTE_INDEX_TO_COLOR;
  throw new Error(
    'loadVox: not yet wired. To enable: install an MIT-compatible .vox parser, ' +
    'parse the buffer to { SIZE, XYZI }, validate SIZE is 8x8x8, ' +
    'and map each XYZI entry to a Voxel — swapping MagicaVoxel z-up to our y-up convention.',
  );
}
