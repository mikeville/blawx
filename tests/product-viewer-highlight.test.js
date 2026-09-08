import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import {
  chooseUpwardInsertionAzimuth,
  getInstructionActiveMaterialAppearance,
  getInstructionContextColor,
  getInstructionHighlightAppearance,
  getInstructionHighlightStyle,
} from '../src/product-viewer.js';

const chroma = color => Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);

test('instruction active material keeps source hue dominant from either viewing direction', () => {
  const sourceOrange = new THREE.Color(0xf58220);
  const appearance = getInstructionActiveMaterialAppearance(sourceOrange);

  assert.equal(appearance.emissiveIntensity, 0.85);
  assert.equal(appearance.opacity, 1);
  assert.equal(appearance.transparent, false);
  assert.equal(appearance.depthWrite, true);
  assert.equal(appearance.emissive.getHex(), sourceOrange.getHex(), 'the flat light contribution uses the actual part color');
  assert.ok(Math.abs(appearance.color.r - sourceOrange.r * 0.15) < 1e-12);
  assert.ok(Math.abs(appearance.color.g - sourceOrange.g * 0.15) < 1e-12);
  assert.ok(Math.abs(appearance.color.b - sourceOrange.b * 0.15) < 1e-12);
  assert.ok(appearance.emissive.r > appearance.emissive.g && appearance.emissive.g > appearance.emissive.b,
    'orange channel order remains recognizable');
  assert.equal(sourceOrange.getHex(), 0xf58220, 'the material transform does not mutate its source color');
});

test('accepted pastel context keeps exact opaque print parameters and source landmarks', () => {
  const appearance = getInstructionHighlightAppearance();
  assert.equal(appearance.contextSaturation, 0.85);
  assert.equal(appearance.contextPaperBlend, 0.62);
  assert.equal(appearance.contextPaperColor, 0xf4f4f4);
  assert.equal(appearance.contextOpacity, 1);
  assert.equal(appearance.contextDepthWrite, true);
  assert.equal(appearance.contextTransparent, false);
  assert.equal(appearance.contextEdgeOpacity, 1);
  assert.equal(appearance.contextEdgeDepthWrite, true);
  assert.equal(appearance.contextEdgeTransparent, false);
  assert.equal(appearance.activeEdge, 0x171612);

  const sourceRed = new THREE.Color(0xc82a20);
  const sourceBlue = new THREE.Color(0x1769aa);
  const white = getInstructionContextColor(0xf4f4f4);
  const black = getInstructionContextColor(0x111111);
  const red = getInstructionContextColor(sourceRed);
  const blue = getInstructionContextColor(sourceBlue);
  assert.ok(red.r > red.b, 'red remains a red landmark');
  assert.ok(blue.b > blue.r, 'blue remains a blue landmark');
  assert.notDeepEqual(red.toArray(), blue.toArray());
  assert.ok(chroma(white) < 0.001, 'white remains neutral');
  assert.ok(white.getHSL({}).l - black.getHSL({}).l > 0.08, 'black remains distinct from white');
  assert.equal(sourceRed.getHex(), 0xc82a20, 'the transform does not mutate its source color');
});

test('old and unknown style arguments cannot override accepted pastel color', () => {
  const acceptedAppearance = getInstructionHighlightAppearance();
  const acceptedRed = getInstructionContextColor(0xc82a20);
  for (const obsolete of ['ghost', 'outline', 'color-outline', 'printed-balanced', 'tinted-paper', 'muted-color', 'unknown']) {
    assert.equal(getInstructionHighlightStyle(obsolete), 'pastel-color');
    assert.strictEqual(getInstructionHighlightAppearance(obsolete), acceptedAppearance);
    assert.deepEqual(getInstructionContextColor(0xc82a20, obsolete).toArray(), acceptedRed.toArray());
  }
});

test('upward insertion view chooses the exposed side of a hidden new piece', () => {
  const addition = { id: 'new', x: 0, y: 0, z: 0, w: 1, h: 1, d: 1 };
  const highlight = new Set(['new']);
  const cases = [
    { blocker: { id: 'old', x: 1, y: 0, z: 0, w: 1, h: 1, d: 1 }, exposed: azimuth => Math.sin(azimuth) < 0 },
    { blocker: { id: 'old', x: -1, y: 0, z: 0, w: 1, h: 1, d: 1 }, exposed: azimuth => Math.sin(azimuth) > 0 },
    { blocker: { id: 'old', x: 0, y: 0, z: 1, w: 1, h: 1, d: 1 }, exposed: azimuth => Math.cos(azimuth) < 0 },
    { blocker: { id: 'old', x: 0, y: 0, z: -1, w: 1, h: 1, d: 1 }, exposed: azimuth => Math.cos(azimuth) > 0 },
  ];
  for (const { blocker, exposed } of cases) {
    const azimuth = chooseUpwardInsertionAzimuth([addition, blocker], highlight);
    assert.ok(exposed(azimuth), `camera avoids blocker at (${blocker.x}, ${blocker.z})`);
  }
});
