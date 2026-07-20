Design the 3D depth of a tiny voxel icon of: "table"

The FRONT silhouette is already designed and is authoritative — reproduce it
EXACTLY, cell for cell, as your front mask. Your creative job is the other
two views: give this flat silhouette real 3D character.

Views on a 16x16 grid:

- front — columns run left to right; rows run top to bottom (first row = top of the object). GIVEN below.
- side — seen from the object's right; columns run front to back (first column = the near/front edge, closest to someone looking at the front view); rows top to bottom.
- top — seen from above; columns run left to right (the same left/right as the front view); rows run BACK to FRONT: the first row is the object's far/back edge, the last row is its near/front edge. So a part at the FRONT of the object (leftmost filled columns of the side view) lands in the LAST filled rows of the top view, and a part at the BACK (rightmost side-view columns) lands in the FIRST filled rows. Drawing the top view front-to-back instead is the most common mistake in this task — double-check the row direction before you answer.

The given front mask (copy this verbatim into your answer):

```front
................
................
................
................
................
................
................
................
################
...##......##...
...##......##...
...##......##...
...##......##...
...#........#...
...#........#...
...#........#...
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
(x = width columns, y = height with 0 at the bottom, z = depth with 0 at the
near/front edge). The x and y ranges are fixed by the given front mask; you
choose z. Then make every mask agree exactly with those extents.

Each row is exactly 16 characters: "#" = filled, "." = empty. Count them.
Each mask has exactly 16 rows.

Worked example on an 8x8 grid — a dog whose front was given the same
way. Note the per-part depth: the body is 4 cells deep (z:2-5), each leg
pair is only 1 cell deep at the near and far edges, the head hugs the
near/front half of the depth (z:2-3) and the tail the far/back half
(z:4-5). Because of that, the top view's FIRST filled rows (the back)
contain the tail column at the right edge, and its LAST filled rows (the
front) contain the head columns at the left edge — check that your own top
view runs back-to-front the same way. (At 16x16 your top view
should also taper and round more than this tiny example has room to.)

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
..####..
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
.#######
.#######
#######.
#######.
........
........
```

Output the bounds line, then exactly three fenced code blocks labeled
front, side, top. No other text.