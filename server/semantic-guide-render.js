import { deflateSync } from 'node:zlib';
import { PALETTE } from '../src/geometry.js';
import { validateSemanticGuideAnnotation, validateSemanticGuideInput } from '../src/semantic-guide.js';

const WIDTH = 768;
const HEIGHT = 768;
const MARGIN = 54;
const DEFAULT_SHEET_SIZE = 1024;
const SUPPORTED_SHEET_SIZES = new Set([512, 768, 1024]);
const CHAPTERS_PER_SHEET = 3;
const MAX_CHAPTERS = 12;
const BRICK_HEIGHT = 1.2;
const MAX_RASTER_SAMPLES_PER_VIEW = 80_000_000;
const MAX_RASTER_SAMPLES_PER_CHAPTER_RENDER = 160_000_000;
const BACKGROUND = [248, 247, 243, 255];
const EDGE = [48, 48, 44, 255];
const CONTEXT_EDGE = [188, 187, 181, 255];
const CONTEXT_COLOR = [220, 219, 214];
const ACTIVE_HIGHLIGHT_PINK = [230, 40, 130];

const VIEWS = Object.freeze([
  {
    view: 'front-right isometric; camera is above toward +x and -z; screen up follows +y',
    camera: [1, 0.78, -1],
  },
  {
    view: 'rear-left isometric; camera is above toward -x and +z; screen up follows +y',
    camera: [-1, 0.78, 1],
  },
  {
    view: 'front orthographic; camera looks from -z toward +z; screen right is +x and screen up is +y',
    camera: [0, 0, -1],
  },
  {
    view: 'right-side orthographic; camera looks from +x toward -x; screen right is +z and screen up is +y',
    camera: [1, 0, 0],
  },
]);

const CHAPTER_VIEWS = Object.freeze(VIEWS.slice(0, 2));

const DIGITS = Object.freeze({
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '010', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
});

