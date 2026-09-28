import {spatialRegions, placementFootprint} from './placement-groups.js';
import {chooseInstructionView} from './instruction-visibility.js';
import {createAssemblyPlan} from './assembly.js';
import {annotateActions, actionCompletionRejections} from './assembly-actions.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {assemblyRejectionReasons} from './refine-construction.js';
import {consolidateSurfaceDiagrams} from './surface-diagrams.js';
import {partitionLayerRows} from './table-layer-recipes.js';

const overlap=(a,b)=>a.x<b.x+b.w&&b.x<a.x+a.w&&a.z<b.z+b.d&&b.z<a.z+a.d;
const cells=bricks=>bricks.flatMap(b=>Array.from({length:b.w*b.d},(_,i)=>({x:b.x+i%b.w,z:b.z+Math.floor(i/b.w),color:b.color})));
const signature=bricks=>{
  const p=placementFootprint(bricks);
  return bricks.map(b=>`${b.x-p.minX},${b.z-p.minZ}:${b.w},${b.d}:${b.color}`).sort().join('|');
};

// A complete striped cross-section has at most five straight, centered bands.
// This includes a small projecting trim band, but not arbitrary ragged patches.
function stripedSection(bricks) {
  const occupied=cells(bricks);
  return ['x','z'].some(axis=>{
    const other=axis==='x'?'z':'x',rows=new Map();
    for(const c of occupied){if(!rows.has(c[axis]))rows.set(c[axis],[]);rows.get(c[axis]).push(c);}
    const ordered=[...rows].sort((a,b)=>a[0]-b[0]);
    if(ordered.at(-1)[0]-ordered[0][0]+1!==ordered.length)return false;
    let center,previous,bands=0;
    for(const [,row]of ordered){
      const lo=Math.min(...row.map(c=>c[other])),hi=Math.max(...row.map(c=>c[other]));
      if(row.length!==hi-lo+1||new Set(row.map(c=>c.color)).size!==1)return false;
      if(center!==undefined&&center!==lo+hi)return false;
      center=lo+hi;
      const key=`${lo},${hi}:${row[0].color}`;
      if(key!==previous)bands++;
      previous=key;
    }
    return bands<=5;
  });
}

function repeatedPattern(bricks) {
  return ['x','z'].some(axis=>{
    const span=axis==='x'?'w':'d',ordered=[...bricks].sort((a,b)=>a[axis]-b[axis]),groups=[];
    let end=-Infinity;
    for(const b of ordered){
      if(b[axis]>end)groups.push([]);
      groups.at(-1).push(b);end=Math.max(end,b[axis]+b[span]);
    }
    if(groups.length<2||groups.length>6||groups.some(g=>signature(g)!==signature(groups[0])))return false;
    const starts=groups.map(g=>Math.min(...g.map(b=>b[axis]))),pitch=starts[1]-starts[0];
    return starts.every((s,i)=>s===starts[0]+i*pitch);
  });
}

// Dense elongated courses may have a stepped edge, but every cross-section
// must be continuous. This excludes scattered islands and holes in a slab.
function continuousProfile(bricks) {
  const occupied=cells(bricks);
  return ['x','z'].some(axis=>{
    const other=axis==='x'?'z':'x',rows=new Map();
    for(const c of occupied){if(!rows.has(c[axis]))rows.set(c[axis],[]);rows.get(c[axis]).push(c[other]);}
    const keys=[...rows.keys()];
    return Math.max(...keys)-Math.min(...keys)+1===keys.length
      &&[...rows.values()].every(row=>new Set(row).size===Math.max(...row)-Math.min(...row)+1);
  });
}

function featureKind(bricks, {completeArea = false, elongatedProfile = false, coloredPanels = false} = {}) {
  const p=placementFootprint(bricks),colors=new Set(bricks.map(b=>b.color));
  if(bricks.length>36||Math.min(p.width,p.depth)>12||Math.max(p.width,p.depth)>24
    ||bricks.reduce((n,b)=>n+b.w*b.d,0)>384||colors.size>3)return null;
  if(new Set(bricks.map(b=>`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}:${b.color}`)).size>6)return null;
  if(colors.size===1&&p.fill===1)return 'panel';
  if(elongatedProfile&&colors.size===1&&bricks.length<=24&&Math.min(p.width,p.depth)<=6&&p.fill>=0.75
    &&spatialRegions(bricks).length===1&&continuousProfile(bricks))return 'profile';
  if(bricks.length<=24&&repeatedPattern(bricks))return 'pattern';
  if(bricks.length<=18&&stripedSection(bricks))return 'cross-section';
  // Color changes alone need not split a complete rectangle. This broader
  // candidate competes only when it reduces the number of complete tasks.
  if(coloredPanels&&colors.size<=3&&bricks.length<=24&&p.fill===1)return 'panel';
  // A complete, bounded monochrome contour is useful even when it encloses air.
  const contourPieces=completeArea?24:12,contourSpan=completeArea?16:12;
  if(colors.size===1&&bricks.length<=contourPieces&&p.width<=contourSpan&&p.depth<=contourSpan&&spatialRegions(bricks).length===1)return 'contour';
  return null;
}

