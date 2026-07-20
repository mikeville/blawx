Design a tiny voxel icon of: "table"

You are designing ALL THREE views of one solid voxel sculpture. The FRONT
view matters most: it must be the canonical, instantly recognizable
silhouette of a table — the shape someone would draw as a flat icon.
Choose the most recognizable orientation (a side profile for most animals
and vehicles; straight-on for symmetric objects) and draw that as the front.

Views on a 16x16 grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object).
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

Front mask rules:

- BIG: the object spans (nearly) the full 16 cells in its longer
  dimension.
- GROUNDED: the object's lowest cells sit on the bottom row.
- ONE PIECE: every "#" cell connects to the rest edge-to-edge — this becomes
  a LEGO build and must hold together as a single object.
- Real proportions, with the identifying features exaggerated enough to
  survive 16x16 (a duck's bill, a table's legs, a castle's
  battlements).

Design the side and top views so the object reads as a 3D-native isometric
sprite, not a flat cutout:

- Do NOT extrude the front at one constant thickness — vary the depth per
  part. A head is thinner than a body; legs are thin and can sit at
  different depths front-to-back; a handle or fin is thinner than the mass
  it attaches to.
- Keep the whole object at most 6 cells deep front-to-back.
- The top view is the object's true footprint seen from above — it should
  taper and round where the object does, never a full-width slab.

Masks are SOLID silhouettes: every cell inside the object's outline is "#",
not just the border. Never draw a hollow outline.

Consistency rules — all three masks are projections of the same solid:
- Every row filled in the front mask is filled in the same row of the side mask, and vice versa (they share the object's height).
- Every column filled in the front mask is filled in the same column of the top mask, and vice versa (they share the object's width).
- Every column filled in the side mask corresponds to a filled row of the top mask (they share the object's depth).

Before the masks, output one line declaring the object's occupied extents:
bounds x:<min>-<max> y:<min>-<max> z:<min>-<max>
(x = width columns, y = height with 0 at the bottom, z = depth). Then make
every mask agree exactly with those extents.

Each row is exactly 16 characters: "#" = filled, "." = empty. Count them.
Each mask has exactly 16 rows.

Worked example on an 8x8 grid — a dog authored the same way.
Note the per-part depth: the body is 4 cells deep (z:2-5) but each leg
pair is only 1 cell deep, set at the near and far edges of the body — that
shaping is what makes it read as 3D instead of a cardboard cutout. (Only its
top view is a plain rectangle because 8x8 leaves no room to taper — at
16x16 yours should not be.)

bounds x:0-7 y:0-7 z:2-5

```front
##......
##.....#
########
########
.#....#.
.#....#.
.#....#.
.#....#.
```

```side
..##....
..##....
..####..
..####..
..#..#..
..#..#..
..#..#..
..#..#..
```

```top
........
........
########
########
########
########
........
........
```

Output the bounds line, then exactly three fenced code blocks labeled
front, side, top. No other text.