function normalize(vector) {
  const length = Math.hypot(...vector);
  return vector.map((value) => value / length);
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function parseHex(value) {
  const expanded = value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
  return [
    Number.parseInt(expanded.slice(1, 3), 16),
    Number.parseInt(expanded.slice(3, 5), 16),
    Number.parseInt(expanded.slice(5, 7), 16),
  ];
}

function brickColor(value) {
  const hex = PALETTE[value] ?? value;
  if (!/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/iu.test(hex)) {
    throw new RangeError(`Semantic guide brick color ${JSON.stringify(value)} must be a palette name, #rgb, or #rrggbb.`);
  }
  return parseHex(hex);
}

function shade(color, normal) {
  const light = normalize([-0.55, 1, -0.72]);
  const diffuse = Math.max(0, dot(normal, light));
  const factor = 0.76 + diffuse * 0.28;
  return [...color.map((channel) => Math.max(0, Math.min(255, Math.round(channel * factor + 7)))), 255];
}

function cuboidFaces([, x, y, z, width, depth, color]) {
  const y0 = y * BRICK_HEIGHT;
  const y1 = (y + 1) * BRICK_HEIGHT;
  const x1 = x + width;
  const z1 = z + depth;
  return [
    { normal: [1, 0, 0], points: [[x1, y0, z], [x1, y0, z1], [x1, y1, z1], [x1, y1, z]] },
    { normal: [-1, 0, 0], points: [[x, y0, z1], [x, y0, z], [x, y1, z], [x, y1, z1]] },
    { normal: [0, 1, 0], points: [[x, y1, z], [x1, y1, z], [x1, y1, z1], [x, y1, z1]] },
    { normal: [0, -1, 0], points: [[x, y0, z1], [x1, y0, z1], [x1, y0, z], [x, y0, z]] },
    { normal: [0, 0, 1], points: [[x1, y0, z1], [x, y0, z1], [x, y1, z1], [x1, y1, z1]] },
    { normal: [0, 0, -1], points: [[x, y0, z], [x1, y0, z], [x1, y1, z], [x, y1, z]] },
  ].map((face) => ({ ...face, color: brickColor(color) }));
}

function projectionFor(bricks, camera, width, height, margin) {
  const towardCamera = normalize(camera);
  const right = normalize(cross(towardCamera, [0, 1, 0]));
  const up = normalize(cross(right, towardCamera));
  const projectWorld = (point) => ({ u: dot(point, right), v: dot(point, up), depth: dot(point, towardCamera) });
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (const brick of bricks) for (const face of cuboidFaces(brick)) for (const point of face.points) {
    const { u, v } = projectWorld(point);
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
  }
  const spanU = Math.max(1e-9, maxU - minU);
  const spanV = Math.max(1e-9, maxV - minV);
  const scale = Math.min((width - margin * 2) / spanU, (height - margin * 2) / spanV);
  const centerU = (minU + maxU) / 2;
  const centerV = (minV + maxV) / 2;
  const project = (point) => {
    const value = projectWorld(point);
    return {
      x: width / 2 + (value.u - centerU) * scale,
      y: height / 2 - (value.v - centerV) * scale,
      depth: value.depth,
    };
  };
  return { towardCamera, project };
}

function pixelOffset(x, y, width) {
  return (y * width + x) * 4;
}

function setPixel(pixels, offset, color) {
  pixels[offset] = color[0];
  pixels[offset + 1] = color[1];
  pixels[offset + 2] = color[2];
  pixels[offset + 3] = color[3];
}

function edgeFunction(a, b, x, y) {
  return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
}

function rasterTriangle(points, color, pixels, depths, width, height, work) {
  const [a, b, c] = points;
  const area = edgeFunction(a, b, c.x, c.y);
  if (Math.abs(area) < 1e-9) return;
  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)));
  work.samples += Math.max(0, maxX - minX + 1) * Math.max(0, maxY - minY + 1);
  if (work.samples > work.limit) {
    throw new RangeError(`Semantic guide render exceeds the ${work.limit}-sample raster limit.`);
  }
  const sign = area < 0 ? -1 : 1;
  const inverseArea = 1 / Math.abs(area);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const px = x + 0.5;
      const py = y + 0.5;
      const w0 = edgeFunction(b, c, px, py) * sign;
      const w1 = edgeFunction(c, a, px, py) * sign;
      const w2 = edgeFunction(a, b, px, py) * sign;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const depth = (w0 * a.depth + w1 * b.depth + w2 * c.depth) * inverseArea;
      const index = y * width + x;
      if (depth <= depths[index]) continue;
      depths[index] = depth;
      setPixel(pixels, index * 4, color);
    }
  }
}

function drawDepthLine(a, b, pixels, depths, width, height, color) {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y))));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if (x < 0 || x >= width || y < 0 || y >= height) continue;
    const depth = a.depth + (b.depth - a.depth) * t;
    const index = y * width + x;
    if (depth + 1e-6 < depths[index]) continue;
    setPixel(pixels, pixelOffset(x, y, width), color);
  }
}

function drawBricks({ bricks, fitBricks = bricks, descriptor, pixels, width, height, margin, depths, work, colorForFace, edgeColor }) {
  const { towardCamera, project } = projectionFor(fitBricks, descriptor.camera, width, height, margin);
  const visibleFaces = [];
  for (const brick of bricks) {
    for (const face of cuboidFaces(brick)) {
      if (dot(face.normal, towardCamera) <= 1e-9) continue;
      const points = face.points.map(project);
      const color = colorForFace(face);
      rasterTriangle([points[0], points[1], points[2]], color, pixels, depths, width, height, work);
      rasterTriangle([points[0], points[2], points[3]], color, pixels, depths, width, height, work);
      visibleFaces.push(points);
    }
  }
  for (const points of visibleFaces) {
    for (let index = 0; index < points.length; index += 1) {
      drawDepthLine(points[index], points[(index + 1) % points.length], pixels, depths, width, height, edgeColor);
    }
  }
}