// Recognition alone does not establish support. Ground-layout and supported
// placement callers must validate their own construction context.
export function recognizeCourseFeature(bricks, options) {
  return bricks.length ? featureKind(bricks, options) : null;
}

function independentlyPlaceable(bricks,prior) {
  return bricks.every(b=>prior.some(p=>p.y===b.y-1&&overlap(p,b))
    &&!prior.some(p=>p.y>b.y&&overlap(p,b)));
}
function visibleTogether(bricks,scene) {
  const view=chooseInstructionView({visibleBricks:scene,highlightedIds:bricks.map(b=>b.id)});
  return view.passes&&!view.truncated&&view.groups.every(g=>g.visibleBrickCount>0);
}

// Existing pieces may join separated additions into one completed surface.
// Restrict context to whole same-course/color bricks inside the additions'
// bounds; distant structure must not turn unrelated patches into one task.
function completesContextualPanel(bricks,prior) {
  if(bricks.length>24||new Set(bricks.map(b=>b.y)).size!==1||new Set(bricks.map(b=>b.color)).size!==1)return false;
  const p=placementFootprint(bricks);
  if(Math.min(p.width,p.depth)>12||Math.max(p.width,p.depth)>24)return false;
  const context=prior.filter(b=>b.y===bricks[0].y&&b.color===bricks[0].color
    &&b.x>=p.minX&&b.x+b.w<=p.maxX&&b.z>=p.minZ&&b.z+b.d<=p.maxZ);
  return context.length>0&&placementFootprint([...bricks,...context]).fill===1;
}

/** Choose a complete partition before placing anything; never leave a greedy tail. */
function partitionCourseFeatures(bricks,prior,options) {
  if(!bricks.length||bricks.length>96||new Set(bricks.map(b=>b.y)).size!==1
    ||!independentlyPlaceable(bricks,prior))return null;
  const regions=[...new Set(bricks.map(b=>b.color))].flatMap(color=>spatialRegions(bricks.filter(b=>b.color===color)));
  const atoms=regions.flatMap(region=>options?.splitLargeAreas&&!featureKind(region,options)
    ?partitionLayerRows(region,{acceptGroup:group=>Boolean(featureKind(group,options))})??[region]:[region]);
  if(atoms.length>24)return null;
  const candidates=new Map(),scene=[...prior,...bricks];
  function add(indices){
    const mask=indices.reduce((n,i)=>n|2**i,0);if(candidates.has(mask))return;
    const items=indices.flatMap(i=>atoms[i]),kind=featureKind(items,options)
      ??(options?.contextualPanels&&completesContextualPanel(items,prior)?'panel-completion':null);
    if(kind)candidates.set(mask,{mask,kind,bricks:items});
  }
  for(let i=0;i<atoms.length;i++){
    add([i]);
    for(let j=i+1;j<atoms.length;j++){
      add([i,j]);
      for(let k=j+1;k<atoms.length;k++)add([i,j,k]);
    }
  }
  add(atoms.map((_,i)=>i));
  // Small isolated islands may form a repeated layout across several colors.
  const small=atoms.flatMap((a,i)=>a.length<=2&&a.reduce((n,b)=>n+b.w*b.d,0)<=4?[i]:[]);
  if(small.length)add(small);
  const full=2**atoms.length-1,memo=new Map();let visits=0;
  function solve(remaining){
    if(!remaining)return [];
    if(memo.has(remaining))return memo.get(remaining);
    if(++visits>4096)return null;
    const first=remaining&-remaining;
    const options=[...candidates.values()].filter(c=>(c.mask&first)&&(c.mask&remaining)===c.mask)
      .sort((a,b)=>b.bricks.length-a.bricks.length);
    let best=null;
    for(const c of options){
      const tail=solve(remaining^c.mask);if(!tail)continue;
      const choice=[c,...tail];
      if(!best||choice.length<best.length)best=choice;
    }
    memo.set(remaining,best);return best;
  }
  // Visibility is expensive. Only check selected partitions; remove a failing
  // candidate and solve again instead of accepting an obscured complete shape.
  for(let attempt=0;attempt<8;attempt++){
    memo.clear();visits=0;const groups=solve(full);if(!groups)return null;
    const failed=groups.find(g=>!visibleTogether(g.bricks,scene));
    if(!failed)return groups.map(g=>({kind:g.kind,brickIds:g.bricks.map(b=>b.id)}));
    candidates.delete(failed.mask);
  }
  return null;
}

