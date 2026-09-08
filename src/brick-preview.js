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