function renderViewPixels(bricks, descriptor, {
  width = WIDTH,
  height = HEIGHT,
  margin = MARGIN,
  fitBricks = bricks,
  activeBrickIds = null,
  activeColor = null,
  work = { samples: 0, limit: MAX_RASTER_SAMPLES_PER_VIEW },
} = {}) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) setPixel(pixels, offset, BACKGROUND);
  const depths = new Float64Array(width * height);
  depths.fill(-Infinity);
  drawBricks({
    bricks,
    fitBricks,
    descriptor,
    pixels,
    width,
    height,
    margin,
    depths,
    work,
    colorForFace: activeBrickIds
      ? (face) => shade(CONTEXT_COLOR, face.normal)
      : (face) => shade(face.color, face.normal),
    edgeColor: activeBrickIds ? CONTEXT_EDGE : EDGE,
  });

  if (activeBrickIds) {
    const activeBricks = bricks.filter(([brickId]) => activeBrickIds.has(brickId));
    const activeDepths = new Float64Array(width * height);
    activeDepths.fill(-Infinity);
    drawBricks({
      bricks: activeBricks,
      fitBricks: bricks,
      descriptor,
      pixels,
      width,
      height,
      margin,
      depths: activeDepths,
      work,
      colorForFace: (face) => shade(activeColor ?? face.color, face.normal),
      edgeColor: EDGE,
    });
  }
  return pixels;
}

