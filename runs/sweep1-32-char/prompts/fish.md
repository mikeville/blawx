Design a tiny voxel icon of: "fish"

Think of it as an isometric game icon, not a 3D model: one instantly
recognizable silhouette. Choose the object's most recognizable orientation
(animals: side profile). Ground it at the bottom of the grid and make it
fill most of the grid.

Output three orthographic silhouette masks of that one solid object on a
32x32 grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

Consistency rule: all three masks are projections of the same solid, so they
must agree — e.g. every row that is filled in the front mask must also be
filled somewhere in the same row of the side mask.

Each row is exactly 32 characters: "#" = filled, "." = empty.
Each mask has exactly 32 rows.

Example masks for a 4x4 sphere:

```front
.##.
####
####
.##.
```

Output exactly three fenced code blocks labeled front, side, top. No other text.