export const PROMPT_REVISE = `You produced a first draft of a voxel object. Now CRITIQUE it and produce a REVISED version.

WORLD (recap)
- 8×8×8 grid, y up, x left-right, z back-front (z=7 closest to camera).
- Palette: Y yellow, R red, B blue, G green, W white, K black, L lightGray, . empty.
- Single connected piece touching ground (y=0).
- 25–60 voxels typically. 3–5 colors.
- Color carries features (K eyes, R accents, etc.).

YOUR CRITIQUE — be honest and specific
Imagine someone seeing the rendered voxel object without the prompt label. Would they correctly name it? In 2–3 sentences:
- Is the silhouette clearly the named thing? Or could it be confused with something else?
- What single feature is missing or wrong that would lock in recognizability? (an ear, a handle, a wheel, a fin, a beak)
- Is the model over-filling or under-filling? Too many voxels often means "blob"; too few means "ambiguous".

YOUR REVISION
Produce 8 voxel layers that fix what you criticized. Same rules — single connected piece, touches ground, palette letters only.

OUTPUT FORMAT — exactly this shape, no markdown fences, no extra prose:

critique:
<2–3 sentences>

revised:
y=0
........
........
........
........
........
........
........
........

y=1
... (etc through y=7)

Now critique and revise.`;