function renderView(bricks, descriptor) {
  return encodePng(renderViewPixels(bricks, descriptor), WIDTH, HEIGHT);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const value of buffer) crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function encodePng(pixels, width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const target = y * (width * 4 + 1);
    scanlines[target] = 0;
    pixels.copy(scanlines, target + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function fillPixels(pixels, color) {
  for (let offset = 0; offset < pixels.length; offset += 4) setPixel(pixels, offset, color);
}

function fillRect(pixels, canvasWidth, x, y, width, height, color) {
  for (let row = y; row < y + height; row += 1) {
    for (let column = x; column < x + width; column += 1) {
      setPixel(pixels, pixelOffset(column, row, canvasWidth), color);
    }
  }
}

function scaleSheetValue(value, sheetSize) {
  return Math.round(value * sheetSize / DEFAULT_SHEET_SIZE);
}

function drawChapterIndex(pixels, sheetSize, chapterIndex, rowTop) {
  const badgeX = scaleSheetValue(14, sheetSize);
  const badgeY = rowTop + scaleSheetValue(26, sheetSize);
  const badgeWidth = scaleSheetValue(42, sheetSize);
  const badgeHeight = scaleSheetValue(32, sheetSize);
  const scale = scaleSheetValue(4, sheetSize);
  const gap = scaleSheetValue(3, sheetSize);
  const glyphs = String(chapterIndex).split('').map((digit) => DIGITS[digit]);
  const textWidth = glyphs.length * 3 * scale + (glyphs.length - 1) * gap;
  fillRect(pixels, sheetSize, badgeX, badgeY, badgeWidth, badgeHeight, EDGE);
  let cursorX = badgeX + Math.floor((badgeWidth - textWidth) / 2);
  const cursorY = badgeY + Math.floor((badgeHeight - 5 * scale) / 2);
  for (const glyph of glyphs) {
    for (let row = 0; row < glyph.length; row += 1) {
      for (let column = 0; column < glyph[row].length; column += 1) {
        if (glyph[row][column] === '1') {
          fillRect(pixels, sheetSize, cursorX + column * scale, cursorY + row * scale, scale, scale, BACKGROUND);
        }
      }
    }
    cursorX += 3 * scale + gap;
  }
}

function blit(target, targetWidth, source, sourceWidth, sourceHeight, targetX, targetY) {
  for (let row = 0; row < sourceHeight; row += 1) {
    const sourceStart = row * sourceWidth * 4;
    const targetStart = ((targetY + row) * targetWidth + targetX) * 4;
    source.copy(target, targetStart, sourceStart, sourceStart + sourceWidth * 4);
  }
}

function chapterBrickIds(input, section, stepIndexById) {
  const start = stepIndexById.get(section.startStepId);
  const end = stepIndexById.get(section.endStepId);
  const result = new Set();
  for (let index = start; index <= end; index += 1) {
    for (const brickId of input.steps[index].newBrickIds) result.add(brickId);
  }
  return result;
}

function chapterSheetDescriptor(sheetNumber, totalSheets, chapterIndexes) {
  const rows = Array.from({ length: CHAPTERS_PER_SHEET }, (_, index) => chapterIndexes[index]
    ? `${chapterIndexes[index]}`
    : 'blank').join(', ');
  return `chapter sheet ${sheetNumber}/${totalSheets}; rows ${rows} top-bottom; `
    + 'left camera +x/-z iso, right camera -x/+z iso, +y up; pale whole-object context; '
    + 'original-color parts = exact chapter additions shown through context';
}

function highlightedChapterSheetDescriptor(sheetNumber, totalSheets, chapterIndexes) {
  const rows = Array.from({ length: CHAPTERS_PER_SHEET }, (_, index) => chapterIndexes[index]
    ? `${chapterIndexes[index]}`
    : 'blank').join(', ');
  return `highlighted chapter sheet ${sheetNumber}/${totalSheets}; rows ${rows} top-bottom; `
    + 'left camera +x/-z iso, right camera -x/+z iso, +y up; gray complete-object context; '
    + 'uniform pink = every meaningful part added in the numbered range, not the real brick color';
}

function referenceChapterSheetDescriptor(sheetNumber, totalSheets, chapterIndexes) {
  const rows = Array.from({ length: CHAPTERS_PER_SHEET }, (_, index) => chapterIndexes[index]
    ? `${chapterIndexes[index]}`
    : 'blank').join(', ');
  return `reference chapter sheet ${sheetNumber}/${totalSheets}; row 0 = opaque full-color complete object; `
    + `isolated addition rows ${rows} top-bottom; same whole-object frame; `
    + 'left camera +x/-z iso, right camera -x/+z iso, +y up';
}

function renderChapterSheets(rawInput, rawAnnotation, {
  size,
  activeColor = null,
  describeSheet = chapterSheetDescriptor,
} = {}) {
  const input = validateSemanticGuideInput(rawInput);
  const annotation = validateSemanticGuideAnnotation(input, rawAnnotation);
  if (annotation.sections.length > MAX_CHAPTERS) {
    throw new RangeError(`Chapter evidence requires 1-${MAX_CHAPTERS} annotation sections.`);
  }
  if (!SUPPORTED_SHEET_SIZES.has(size)) {
    throw new RangeError('Chapter evidence sheet size must be 512, 768, or 1024.');
  }

  const stepIndexById = new Map(input.steps.map((step, index) => [step.id, index]));
  const sheetCount = Math.ceil(annotation.sections.length / CHAPTERS_PER_SHEET);
  const panelWidth = scaleSheetValue(450, size);
  const panelHeight = scaleSheetValue(286, size);
  const leftPanelX = scaleSheetValue(66, size);
  const rightPanelX = scaleSheetValue(548, size);
  const rowHeight = Math.floor(size / CHAPTERS_PER_SHEET);
  const work = { samples: 0, limit: MAX_RASTER_SAMPLES_PER_CHAPTER_RENDER };
  const sheets = [];

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const pixels = Buffer.alloc(size * size * 4);
    fillPixels(pixels, BACKGROUND);
    const chapterIndexes = [];
    for (let row = 0; row < CHAPTERS_PER_SHEET; row += 1) {
      const sectionIndex = sheetIndex * CHAPTERS_PER_SHEET + row;
      const section = annotation.sections[sectionIndex];
      if (!section) continue;
      const chapterIndex = sectionIndex + 1;
      chapterIndexes.push(chapterIndex);
      const activeBrickIds = chapterBrickIds(input, section, stepIndexById);
      const rowTop = row * rowHeight;
      const panelY = rowTop + scaleSheetValue(25, size);
      drawChapterIndex(pixels, size, chapterIndex, rowTop);
      const panels = CHAPTER_VIEWS.map((descriptor) => renderViewPixels(input.bricks, descriptor, {
        width: panelWidth,
        height: panelHeight,
        margin: scaleSheetValue(14, size),
        activeBrickIds,
        activeColor,
        work,
      }));
      blit(pixels, size, panels[0], panelWidth, panelHeight, leftPanelX, panelY);
      blit(pixels, size, panels[1], panelWidth, panelHeight, rightPanelX, panelY);
    }
    sheets.push({
      png: encodePng(pixels, size, size),
      width: size,
      height: size,
      view: describeSheet(sheetIndex + 1, sheetCount, chapterIndexes),
    });
  }
  return sheets;
}

export function renderSemanticGuideChapters(rawInput, rawAnnotation, { size = DEFAULT_SHEET_SIZE } = {}) {
  return renderChapterSheets(rawInput, rawAnnotation, { size });
}

export function renderSemanticGuideHighlightedChapters(rawInput, rawAnnotation, { size = 512 } = {}) {
  return renderChapterSheets(rawInput, rawAnnotation, {
    size,
    activeColor: ACTIVE_HIGHLIGHT_PINK,
    describeSheet: highlightedChapterSheetDescriptor,
  });
}

export function renderSemanticGuideReferenceChapters(rawInput, rawAnnotation, { size = DEFAULT_SHEET_SIZE } = {}) {
  const input = validateSemanticGuideInput(rawInput);
  const annotation = validateSemanticGuideAnnotation(input, rawAnnotation);
  if (annotation.sections.length > MAX_CHAPTERS) {
    throw new RangeError(`Reference chapter evidence requires 1-${MAX_CHAPTERS} annotation sections.`);
  }
  if (![512, DEFAULT_SHEET_SIZE].includes(size)) {
    throw new RangeError('Reference chapter evidence sheet size must be 512 or 1024.');
  }

  const stepIndexById = new Map(input.steps.map((step, index) => [step.id, index]));
  const sheetCount = Math.ceil(annotation.sections.length / CHAPTERS_PER_SHEET);
  const panelWidth = scaleSheetValue(450, size);
  const panelHeight = scaleSheetValue(214, size);
  const leftPanelX = scaleSheetValue(66, size);
  const rightPanelX = scaleSheetValue(548, size);
  const rowHeight = Math.floor(size / 4);
  const panelInsetY = scaleSheetValue(21, size);
  const panelMargin = scaleSheetValue(14, size);
  const work = { samples: 0, limit: MAX_RASTER_SAMPLES_PER_CHAPTER_RENDER };
  const referencePanels = CHAPTER_VIEWS.map((descriptor) => renderViewPixels(input.bricks, descriptor, {
    width: panelWidth,
    height: panelHeight,
    margin: panelMargin,
    work,
  }));
  const sheets = [];

  for (let sheetIndex = 0; sheetIndex < sheetCount; sheetIndex += 1) {
    const pixels = Buffer.alloc(size * size * 4);
    fillPixels(pixels, BACKGROUND);
    drawChapterIndex(pixels, size, 0, 0);
    blit(pixels, size, referencePanels[0], panelWidth, panelHeight, leftPanelX, panelInsetY);
    blit(pixels, size, referencePanels[1], panelWidth, panelHeight, rightPanelX, panelInsetY);
    const chapterIndexes = [];

    for (let row = 0; row < CHAPTERS_PER_SHEET; row += 1) {
      const sectionIndex = sheetIndex * CHAPTERS_PER_SHEET + row;
      const section = annotation.sections[sectionIndex];
      if (!section) continue;
      const chapterIndex = sectionIndex + 1;
      chapterIndexes.push(chapterIndex);
      const activeBrickIds = chapterBrickIds(input, section, stepIndexById);
      const activeBricks = input.bricks.filter(([brickId]) => activeBrickIds.has(brickId));
      const rowTop = (row + 1) * rowHeight;
      drawChapterIndex(pixels, size, chapterIndex, rowTop);
      const panels = CHAPTER_VIEWS.map((descriptor) => renderViewPixels(activeBricks, descriptor, {
        width: panelWidth,
        height: panelHeight,
        margin: panelMargin,
        fitBricks: input.bricks,
        work,
      }));
      blit(pixels, size, panels[0], panelWidth, panelHeight, leftPanelX, rowTop + panelInsetY);
      blit(pixels, size, panels[1], panelWidth, panelHeight, rightPanelX, rowTop + panelInsetY);
    }
    sheets.push({
      png: encodePng(pixels, size, size),
      width: size,
      height: size,
      view: referenceChapterSheetDescriptor(sheetIndex + 1, sheetCount, chapterIndexes),
    });
  }
  return sheets;
}

export function renderSemanticGuideImages(rawInput) {
  const input = validateSemanticGuideInput(rawInput);
  return VIEWS.map((descriptor) => ({
    png: renderView(input.bricks, descriptor),
    width: WIDTH,
    height: HEIGHT,
    view: descriptor.view,
  }));
}