export function proposeCourseFeatures(bricks,prior,options) {
  const standard=partitionCourseFeatures(bricks,prior,options);
  if(options?.coloredPanels===false)return standard;
  const extended=partitionCourseFeatures(bricks,prior,{...options,coloredPanels:true});
  // Preserve established contours, stripes and repeated layouts on ties. A
  // generic rectangle must not replace equally concise, more specific tasks.
  const whole=extended&&(!standard||extended.length<standard.length)?extended:standard;
  // Preserve complete recognized features. If a connected area is too large
  // for one action, choose its entire strip partition before placing anything.
  return whole??partitionCourseFeatures(bricks,prior,{...options,coloredPanels:true,
    completeArea:true,elongatedProfile:true,splitLargeAreas:true});
}

function eligible(step,byId){
  return step.kind==='build'&&!step.issues.length&&step.newBrickIds.length
    &&(step.insertionDirection??'down')==='down'
    &&(!step.instructionAction||['course','surface'].includes(step.instructionAction.kind))
    &&!step.tableRecipe&&!step.placementTask&&!step.buildRegion
    &&step.highlightBrickIds.length===step.newBrickIds.length
    &&step.highlightBrickIds.every(id=>step.newBrickIds.includes(id))
    &&new Set(step.newBrickIds.map(id=>byId.get(id).y)).size===1;
}
function partitionCuts(groups,bricks){
  const owner=new Map(groups.flatMap((g,i)=>g.flatMap(id=>[[id,i]])));
  const regions=[...new Set(bricks.map(b=>b.color))].flatMap(c=>spatialRegions(bricks.filter(b=>b.color===c)));
  return regions.reduce((n,r)=>n+new Set(r.map(b=>owner.get(b.id))).size-1,0);
}
function stepStats(plan,steps){
  return {...plan,steps,stats:{...plan.stats,stepCount:steps.length,maxBricksPerStep:Math.max(...steps.map(s=>s.newBrickIds.length)),
    planReferenceCount:steps.reduce((n,s)=>n+s.newBrickIds.length+s.highlightBrickIds.length+s.visibleBrickIds.length,0)}};
}

function combineFeatureDiagrams(plan){
  const byId=new Map(plan.bricks.map(b=>[b.id,b])),steps=[];
  for(let i=0;i<plan.steps.length;){
    const first=plan.steps[i],group=[first];let end=i+1;
    if(first.instructionAction?.kind==='feature'){
      while(end<plan.steps.length&&plan.steps[end].instructionAction?.id===first.instructionAction.id)group.push(plan.steps[end++]);
      const ids=group.flatMap(s=>s.newBrickIds),bricks=ids.map(id=>byId.get(id));
      const newIds=new Set(ids),prior=first.visibleBrickIds.filter(id=>!newIds.has(id)).map(id=>byId.get(id));
      if(group.some(s=>s.kind!=='build'||s.issues.length||(s.insertionDirection??'down')!=='down')
        ||!featureKind(bricks,{coloredPanels:true,completeArea:true,elongatedProfile:true})||!independentlyPlaceable(bricks,prior)
        ||!visibleTogether(bricks,group.at(-1).visibleBrickIds.map(id=>byId.get(id))))throw Error('Feature replay did not produce a readable independent action');
      steps.push({...group.at(-1),label:`${first.label.split(' · add ')[0]} · add ${ids.length} bricks`,newBrickIds:ids,highlightBrickIds:[...ids],
        sourceStepIds:group.flatMap(s=>s.sourceStepIds),orderedOperations:group.flatMap(s=>s.orderedOperations)});
    }else steps.push(first);
    i=end;
  }
  return stepStats(plan,steps.map((s,i)=>({...s,id:`instruction-step-${i+1}`})));
}

