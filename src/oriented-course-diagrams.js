import {workingViewBrick} from './recipe-working-frame.js';
import {placementFootprint,spatialRegions} from './placement-groups.js';
import {chooseInstructionView} from './instruction-visibility.js';
import {readableMaterialRichCourse} from './material-rich-courses.js';

// Only an explicitly validated working frame can turn world-up placements
// into ordinary layer diagrams. Ordinary underside attachments stay separate.
export function orientedCourseRejections(steps,byId,{feature=false,allowMixedMaterials=false}={}) {
  const first=steps[0],orientation=first.workingOrientation,reasons=[];
  if(orientation?.kind!=='inverted'||!Number.isSafeInteger(orientation.surfaceY)
    ||steps.some(s=>JSON.stringify(s.workingOrientation)!==JSON.stringify(orientation)
      ||s.kind!=='build'||s.insertionDirection!=='up'||!s.newBrickIds.length))return ['working-orientation-boundary'];
  if(steps.some(s=>s.issues.some(i=>i.code!=='limited-support'||i.severity!=='warning')))reasons.push('reported-issue');
  const ids=steps.flatMap(s=>s.newBrickIds),bricks=ids.map(id=>byId.get(id)),shape=placementFootprint(bricks);
  const levels=new Set(bricks.map(b=>b.y)),height=Math.max(...levels)-Math.min(...levels)+1;
  if(new Set(ids).size!==ids.length||(!feature&&levels.size!==1))reasons.push('incomplete-course');
  if(feature&&(ids.length>24||height>4||shape.width>16||shape.depth>16||levels.size!==height))reasons.push('feature-complexity');
  if(ids.length>80||shape.width>24||shape.depth>24||shape.fill<.45||spatialRegions(bricks).length!==1
    ||new Set(bricks.map(b=>b.color)).size>3&&!(allowMixedMaterials&&readableMaterialRichCourse(bricks))
    ||new Set(bricks.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`)).size>8)reasons.push('course-complexity');
  if(!reasons.length){
    const visibleBricks=steps.at(-1).visibleBrickIds.map(id=>workingViewBrick(byId.get(id),orientation));
    const view=chooseInstructionView({visibleBricks,highlightedIds:ids});
    if(!view.passes||view.truncated||view.groups.some(g=>!g.visibleBrickCount))reasons.push('visibility');
  }
  return reasons;
}
