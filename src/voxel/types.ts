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

export type VoxelGrid = {
  size: typeof GRID_SIZE;
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
