import {createAssemblyPlan} from './assembly.js';
import {prepareAssemblyGuide} from './prepare-assembly-guide.js';
import {deriveGuidePresentation} from './guide-presentation.js';
import {assemblyRejectionReasons} from './refine-construction.js';
import {assessAssemblyQuality,orderQualityRejections} from './assembly-quality.js';

// A few directly supported pieces usually belong to their parent task. A
// separate recipe is useful when it changes handling or teaches repetition;
// color alone is not a reason to build a tiny object and attach it later.
export function integrateSmallDetails(result) {
  const plan=result.assemblyPlan;
  if(!plan||!result.instructionPlan||result.assemblyError||plan.bricks.length>1000)return result;
  const byId=new Map(plan.bricks.map(b=>[b.id,b]));
  const owner=new Map(plan.modules.flatMap(m=>m.brickIds.map(id=>[id,m])));
  const repeated=new Set(deriveGuidePresentation({plan:result.instructionPlan,guide:result.guide}).sections
    .filter(s=>s.repeatCount>1).flatMap(s=>s.instances.flatMap(i=>i.brickIds)));
  const lower=new Map(plan.bricks.map(b=>[b.id,[]]));
  for(const {a,b} of plan.graph.edges){
    const first=byId.get(a),second=byId.get(b);
    const [below,above]=first.y<second.y?[first,second]:[second,first];
    lower.get(above.id).push(below.id);
  }
  const additions=new Map(),removed=new Set(),changes=[];
  for(const module of plan.modules){
    if(module.kind!=='detail'||module.buildContext||module.brickIds.length>4
      ||module.brickIds.some(id=>repeated.has(id))
      ||module.groupType&&module.groupType!=='color')continue;
    const internal=new Set(module.brickIds);
    const external=module.brickIds.flatMap(id=>lower.get(id)).filter(id=>!internal.has(id));
    const parents=new Set(external.map(id=>owner.get(id)));
    if(parents.size!==1)continue;
    const parent=[...parents][0];
    if((parent.kind!=='grounded'&&parent.buildContext?.kind!=='work-surface')
      ||parent.brickIds.some(id=>repeated.has(id)))continue;
    // Every seed must really sit on this parent; do not integrate floating
    // appendages merely because some other piece in their module has a bond.
    if(module.brickIds.some(id=>!lower.get(id).length))continue;
    const previous=additions.get(parent.id)??[];
    additions.set(parent.id,[...previous,...module.brickIds]);removed.add(module.id);
    changes.push({moduleId:module.id,parentId:parent.id,brickIds:[...module.brickIds]});
  }
  if(!changes.length)return result;
  const started=performance.now();
  const replay=plan.modules.filter(m=>!removed.has(m.id)).map(m=>{
    const brickIds=[...m.brickIds,...(additions.get(m.id)??[])];
    const owned=new Set(brickIds);
    const brickOrder=plan.steps.flatMap(s=>s.newBrickIds).filter(id=>owned.has(id));
    // Establish parent courses before batching. Appending the former detail
    // recipe at the end would reproduce a late return to its lower attachment.
    if(additions.has(m.id))brickOrder.sort((a,b)=>byId.get(a).y-byId.get(b).y);
    return {id:m.id,label:m.label,kind:m.kind,groupType:m.groupType,
      ...(m.buildContext?{buildContext:m.buildContext}:{}),brickIds,
      brickOrder};
  });
  let candidate,reasons=[];
  try{
    const next=createAssemblyPlan({brickModel:result.brickModel,moduleReplay:replay,
      preferLocalProgress:true,preferLocalFoundations:true,integratedBuild:plan.integratedBuild??false,
      allowUnderAttachments:plan.steps.some(s=>s.insertionDirection==='up'),
      allowWorkSurfaceUnderAttachments:plan.steps.some(s=>s.insertionDirection==='up'
        &&plan.modules.find(m=>m.id===s.moduleId)?.buildContext?.kind==='work-surface')});
    candidate=prepareAssemblyGuide({...result,assemblyPlan:next},{moduleReplay:replay});
    reasons.push(...assemblyRejectionReasons(plan,candidate.assemblyPlan),
      ...orderQualityRejections(assessAssemblyQuality(plan),assessAssemblyQuality(candidate.assemblyPlan)));
    if(candidate.assemblyPlan.stats.upwardInsertionBrickCount>plan.stats.upwardInsertionBrickCount)reasons.push('Upward insertions increased');
    if(!candidate.assemblyEvaluation.compaction.sourceStepCoverageComplete||!candidate.instructionPlan.stats.coverageComplete
      ||!candidate.guide.stats.coverageComplete)reasons.push('Incomplete coverage');
    if(candidate.instructionPlan.steps.length>result.instructionPlan.steps.length)reasons.push('Integrating details increased instruction count');
  }catch(error){reasons.push(error.message);}
  const report={selected:!reasons.length,changes,rejectionReasons:reasons,planningMs:performance.now()-started};
  return {...(reasons.length?result:candidate),detailOwnership:report,
    metrics:{...(reasons.length?result:candidate).metrics,conversionMs:result.metrics.conversionMs+report.planningMs}};
}
