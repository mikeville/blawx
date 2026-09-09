import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { createSemanticGuideInput } from '../src/semantic-guide.js';
import {
  renderSemanticGuideChapters,
  renderSemanticGuideImages,
  renderSemanticGuideReferenceChapters,
} from '../server/semantic-guide-render.js';
import { validateNamingImages } from '../server/naming-budget.js';

function semanticInput(bricks, subject = 'colored geometric object') {
  const brickIds = bricks.map(({ id }) => id);
  const plan = {
    bricks,
    modules: [{ id: 'module', kind: 'grounded', brickIds }],
    steps: [{ id: 'step', moduleId: 'module', kind: 'build', newBrickIds: brickIds, issues: [] }],
    graph: { edges: [] },
  };
  return createSemanticGuideInput({ plan, subject });
}

function semanticInputWithSteps(stepBricks, subject = 'colored geometric object') {
  const bricks = stepBricks.flat();
  const brickIds = bricks.map(({ id }) => id);
  const plan = {
    bricks,
    modules: [{ id: 'module', kind: 'grounded', brickIds }],
    steps: stepBricks.map((entries, index) => ({
      id: `step-${index + 1}`,
      moduleId: 'module',
      kind: 'build',
      newBrickIds: entries.map(({ id }) => id),
      issues: [],
    })),
    graph: { edges: [] },
  };
  return createSemanticGuideInput({ plan, subject });
}

function semanticAnnotation(input, ranges) {
  return {
    version: 1,
    fingerprint: input.fingerprint,
    sections: ranges.map(([start, end], index) => ({
      startStepId: `step-${start}`,
      endStepId: `step-${end}`,
      label: `Chapter ${index + 1}`,
      confidence: 'high',
      evidence: `Steps ${start}-${end}.`,
    })),
  };
}

function decodePng(png) {
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  const compressed = [];
  let width;
  let height;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('ascii', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
    }
    if (type === 'IDAT') compressed.push(data);
    offset += length + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed));
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const source = y * (width * 4 + 1);
    assert.equal(raw[source], 0);
    raw.copy(pixels, y * width * 4, source + 1, source + 1 + width * 4);
  }
  return { width, height, pixels };
}

function closestPalette(pixel) {
  const colors = {
    red: [201, 26, 9], blue: [0, 85, 191], white: [244, 244, 244], background: [248, 247, 243],
  };
  return Object.entries(colors).sort(([, a], [, b]) => {
    const distance = (color) => color.reduce((sum, channel, index) => sum + (channel - pixel[index]) ** 2, 0);
    return distance(a) - distance(b);
  })[0][0];
}

test('renders four deterministic bounded PNG views with explicit axis descriptors', () => {
  const input = semanticInput([
    { id: 'base', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'red' },
    { id: 'top', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'blue' },
  ]);
  const first = renderSemanticGuideImages(input);
  const second = renderSemanticGuideImages(input);

  assert.equal(first.length, 4);
  assert.deepEqual(first.map(({ width, height }) => [width, height]), Array(4).fill([768, 768]));
  assert.deepEqual(first.map(({ view }) => view), [
    'front-right isometric; camera is above toward +x and -z; screen up follows +y',
    'rear-left isometric; camera is above toward -x and +z; screen up follows +y',
    'front orthographic; camera looks from -z toward +z; screen right is +x and screen up is +y',
    'right-side orthographic; camera looks from +x toward -x; screen right is +z and screen up is +y',
  ]);
  assert.deepEqual(first.map(({ png }) => createHash('sha256').update(png).digest('hex')),
    second.map(({ png }) => createHash('sha256').update(png).digest('hex')));
  for (const image of first) assert.deepEqual(decodePng(image.png).width, 768);
  assert.notDeepEqual(first[0].png, first[1].png);
});

