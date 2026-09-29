/** A recipe's local coordinates may describe a connected core built upside down. */
export function recipeWorkingFrame(recipe, bricks, floor) {
  if (recipe.orientation !== undefined && !['upright', 'inverted'].includes(recipe.orientation)) {
    throw new RangeError('Unknown recipe working orientation.');
  }
  const inverted = recipe.orientation === 'inverted';
  const ceiling = Math.max(...bricks.map(b => b.y)) - floor;
  const turn = b => inverted ? {...b, y:ceiling-b.y, z:-b.z-b.d} : b;
  return {
    inverted,
    surfaceY:ceiling+floor+1,
    toLocal:b => turn({...b,y:b.y-floor}),
    fromLocal:b => { const local=turn(b); return {...local,y:local.y+floor}; },
  };
}

/** Keep canonical brick IDs while measuring diagrams in the builder's pose. */
export function workingViewBrick(brick, orientation) {
  return orientation?.kind === 'inverted'
    ? {...brick,y:orientation.surfaceY-1-brick.y,z:-brick.z-brick.d}
    : brick;
}
