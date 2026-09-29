import {integrateSmallDetails} from './assembly-ownership.js';
import {actionReplay, annotateActions, assessActionSequence, actionCompletionRejections} from './assembly-actions.js';
import {proposeSharedRecipes, shareRecipeActions, recipeBrickId} from './assembly-recipes.js';
import {inspectConstruction} from './construction.js';
import {measureBrickDifference} from './construction-differences.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {createAssemblyPlan} from './assembly.js';
import {compactAssemblyPlan} from './assembly-diagrams.js';
import {createGuideSections} from './guide-sections.js';
import {assemblyRejectionReasons} from './refine-construction.js';
import {assessWorkSurfaceQuality} from './work-surface-quality.js';
import {completeBaseRegions} from './assembly-supports.js';

function descriptors(plan) {
  return plan.modules.map(module => ({id:module.id, label:module.label, kind:module.kind,
    groupType:module.groupType, ...(module.buildContext ? {buildContext:module.buildContext} : {}),
    brickIds:[...module.brickIds], brickOrder:plan.steps.filter(s => s.moduleId === module.id).flatMap(s => s.newBrickIds)}));
}

export function refineAssemblySequence(result, options={}) {
  result=integrateSmallDetails(result);
  if (!result.assemblyPlan || result.assemblyError || result.brickModel.bricks.length > 1000) return result;
  const started=performance.now(),before=result.assemblyPlan;
  const completed=completeBaseRegions(descriptors(before),before);
  const shared=proposeSharedRecipes(result.brickModel,completed.replay,{...options,repairCells:result.continuityRefinement?.supportCells??[]});
  const diagnostics=inspectConstruction(shared.brickModel);
  if(!diagnostics.checks.schema||!diagnostics.checks.legalFootprints||!diagnostics.checks.noCollisions) return result;
  const identified=shared.brickModel.bricks.map(b=>({...b,id:recipeBrickId(b)}));
  const byId=new Map(identified.map(b=>[b.id,b]));
  const attempts=[],candidates=[];
  const oldDiagrams=result.instructionPlan?.steps.length??before.steps.length;
  for(const axis of ['z','x']) for(const reverse of [false,true]) for(const width of [4,6]) {
    const variant={axis,reverse,width};
    try {
      const replay=shareRecipeActions(shared.replay.map(m=>actionReplay(m,m.brickIds.map(id=>byId.get(id)),variant)),identified);
      let plan=createAssemblyPlan({brickModel:shared.brickModel,moduleReplay:replay,integratedBuild:before.integratedBuild??false});
      plan=annotateActions(plan,replay);
      const reasons=[...assemblyRejectionReasons(before,plan),...actionCompletionRejections(plan)];
      const handling=assessWorkSurfaceQuality(plan).aggregate;
      if(handling.peakLooseBrickCount>6||handling.peakStepDetachedBrickCount>6) reasons.push('Foundation layout exceeds handling bound');
      if(plan.stats.upwardInsertionBrickCount>before.stats.upwardInsertionBrickCount) reasons.push('Upward insertion increased');
      if(reasons.length){attempts.push({...variant,rejectionReasons:reasons});continue;}
      const compacted=compactAssemblyPlan(plan),guide=createGuideSections(compacted.plan);
      if(!compacted.report.brickCoverageComplete||!compacted.report.sourceStepCoverageComplete) throw Error('Incomplete action coverage');
      const presentation=deriveGuidePresentation({plan:compacted.plan,guide});
      const quality=assessActionSequence(compacted.plan);
      const displayed=presentation.sections.reduce((n,s)=>n+s.stepIds.length,0);
      if(displayed>Math.ceil(oldDiagrams*1.25)) reasons.push('Instruction count would inflate');
      attempts.push({...variant,quality,displayed,handling,rejectionReasons:reasons});
      if(!reasons.length) candidates.push({variant,plan,compacted,guide,quality,displayed,handling});
    } catch(error){attempts.push({...variant,rejectionReasons:[error.message]});}
  }
  candidates.sort((a,b)=>a.quality.mixedCourseSteps-b.quality.mixedCourseSteps
    ||a.quality.singlePieceSteps-b.quality.singlePieceSteps||a.displayed-b.displayed
    ||a.handling.detachedBrickExposure-b.handling.detachedBrickExposure);
  const selected=candidates[0];
  if(!selected) return {...result,sequenceRefinement:{selected:false,attempts,geometryChanges:0}};
  const histogram={};for(const b of shared.brickModel.bricks){const k=`${Math.min(b.w,b.d)}x${Math.max(b.w,b.d)}`;histogram[k]=(histogram[k]??0)+1;}
  const changes=shared.changes.flatMap(c=>c.cells);
  return {...result,brickModel:shared.brickModel,diagnostics,assemblyPlan:selected.plan,
    instructionPlan:selected.compacted.plan,guide:selected.guide,
    assemblyEvaluation:{...result.assemblyEvaluation,compaction:selected.compacted.report},
    sequenceRefinement:{selected:true,policy:'assembly-actions',variant:selected.variant,attempts,
      completedBaseBricks:completed.moved,recipes:shared.families,cellChanges:shared.changes,
      geometryChanges:changes.filter(c=>c.before===null).length,colorChanges:changes.filter(c=>c.before!==null).length,
      handlingBefore:assessWorkSurfaceQuality(before).aggregate,handlingAfter:selected.handling},
    metrics:{...result.metrics,...(options.rawModel?measureBrickDifference(options.rawModel,shared.brickModel):{}),
      brickCount:shared.brickModel.bricks.length,partHistogram:histogram,
      structuralAddedMappedCellCount:(result.metrics.structuralAddedMappedCellCount??0)+changes.filter(c=>c.before===null).length,
      conversionMs:result.metrics.conversionMs+performance.now()-started}};
}