// Rebuilding the canonical plan must not erase already-validated diagrams in
// other areas. Reuse a diagram only when its literal operations and complete
// visible scene still match a consecutive range in the new plan.
function retainUnchangedDiagrams(before,after,changes){
  const changed=new Set(changes.flatMap(c=>c.sourceIds));
  const payload=s=>JSON.stringify([s.moduleId,s.kind,s.newBrickIds,s.highlightBrickIds,s.issues,s.joinContext,s.insertionDirection??'down']);
  const oldSources=new Map(before.assemblyPlan.steps.map(s=>[s.id,s]));
  const options=new Map(before.instructionPlan.steps.filter(s=>s.sourceStepIds.every(id=>!changed.has(id)))
    .map(s=>[payload(oldSources.get(s.sourceStepIds[0])),s]));
  const canonical=after.assemblyPlan.steps,output=[];
  const proposed=new Map(after.instructionPlan.steps.map(s=>[s.sourceStepIds[0],s]));
  for(let i=0;i<canonical.length;){
    const old=options.get(payload(canonical[i])),sources=old&&canonical.slice(i,i+old.sourceStepIds.length);
    if(old&&sources.length===old.sourceStepIds.length
      &&sources.every((s,j)=>payload(s)===payload(oldSources.get(old.sourceStepIds[j])))
      &&JSON.stringify([...sources.at(-1).visibleBrickIds].sort())===JSON.stringify([...old.visibleBrickIds].sort())){
      output.push({...old,visibleBrickIds:sources.at(-1).visibleBrickIds,sourceStepIds:sources.map(s=>s.id),
        orderedOperations:old.orderedOperations.map((operation,j)=>({...operation,id:sources[j].id}))});
      i+=sources.length;
    }else{
      const diagram=proposed.get(canonical[i].id);
      if(!diagram)throw Error('Cannot preserve existing diagram boundary');
      output.push(diagram);i+=diagram.sourceStepIds.length;
    }
  }
  const instructionPlan=stepStats(after.instructionPlan,output.map((s,i)=>({...s,id:`instruction-step-${i+1}`})));
  return {...after,instructionPlan,guide:createGuideSections(instructionPlan)};
}

