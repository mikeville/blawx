Design the 3D depth of a tiny voxel icon of: "duck"

The FRONT silhouette is already designed and is authoritative — reproduce it
EXACTLY, cell for cell, as your front mask. Your creative job is the other
two views: give this flat silhouette real 3D character.

Views on a 16x16 grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object). GIVEN below.
- side — seen from the object's right; columns run front to back; rows top to bottom.
- top — seen from above; columns run left to right; rows run back to front (first row = the back).

The given front mask (copy this verbatim into your answer):

```front
................
................
................
................
..##............
#####...........
...##...........
...##...........
..########......
..##########....
..###########...
...############.
....############
.....########...
.......#........
......##........
```

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
not just the border. Never draw a hollow outline. (The given front mask may
contain intentional holes — reproduce them exactly; do not fill them.)

Consistency rules — all three masks are projections of the same solid:
- Every row filled in the front mask is filled in the same row of the side mask, and vice versa (they share the object's height).
- Every column filled in the front mask is filled in the same column of the top mask, and vice versa (they share the object's width).
- Every column filled in the side mask corresponds to a filled row of the top mask (they share the object's depth).

Before the masks, output one line declaring the object's occupied extents:
bounds x:<min>-<max> y:<min>-<max> z:<min>-<max>
(x = width columns, y = height with 0 at the bottom, z = depth). The x and y
ranges are fixed by the given front mask; you choose z. Then make every mask
agree exactly with those extents.

Each row is exactly 16 characters: "#" = filled, "." = empty. Count them.
Each mask has exactly 16 rows.

Worked example on an 8x8 grid — a dog whose front was given the same
way. Note the per-part depth: the body is 4 cells deep (z:2-5) but each leg
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