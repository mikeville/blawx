// Discovery and replay must agree: a valid larger component must not be split
// solely because its complete recipe cannot pass a smaller replay limit.
// Search counts, depth, footprint and physical validation remain independent.
export const MAX_ASSEMBLY_RECIPE_BRICKS = 512;
