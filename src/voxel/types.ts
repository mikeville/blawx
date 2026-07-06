export type Color =
  | 'red'
  | 'yellow'
  | 'blue'
  | 'green'
  | 'white'
  | 'black'
  | 'lightGray';

export const GRID_SIZE = 8;

export type Voxel = {
  x: number;
  y: number;
  z: number;
  color: Color;
};

// size widened to number so 16³ (or other) grids can coexist with 8³ ones.
// Consumers should use `grid.size` rather than the GRID_SIZE constant.
export type VoxelGrid = {
  size: number;
  voxels: Voxel[];
};

export type BrickFootprint = { w: 1 | 2; d: 1 | 2 };

export type Brick = {
  x: number;
  y: number;
  z: number;
  w: 1 | 2;
  d: 1 | 2;
  color: Color;
};

export type Step = {
  newBricks: Brick[];
  cumulativeBricks: Brick[];
};
