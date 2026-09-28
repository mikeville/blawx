import {chooseInstructionView} from './instruction-visibility.js';
import {createGuideSections} from './guide-sections.js';

const overlaps=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const cellKey=(x,z)=>`${x},${z}`;

function isCourseAddition(step) {
  return step.kind==='build'&&step.newBrickIds.length>0&&!step.issues.length
    &&(step.insertionDirection??'down')==='down'&&step.instructionAction?.kind==='course'
    &&step.highlightBrickIds.length===step.newBrickIds.length
    &&step.highlightBrickIds.every(id=>step.newBrickIds.includes(id));
}

// A large exposed rectangle can be understood as one placement task. Prove that
// every brick rests on the pre-step model, rather than hiding new dependencies
// inside a larger picture. Irregular, mixed-color, and multi-course work retains
// its original diagrams.
function isReadableSurface(steps, byId) {
  const bricks=steps.flatMap(s=>s.newBrickIds.map(id=>byId.get(id)));
  if(bricks.length>48||new Set(bricks.map(b=>b.y)).size!==1||new Set(bricks.map(b=>b.color)).size!==1)return false;
  const minX=Math.min(...bricks.map(b=>b.x)),maxX=Math.max(...bricks.map(b=>b.x+b.w));
  const minZ=Math.min(...bricks.map(b=>b.z)),maxZ=Math.max(...bricks.map(b=>b.z+b.d));
  const width=maxX-minX,depth=maxZ-minZ,area=bricks.reduce((n,b)=>n+b.w*b.d,0);
  if(Math.min(width,depth)>12||Math.max(width,depth)>24||area>384||area!==width*depth)return false;
  const types=new Set(bricks.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`));
  if(types.size>4)return false;
  const newIds=new Set(bricks.map(b=>b.id));
  const prior=steps[0].visibleBrickIds.filter(id=>!newIds.has(id)).map(id=>byId.get(id));
  const support=new Set();
  for(const b of prior.filter(b=>b.y===bricks[0].y-1)) {
    for(let x=b.x;x<b.x+b.w;x++)for(let z=b.z;z<b.z+b.d;z++)support.add(cellKey(x,z));
  }
  for(const b of bricks) {
    for(let x=b.x;x<b.x+b.w;x++)for(let z=b.z;z<b.z+b.d;z++)if(!support.has(cellKey(x,z)))return false;
    if(prior.some(p=>p.y>b.y&&overlaps(p,b)))return false;
  }
  const view=chooseInstructionView({visibleBricks:steps.at(-1).visibleBrickIds.map(id=>byId.get(id)),highlightedIds:[...newIds]});
  return view.passes&&!view.truncated&&view.groups.every(g=>g.visibleBrickCount>0);
}

function mergedSurface(steps) {
  const first=steps[0],last=steps.at(-1),ids=steps.flatMap(s=>s.newBrickIds);
  const label=first.label.split(' · add ')[0];
  return {...structuredClone(last),label:`${label} · add ${ids.length} bricks`,newBrickIds:ids,highlightBrickIds:[...ids],
    sourceStepIds:steps.flatMap(s=>s.sourceStepIds),orderedOperations:structuredClone(steps.flatMap(s=>s.orderedOperations)),
    instructionAction:{id:`${first.moduleId}-surface-${first.id}`,kind:'surface'}};
}

/** Consolidate clear flat placement tasks without changing any construction operation. */
export function consolidateSurfaceDiagrams(result) {
  const plan=result.instructionPlan;
  if(!plan?.steps||result.assemblyError)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),groups=[];
  for(let start=0;start<plan.steps.length;) {
    const first=plan.steps[start];let end=start+1;
    if(isCourseAddition(first)) {
      // Evaluate complete endpoints, not only each greedy prefix. An intermediate
      // source batch may have a ragged edge that later batches finish naturally.
      for(let probe=start+1;probe<Math.min(plan.steps.length,start+16);probe++) {
        const next=plan.steps[probe];
        if(next.moduleId!==first.moduleId||!isCourseAddition(next))break;
        const candidate=plan.steps.slice(start,probe+1);
        const additions=candidate.flatMap(s=>s.newBrickIds.map(id=>byId.get(id)));
        if(additions.length>48||new Set(additions.map(b=>b.y)).size!==1||new Set(additions.map(b=>b.color)).size!==1)break;
        if(isReadableSurface(candidate,byId))end=probe+1;
      }
    }
    groups.push(plan.steps.slice(start,end));start=end;
  }
  const merged=groups.filter(g=>g.length>1);
  if(!merged.length)return result;
  const steps=groups.map((g,i)=>({...(g.length===1?g[0]:mergedSurface(g)),id:`instruction-step-${i+1}`}));
  const sources=steps.flatMap(s=>s.sourceStepIds),originalSources=plan.steps.flatMap(s=>s.sourceStepIds);
  const ids=steps.flatMap(s=>s.newBrickIds),originalIds=plan.steps.flatMap(s=>s.newBrickIds);
  if(JSON.stringify(sources)!==JSON.stringify(originalSources)||JSON.stringify(ids)!==JSON.stringify(originalIds)) {
    throw Error('Surface consolidation changed construction coverage or order');
  }
  const instructionPlan={...plan,steps,stats:{...plan.stats,stepCount:steps.length,
    maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
  const report={beforeDiagrams:plan.steps.length,afterDiagrams:steps.length,
    groups:merged.map(g=>({sourceDiagramIds:g.map(s=>s.id),newBrickIds:g.flatMap(s=>s.newBrickIds)}))};
  const compaction=result.assemblyEvaluation?.compaction;
  return {...result,instructionPlan,guide:createGuideSections(instructionPlan),surfaceConsolidation:report,
    ...(compaction?{assemblyEvaluation:{...result.assemblyEvaluation,compaction:{...compaction,
      instructionDiagramCount:steps.length,collapsedStepCount:compaction.sourceStepCount-steps.length,
      mergedDiagramCount:steps.filter(s=>s.sourceStepIds.length>1).length,surfaceConsolidation:report}}}:{})};
}