test('front depth test lets a nearer red brick occlude a blue brick', () => {
  const input = semanticInput([
    { id: 'front-red', x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' },
    { id: 'rear-blue', x: 0, y: 0, z: 3, w: 2, d: 1, color: 'blue' },
  ]);
  const front = decodePng(renderSemanticGuideImages(input)[2].png);
  const center = (384 * front.width + 384) * 4;
  assert.equal(closestPalette(front.pixels.subarray(center, center + 4)), 'red');
});

test('renders literal hexadecimal brick colors into an actual PNG', () => {
  const input = semanticInput([
    { id: 'hex-red', x: 0, y: 0, z: 0, w: 2, d: 2, color: '#c91f25' },
  ]);
  const image = renderSemanticGuideImages(input)[2];
  const decoded = decodePng(image.png);
  const center = (384 * decoded.width + 384) * 4;
  const pixel = [...decoded.pixels.subarray(center, center + 4)];
  assert.ok(pixel[0] > 150 && pixel[1] < 80 && pixel[2] < 80, `expected rendered dark red, got ${pixel}`);

  const unsupported = semanticInput([
    { id: 'bad-color', x: 0, y: 0, z: 0, w: 1, d: 1, color: 'not-a-palette-color' },
  ]);
  assert.throws(() => renderSemanticGuideImages(unsupported), /must be a palette name, #rgb, or #rrggbb/);
});

test('canonical y renders upward and translation-only x/z changes preserve fitted pixels', () => {
  const bricks = [
    { id: 'lower', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'red' },
    { id: 'upper', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'blue' },
  ];
  const front = decodePng(renderSemanticGuideImages(semanticInput(bricks))[2].png);
  const rows = { red: [], blue: [] };
  for (let y = 0; y < front.height; y += 1) for (let x = 0; x < front.width; x += 1) {
    const offset = (y * front.width + x) * 4;
    const color = closestPalette(front.pixels.subarray(offset, offset + 4));
    if (color === 'red' || color === 'blue') rows[color].push(y);
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  assert.ok(rows.red.length > 1_000 && rows.blue.length > 1_000);
  assert.ok(mean(rows.blue) < mean(rows.red));

  const translated = bricks.map((brick) => ({ ...brick, x: brick.x + 137, z: brick.z - 83 }));
  const originalHashes = renderSemanticGuideImages(semanticInput(bricks)).map(({ png }) => createHash('sha256').update(png).digest('hex'));
  const translatedHashes = renderSemanticGuideImages(semanticInput(translated)).map(({ png }) => createHash('sha256').update(png).digest('hex'));
  assert.deepEqual(translatedHashes, originalHashes);
});

test('chapter sheets show exact range additions through pale completed-model context', () => {
  const input = semanticInputWithSteps([
    [{ id: 'lower-blue', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'blue' }],
    [{ id: 'upper-white', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'white' }],
  ]);
  const annotation = semanticAnnotation(input, [[1, 1], [2, 2]]);
  const first = renderSemanticGuideChapters(input, annotation);
  const second = renderSemanticGuideChapters(input, annotation);

  assert.equal(first.length, 1);
  assert.deepEqual(first.map(({ width, height }) => [width, height]), [[1024, 1024]]);
  assert.equal(first[0].view,
    'chapter sheet 1/1; rows 1, 2, blank top-bottom; left camera +x/-z iso, right camera -x/+z iso, +y up; pale whole-object context; original-color parts = exact chapter additions shown through context');
  assert.equal(validateNamingImages(first)[0].view, first[0].view);
  assert.deepEqual(first[0].png, second[0].png);

  const { pixels, width } = decodePng(first[0].png);
  let chapterOneBlue = 0;
  let chapterTwoCrispEdges = 0;
  for (let y = 25; y < 311; y += 1) for (let x = 66; x < 516; x += 1) {
    const offset = (y * width + x) * 4;
    if (pixels[offset + 2] > 110 && pixels[offset] < 100 && pixels[offset + 1] < 160) chapterOneBlue += 1;
  }
  for (let y = 366; y < 652; y += 1) for (let x = 66; x < 516; x += 1) {
    const offset = (y * width + x) * 4;
    if (pixels[offset] < 90 && pixels[offset + 1] < 90 && pixels[offset + 2] < 90) chapterTwoCrispEdges += 1;
  }
  assert.ok(chapterOneBlue > 1_000, 'the lower active brick remains visible through its completed top context');
  assert.ok(chapterTwoCrispEdges > 100, 'active white geometry retains a crisp dark outline');

  for (let y = 682; y < 1024; y += 1) for (let x = 0; x < 1024; x += 1) {
    const offset = (y * width + x) * 4;
    assert.deepEqual([...pixels.subarray(offset, offset + 4)], [248, 247, 243, 255]);
  }
});

test('chapter sheets render directly at 512 and 768 while the default stays exactly 1024', () => {
  const input = semanticInputWithSteps([
    [{ id: 'lower-blue', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'blue' }],
    [{ id: 'upper-white', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'white' }],
  ]);
  const annotation = semanticAnnotation(input, [[1, 1], [2, 2]]);
  const defaultSheets = renderSemanticGuideChapters(input, annotation);
  const explicitDefault = renderSemanticGuideChapters(input, annotation, { size: 1024 });
  const compact = renderSemanticGuideChapters(input, annotation, { size: 512 });
  const medium = renderSemanticGuideChapters(input, annotation, { size: 768 });

  assert.deepEqual(defaultSheets, explicitDefault);
  assert.deepEqual(compact.map(({ width, height }) => [width, height]), [[512, 512]]);
  assert.deepEqual(medium.map(({ width, height }) => [width, height]), [[768, 768]]);
  assert.deepEqual(validateNamingImages(compact).map(({ width, height }) => [width, height]), [[512, 512]]);
  assert.deepEqual(validateNamingImages(medium).map(({ width, height }) => [width, height]), [[768, 768]]);
  const decoded = decodePng(compact[0].png);
  let activeBlue = 0;
  for (let y = 13; y < 156; y += 1) for (let x = 33; x < 258; x += 1) {
    const offset = (y * decoded.width + x) * 4;
    if (decoded.pixels[offset + 2] > 110 && decoded.pixels[offset] < 100 && decoded.pixels[offset + 1] < 160) activeBlue += 1;
  }
  assert.ok(activeBlue > 250, 'direct 512 rendering keeps the active chapter color legible');
  assert.throws(() => renderSemanticGuideChapters(input, annotation, { size: 640 }), /size must be 512, 768, or 1024/);
});

test('chapter sheets are bounded to four and mark every row with its chapter index', () => {
  const steps = Array.from({ length: 12 }, (_, index) => [
    { id: `brick-${index + 1}`, x: index, y: 0, z: 0, w: 1, d: 1, color: index % 2 ? 'red' : 'blue' },
  ]);
  const input = semanticInputWithSteps(steps);
  const annotation = semanticAnnotation(input, steps.map((_, index) => [index + 1, index + 1]));
  const sheets = renderSemanticGuideChapters(input, annotation);

  assert.equal(sheets.length, 4);
  assert.deepEqual(validateNamingImages(sheets).map(({ width, height }) => [width, height]), Array(4).fill([1024, 1024]));
  assert.match(sheets[0].view, /rows 1, 2, 3 top-bottom/);
  assert.match(sheets[3].view, /rows 10, 11, 12 top-bottom/);
  assert.ok(sheets.every(({ view }) => view.length <= 200));
  const last = decodePng(sheets[3].png);
  for (const rowTop of [0, 341, 682]) {
    let badgePixels = 0;
    for (let y = rowTop + 26; y < rowTop + 58; y += 1) for (let x = 14; x < 56; x += 1) {
      const offset = (y * last.width + x) * 4;
      if (last.pixels[offset] < 100) badgePixels += 1;
    }
    assert.ok(badgePixels > 500);
  }
});

test('chapter renderer rejects stale annotations and more than twelve sections before rendering', () => {
  const steps = Array.from({ length: 13 }, (_, index) => [
    { id: `brick-${index + 1}`, x: index, y: 0, z: 0, w: 1, d: 1, color: 'red' },
  ]);
  const input = semanticInputWithSteps(steps);
  const annotation = semanticAnnotation(input, steps.map((_, index) => [index + 1, index + 1]));
  assert.throws(() => renderSemanticGuideChapters(input, annotation), /requires 1-12 annotation sections/);
  assert.throws(() => renderSemanticGuideChapters(input, { ...annotation, fingerprint: '0'.repeat(64) }), /fingerprint is stale/);
});

test('reference sheets keep row 0 fixed while isolated chapter assignments change', () => {
  const input = semanticInputWithSteps([
    [{ id: 'blue-base', x: 0, y: 0, z: 0, w: 2, d: 2, color: 'blue' }],
    [{ id: 'red-front', x: 2, y: 0, z: 0, w: 1, d: 2, color: 'red' }],
    [{ id: 'white-top', x: 0, y: 1, z: 0, w: 2, d: 2, color: 'white' }],
    [{ id: 'red-rear', x: 0, y: 0, z: 2, w: 2, d: 1, color: 'red' }],
  ]);
  const first = renderSemanticGuideReferenceChapters(input, semanticAnnotation(input, [[1, 1], [2, 2], [3, 4]]));
  const second = renderSemanticGuideReferenceChapters(input, semanticAnnotation(input, [[1, 2], [3, 3], [4, 4]]));
  assert.equal(first.length, 1);
  assert.equal(first[0].view,
    'reference chapter sheet 1/1; row 0 = opaque full-color complete object; isolated addition rows 1, 2, 3 top-bottom; same whole-object frame; left camera +x/-z iso, right camera -x/+z iso, +y up');
  assert.equal(validateNamingImages(first)[0].view, first[0].view);
  const firstPixels = decodePng(first[0].png).pixels;
  const secondPixels = decodePng(second[0].png).pixels;
  assert.deepEqual(firstPixels.subarray(0, 1024 * 256 * 4), secondPixels.subarray(0, 1024 * 256 * 4));
  assert.notDeepEqual(firstPixels.subarray(1024 * 256 * 4), secondPixels.subarray(1024 * 256 * 4));
});

test('reference chapter rows contain only exact full-color additions in the whole-object frame', () => {
  const input = semanticInputWithSteps([
    [{ id: 'rear-blue', x: 0, y: 0, z: 3, w: 2, d: 1, color: 'blue' }],
    [{ id: 'front-red', x: 0, y: 0, z: 0, w: 2, d: 1, color: 'red' }],
  ]);
  const [sheet] = renderSemanticGuideReferenceChapters(input, semanticAnnotation(input, [[1, 1], [2, 2]]));
  const decoded = decodePng(sheet.png);
  let bluePixels = 0;
  let redPixels = 0;
  let paleContextPixels = 0;
  for (let y = 256; y < 512; y += 1) for (let x = 66; x < 516; x += 1) {
    const offset = (y * decoded.width + x) * 4;
    const pixel = decoded.pixels.subarray(offset, offset + 4);
    if (pixel[2] > 100 && pixel[0] < 120) bluePixels += 1;
    if (pixel[0] > 100 && pixel[0] > pixel[2] * 1.5) redPixels += 1;
    if (Math.abs(pixel[0] - pixel[1]) < 8 && Math.abs(pixel[1] - pixel[2]) < 12
      && pixel[0] >= 150 && pixel[0] <= 235) paleContextPixels += 1;
  }
  assert.ok(bluePixels > 500, 'the isolated rear addition remains visible without front context');
  assert.equal(redPixels, 0, 'the inactive front brick is absent rather than drawn beneath the addition');
  assert.equal(paleContextPixels, 0, 'the isolated row contains no pale whole-object context');
});

test('reference chapter evidence is four sheets at most with byte-identical default 1024 and compact 512 support', () => {
  const steps = Array.from({ length: 12 }, (_, index) => [
    { id: `reference-brick-${index + 1}`, x: index, y: 0, z: 0, w: 1, d: 1, color: 'red' },
  ]);
  const input = semanticInputWithSteps(steps);
  const annotation = semanticAnnotation(input, steps.map((_, index) => [index + 1, index + 1]));
  const sheets = renderSemanticGuideReferenceChapters(input, annotation);
  const explicitDefault = renderSemanticGuideReferenceChapters(input, annotation, { size: 1024 });
  const compact = renderSemanticGuideReferenceChapters(input, annotation, { size: 512 });
  assert.equal(sheets.length, 4);
  assert.deepEqual(sheets, explicitDefault);
  assert.deepEqual(sheets.map(({ width, height }) => [width, height]), Array(4).fill([1024, 1024]));
  assert.deepEqual(compact.map(({ width, height }) => [width, height]), Array(4).fill([512, 512]));
  assert.deepEqual(validateNamingImages(compact).map(({ width, height }) => [width, height]), Array(4).fill([512, 512]));
  assert.match(sheets[3].view, /isolated addition rows 10, 11, 12/);
  assert.throws(() => renderSemanticGuideReferenceChapters(input, annotation, { size: 768 }), /size must be 512 or 1024/);
});
