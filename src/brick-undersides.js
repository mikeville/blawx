// Render-only shells. Canonical brick occupancy and collision bounds stay solid.
// These are simplified rectangular-brick interiors, not mold-specific CAD parts.
// Standard rectangular-brick proportions: 8mm stud pitch; tubes sit midway
// between four studs, solid pins midway between adjacent studs in a single row.
export const BRICK_UNDERSIDE_MM = Object.freeze({wall:1.6, tubeOuterRadius:3.2, tubeInnerRadius:2.4, pinRadius:1.6});

export function brickUndersideParts(bodies, voxelMm = 8) {
  const walls = [], tubes = [], pins = [], outlines = [], recesses = [];
  const pitch = 8 / voxelMm, wall = BRICK_UNDERSIDE_MM.wall / voxelMm;
  for (const body of bodies) {
    const {x,y,z,w,h,d,color,id} = body;
    const bottom = y-h/2, roof = y+h/2-wall;
    const box = (x,y,z,w,h,d) => walls.push({x,y,z,w,h,d,color,id});
    box(x,y+h/2-wall/2,z,w,wall,d);
    recesses.push({x,y:roof-.001,z,w:w-2*wall,h:1,d:d-2*wall,color,id});
    box(x-w/2+wall/2,(bottom+roof)/2,z,wall,h-wall,d);
    box(x+w/2-wall/2,(bottom+roof)/2,z,wall,h-wall,d);
    box(x,(bottom+roof)/2,z-d/2+wall/2,w-2*wall,h-wall,wall);
    box(x,(bottom+roof)/2,z+d/2-wall/2,w-2*wall,h-wall,wall);
    const segments = [];
    const line = (a,b) => segments.push(...a,...b);
    const ring = (cx,cz,r) => {
      for(let i=0;i<32;i++) {
        const a=i*Math.PI/16,b=(i+1)*Math.PI/16;
        line([cx+Math.cos(a)*r,bottom,cz+Math.sin(a)*r],[cx+Math.cos(b)*r,bottom,cz+Math.sin(b)*r]);
      }
    };
    const corners = [[x-w/2+wall,z-d/2+wall],[x+w/2-wall,z-d/2+wall],
      [x+w/2-wall,z+d/2-wall],[x-w/2+wall,z+d/2-wall]];
    for (let i=0;i<4;i++) {
      const [cx,cz]=corners[i], [nx,nz]=corners[(i+1)%4];
      line([cx,bottom,cz],[nx,bottom,nz]);
      // Actual inner wall depth, occluded naturally by nearer walls and tubes.
      line([cx,bottom,cz],[cx,roof,cz]);
      line([cx,roof,cz],[nx,roof,nz]);
    }
    const cols = Math.round(w/pitch), rows = Math.round(d/pitch);
    const item = (cx,cz) => ({x:cx,y:(bottom+roof)/2,z:cz,w:1,h:h-wall,d:1,color,id});
    if (cols>1 && rows>1) {
      for(let ix=1;ix<cols;ix++)for(let iz=1;iz<rows;iz++) {
        const cx=x+(ix-cols/2)*pitch,cz=z+(iz-rows/2)*pitch;
        tubes.push(item(cx,cz));ring(cx,cz,BRICK_UNDERSIDE_MM.tubeOuterRadius/voxelMm);ring(cx,cz,BRICK_UNDERSIDE_MM.tubeInnerRadius/voxelMm);
      }
    } else {
      for(let i=1;i<Math.max(cols,rows);i++) {
        const cx=x+(cols>1?i-cols/2:0)*pitch,cz=z+(rows>1?i-rows/2:0)*pitch;
        pins.push(item(cx,cz));ring(cx,cz,BRICK_UNDERSIDE_MM.pinRadius/voxelMm);
      }
    }
    outlines.push({id,color,positions:segments});
  }
  return {walls,tubes,pins,outlines,recesses};
}