export function refineCourseFeatures(result){
  if(!result.instructionPlan||result.assemblyError||result.brickModel.bricks.length>1000)return result;
  const before=result.assemblyPlan,byId=new Map(before.bricks.map(b=>[b.id,b]));
  const modules=new Map(before.modules.map(m=>[m.id,m])),changes=[];
  const repeatedIds=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const repeatedModules=new Set(before.modules.filter(m=>m.brickIds.some(id=>repeatedIds.has(id))).map(m=>m.id));
  const steps=result.instructionPlan.steps;
  for(let i=0;i<steps.length;){
    const first=steps[i],module=modules.get(first.moduleId);let end=i+1;
    // Offline assemblies and validated repeated components retain their established recipes.
    if(!module.buildContext&&!repeatedModules.has(module.id)&&eligible(first,byId)){
      const y=byId.get(first.newBrickIds[0]).y;
      while(end<steps.length&&steps[end].moduleId===first.moduleId&&eligible(steps[end],byId)
        &&byId.get(steps[end].newBrickIds[0]).y===y)end++;
      if(end-i>1){
        const run=steps.slice(i,end),bricks=run.flatMap(s=>s.newBrickIds.map(id=>byId.get(id))),ids=new Set(bricks.map(b=>b.id));
        const prior=first.visibleBrickIds.filter(id=>!ids.has(id)).map(id=>byId.get(id));
        const features=proposeCourseFeatures(bricks,prior);
        const cuts=partitionCuts(run.map(s=>s.newBrickIds),bricks);
        if(features&&features.length<=run.length&&(features.length<run.length||cuts>0)){
          // Preserve the existing general travel direction, but complete each feature.
          const rank=new Map(bricks.map((b,j)=>[b.id,j]));
          features.sort((a,b)=>Math.min(...a.brickIds.map(id=>rank.get(id)))-Math.min(...b.brickIds.map(id=>rank.get(id))));
          changes.push({moduleId:module.id,course:y,oldDiagrams:run.length,newDiagrams:features.length,cuts,
            sourceIds:run.flatMap(s=>s.sourceStepIds),features});
        }
      }
    }
    i=end;
  }
  if(!changes.length)return result;
  try{
    const replay=before.modules.map(module=>{
      const source=before.steps.filter(s=>s.moduleId===module.id&&s.newBrickIds.length),actions=[];
      for(let i=0;i<source.length;){
        const change=changes.find(c=>c.moduleId===module.id&&c.sourceIds[0]===source[i].id);
        if(change){
          if(source.slice(i,i+change.sourceIds.length).some((s,j)=>s.id!==change.sourceIds[j]))throw Error('Feature source operations are not consecutive');
          actions.push(...change.features.map(f=>({kind:'feature',brickIds:f.brickIds,destination:{kind:f.kind,course:change.course}})));
          i+=change.sourceIds.length;
        }else{
          const s=source[i++],previous=actions.at(-1),originalAction=s.instructionAction?.id;
          if(originalAction&&previous?.originalAction===originalAction)previous.brickIds.push(...s.newBrickIds);
          else actions.push({kind:s.instructionAction?.kind,brickIds:[...s.newBrickIds],originalAction,
            ...(s.instructionAction?.destination?{destination:s.instructionAction.destination}:{})});
        }
      }
      return {...module,actions,actionOrder:true,placementGroups:actions.map(a=>a.brickIds),brickOrder:actions.flatMap(a=>a.brickIds)};
    });
    // A replay descriptor also carries ordinary source operations. They are not
    // new task boundaries: annotating every one as a separate course prevents
    // compaction elsewhere in the guide and undoes already-readable diagrams.
    const annotated=annotateActions(createAssemblyPlan({brickModel:result.brickModel,moduleReplay:replay,integratedBuild:before.integratedBuild??false}),replay);
    const plan={...annotated,steps:annotated.steps.map(step=>{
      if(!step.instructionAction||step.instructionAction.kind)return step;
      const {instructionAction,...ordinary}=step;return ordinary;
    })};
    const reasons=[...assemblyRejectionReasons(before,plan),...actionCompletionRejections(plan)];
    if(plan.stats.upwardInsertionBrickCount>before.stats.upwardInsertionBrickCount)reasons.push('Upward insertion increased');
    for(const m of before.modules.filter(m=>!changes.some(c=>c.moduleId===m.id))){
      const signature=p=>JSON.stringify(p.steps.filter(s=>s.moduleId===m.id).map(s=>[s.kind,s.newBrickIds,s.issues,s.joinContext]));
      if(signature(before)!==signature(plan))reasons.push('Another assembly changed');
    }
    if(reasons.length)throw Error(reasons.join('; '));
    const compacted=compactAssemblyPlan(plan),instructionPlan=combineFeatureDiagrams(compacted.plan);
    const expected=plan.steps.map(s=>s.id),actual=instructionPlan.steps.flatMap(s=>s.sourceStepIds);
    if(JSON.stringify(expected)!==JSON.stringify(actual))throw Error('Feature source coverage changed');
    let candidate=consolidateSurfaceDiagrams({...result,assemblyPlan:plan,instructionPlan,guide:createGuideSections(instructionPlan),
      assemblyEvaluation:{...result.assemblyEvaluation,compaction:compacted.report}});
    if(candidate.instructionPlan.steps.length>result.instructionPlan.steps.length)candidate=retainUnchangedDiagrams(result,candidate,changes);
    if(candidate.instructionPlan.steps.length>result.instructionPlan.steps.length)throw Error(`Feature partition increases diagrams (${result.instructionPlan.steps.length} to ${candidate.instructionPlan.steps.length})`);
    if(JSON.stringify(expected)!==JSON.stringify(candidate.instructionPlan.steps.flatMap(s=>s.sourceStepIds)))throw Error('Retained diagram source coverage changed');
    candidate={...candidate,assemblyEvaluation:{...candidate.assemblyEvaluation,compaction:{...candidate.assemblyEvaluation.compaction,
      instructionDiagramCount:candidate.instructionPlan.steps.length,collapsedStepCount:plan.steps.length-candidate.instructionPlan.steps.length,
      mergedDiagramCount:candidate.instructionPlan.steps.filter(s=>s.sourceStepIds.length>1).length}},
      featureRefinement:{selected:true,changes}};
    return candidate;
  }catch(error){return {...result,featureRefinement:{selected:false,rejectionReasons:[error.message],changes}};}
}
