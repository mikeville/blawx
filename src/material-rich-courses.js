import {placementFootprint,spatialRegions} from './placement-groups.js';

// A small, contiguous course may use more colors without becoming a large
// sorting task. This supplements, rather than replaces, physical and view checks.
export function readableMaterialRichCourse(bricks){
  if(!bricks.length||bricks.length>24||new Set(bricks.map(b=>b.y)).size!==1)return false;
  const shape=placementFootprint(bricks);
  return shape.width<=24&&shape.depth<=24&&shape.fill>=.6
    &&spatialRegions(bricks).length===1
    &&new Set(bricks.map(b=>b.color)).size<=6
    &&new Set(bricks.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`)).size<=8;
}
