// Physical brick dimensions in source-voxel display units at the chosen scale.
// Stud/course coordinates stay unchanged in the exported placement model.
export function brickPreviewData(model) {
  const bricks = model.bricks;
  const { studsPerVoxel = 1, coursesPerVoxel = 5/6, voxelMm = 8 } = model.meta?.scale ?? {};
  const layers = new Map();
  const width = bricks.reduce((max, b) => Math.max(max, b.x + b.w), 0);
  const depth = bricks.reduce((max, b) => Math.max(max, b.z + b.d), 0);
  for (const brick of bricks) {
    if (!layers.has(brick.y)) layers.set(brick.y, new Uint8Array(width * depth));
    const layer = layers.get(brick.y);
    for (let z = brick.z; z < brick.z + brick.d; z++) for (let x = brick.x; x < brick.x + brick.w; x++) layer[z * width + x] = 1;
  }
  const studs = [];
  for (const b of bricks) {
    const above = layers.get(b.y + 1);
    for (let z = b.z; z < b.z + b.d; z++) for (let x = b.x; x < b.x + b.w; x++) {
      if (!above?.[z * width + x]) studs.push({ x: (x + .5) / studsPerVoxel, y: (b.y + 1) / coursesPerVoxel + .9 / voxelMm, z: (z + .5) / studsPerVoxel, color: b.color, id: b.id });
    }
  }
  return {
    bodies: bricks.map(b => ({
      x: (b.x + b.w / 2) / studsPerVoxel, y: (b.y + .5) / coursesPerVoxel, z: (b.z + b.d / 2) / studsPerVoxel,
      w: (b.w * 8 - .2) / voxelMm, h: (9.6 - .08) / voxelMm, d: (b.d * 8 - .2) / voxelMm, color: b.color, id: b.id,
    })),
    studs,
  };
}

// The source model is useful before local packing finishes, but bare cubes make
// that preview feel like a different material. Render each source cell as a
// temporary 1×1 brick and expose only studs that are not covered by the cell
// directly above it. Generated IDs keep bodies and studs together in entrance
// motion without changing the source model.
export function voxelPreviewData(model) {
  const voxelMm = model.meta?.scale?.voxelMm ?? 8;
  const occupied = new Set(model.cells.map(cell => `${cell.x},${cell.y},${cell.z}`));
  const sourceBricks = model.cells.map((cell, index) => ({
    ...cell,
    id: cell.id ?? `voxel-${index}`,
    w: 1,
    h: 1,
    d: 1,
  }));
  const bodies = sourceBricks.map(cell => ({
    ...cell,
    x: cell.x + .5,
    y: cell.y + .5,
    z: cell.z + .5,
    w: .96,
    h: .96,
    d: .96,
  }));
  const studs = sourceBricks
    .filter(cell => !occupied.has(`${cell.x},${cell.y + 1},${cell.z}`))
    .map(cell => ({
      x: cell.x + .5,
      y: cell.y + 1 + .9 / voxelMm,
      z: cell.z + .5,
      color: cell.color,
      id: cell.id,
    }));
  return { bodies, studs, sourceBricks, voxelMm };
}
