import { PALETTE } from './geometry.js';
import {getBrickFaceColor, getBrickOutlineColor} from './black-piece-ink.js';
import {DEFAULT_STUD_APPEARANCE} from './stud-appearance.js';

export const escapeMarkup = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// An isolated upright brick, drawn at the same 8:9.6 proportions as the model.
export function partIllustration({ w, d, color }) {
  const project = (x, y, z) => [(x-z)*8.66, (x+z)*5-y*12];
  const face = points => points.map(p => project(...p).join(',')).join(' ');
  const hex = `#${getBrickFaceColor(PALETTE[color] ?? '#ff3b80').getHexString()}`;
  const ink = `#${getBrickOutlineColor(color).toString(16).padStart(6,'0')}`;
  const top = face([[0,1,0],[w,1,0],[w,1,d],[0,1,d]]);
  const left = face([[0,1,d],[w,1,d],[w,0,d],[0,0,d]]);
  const right = face([[w,1,0],[w,1,d],[w,0,d],[w,0,0]]);
  let studs = '';
  const radius = 4.9 * DEFAULT_STUD_APPEARANCE.diameter / 2 / 8 * Math.SQRT2 * 8.66;
  const rise = 1.8 * DEFAULT_STUD_APPEARANCE.height * 1.25;
  for (let z=0; z<d; z++) for (let x=0; x<w; x++) {
    const [cx,cy] = project(x+.5,1,z+.5);
    studs += `<path d="M${cx-radius} ${cy-rise}v${rise}a${radius} ${radius/2} 0 0 0 ${radius*2} 0v-${rise}"/><ellipse cx="${cx}" cy="${cy-rise}" rx="${radius}" ry="${radius/2}"/>`;
  }
  return `<svg viewBox="${-d*8.66-4} -18 ${(w+d)*8.66+8} ${(w+d)*5+21}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeMarkup(`${color} ${w} by ${d} brick`)}"><g fill="${hex}" stroke="${ink}" stroke-width=".65" stroke-linejoin="round"><polygon points="${left}"/><polygon points="${right}"/><polygon points="${right}" fill="#000" fill-opacity=".1"/><polygon points="${top}"/>${studs}</g></svg>`;
}

export function tallyParts(bricks) {
  const rows = new Map();
  for (const b of bricks) {
    const w = Math.min(b.w,b.d), d = Math.max(b.w,b.d), key = `${w}x${d}:${b.color}`;
    if (!rows.has(key)) rows.set(key,{ key,w,d,color:b.color,count:0 });
    rows.get(key).count++;
  }
  return [...rows.values()].sort((a,b)=>a.color.localeCompare(b.color)||b.w*b.d-a.w*a.d||b.w-a.w);
}

export function inventoryMarkup(items) {
  return items.map(p => `<li class="manual-part"><div class="manual-part-picture">${partIllustration(p)}</div><span class="manual-part-label"><b>×${p.count}</b> <span>${p.w}×${p.d}</span></span><span class="sr-only">${escapeMarkup(p.color)}</span></li>`).join('');
}

export function stepInventoryMarkup(items) {
  if (!items?.length) return '';
  return `<div class="manual-step-parts"><ul aria-label="Pieces for this step">${items.map(p => `<li><div class="manual-step-part-picture">${partIllustration(p)}</div><span><b>×${p.count}</b></span></li>`).join('')}</ul></div>`;
}
