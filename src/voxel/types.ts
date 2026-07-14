export type Color =
  | 'red'
  | 'yellow'
  | 'blue'
  | 'green'
  | 'white'
  | 'black'
  | 'lightGray'
  | 'orange'
  | 'brown'
  | 'tan';

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

export type BrickFootprint = { w: number; d: number };

export type Brick = {
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  color: Color;
};

export type Step = {
  newBricks: Brick[];
  cumulativeBricks: Brick[];
};
