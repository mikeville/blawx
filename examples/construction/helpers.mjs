export function constructionProgram() {
  const ops = [];
  const add = (opcode) => (...values) => ops.push([opcode, ...values]);
  const b = add('b');
  const e = add('e');
  const t = add('t');
  const boxes = (rows) => rows.forEach((row) => b(...row));
  const at = (values, build) => values.forEach(build);
  const corners = (xs, zs, y, w, h, d, color) =>
    at(zs, (z) => at(xs, (x) => b(x, y, z, w, h, d, color)));
  const bands = (ys, x, z, w, h, d, color) =>
    at(ys, (y) => b(x, y, z, w, h, d, color));
  return { ops, b, e, t, boxes, at, corners, bands };
}
