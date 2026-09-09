import * as THREE from 'three';
import { PALETTE } from './geometry.js';

export const DARK_BRICK_OUTLINE_COLOR = 0x171612;
export const BLACK_PIECE_OUTLINE_COLORS = Object.freeze({
  dark: DARK_BRICK_OUTLINE_COLOR,
  soft: 0xbcbab2,
  white: 0xf4f4f4,
});
export const DEFAULT_BLACK_PIECE_OUTLINE = 'soft';
export const SOURCE_NEAR_BLACK_LUMINANCE_THRESHOLD = 0.02;

export function getSourceColorLuminance(source) {
  const tone = source instanceof THREE.Color ? source : new THREE.Color(source);
  return tone.r * 0.2126 + tone.g * 0.7152 + tone.b * 0.0722;
}

export function isNearBlackSourceColor(color) {
  const source = PALETTE[color] ?? color;
  if (source === undefined || source === null) return false;
  return getSourceColorLuminance(source) < SOURCE_NEAR_BLACK_LUMINANCE_THRESHOLD;
}

export function groupBrickOutlinesBySourceColor(
  { bodies, studs },
  blackPieceOutline = DEFAULT_BLACK_PIECE_OUTLINE,
) {
  const mode = Object.hasOwn(BLACK_PIECE_OUTLINE_COLORS, blackPieceOutline)
    ? blackPieceOutline
    : DEFAULT_BLACK_PIECE_OUTLINE;
  if (mode === 'dark') {
    return [{
      kind: 'normal',
      color: DARK_BRICK_OUTLINE_COLOR,
      sidewallColor: DARK_BRICK_OUTLINE_COLOR,
      bodies,
      studs,
    }];
  }

  const normal = {
    kind: 'normal',
    color: DARK_BRICK_OUTLINE_COLOR,
    sidewallColor: DARK_BRICK_OUTLINE_COLOR,
    bodies: bodies.filter(body => !isNearBlackSourceColor(body.color)),
    studs: studs.filter(stud => !isNearBlackSourceColor(stud.color)),
  };
  const light = {
    kind: 'light',
    color: BLACK_PIECE_OUTLINE_COLORS[mode],
    sidewallColor: DARK_BRICK_OUTLINE_COLOR,
    bodies: bodies.filter(body => isNearBlackSourceColor(body.color)),
    studs: studs.filter(stud => isNearBlackSourceColor(stud.color)),
  };
  return [normal, light].filter(group => group.bodies.length || group.studs.length);
}
