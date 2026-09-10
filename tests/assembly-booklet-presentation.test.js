import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createBookletPresentation,
  createChapterDiagramData,
  createFlatBookletPresentation,
  guideRangeMarkup,
  resolveBookletInitialState,
} from '../src/assembly-booklet-presentation.js';
import { bookletViewerOptions } from '../src/assembly-booklet-renderer.js';

function bookletFixture(groupSizes, { join = false, warningStep = -1 } = {}) {
  const bricks = [];
  const steps = [];
  const groups = [];
  let stepNumber = 0;
  for (const [groupIndex, groupSize] of groupSizes.entries()) {
    const stepIds = [];
    const brickIds = [];
    for (let index = 0; index < groupSize; index += 1) {
      const brickId = `brick-${stepNumber + 1}`;
      const stepId = `step-${stepNumber + 1}`;
      const issues = stepNumber === warningStep
        ? [{ code:'held', severity:'warning', message:'Keep this supported.', brickIds:[brickId] }]
        : [];
      bricks.push({ id:brickId, x:stepNumber, y:groupIndex, z:0, w:1, d:1, color:'red' });
      steps.push({
        id:stepId, moduleId:'module-1', kind:'build', newBrickIds:[brickId],
        visibleBrickIds:bricks.map(({ id }) => id), highlightBrickIds:[brickId], issues,
      });
      stepIds.push(stepId);
      brickIds.push(brickId);
      stepNumber += 1;
    }
    groups.push({
      id:`group-${groupIndex + 1}`, label:'Build this area', status:'ready',
      stepIds, brickIds, brickCount:brickIds.length, inventory:[],
    });
  }
  if (join) {
    const joinContext = { direction:'down', supportGroups:[{ id:'support-a' }] };
    steps.push({
      id:'join-step', moduleId:'module-1', kind:'join', newBrickIds:[],
      visibleBrickIds:bricks.map(({ id }) => id), highlightBrickIds:[],
      insertionDirection:'down', joinContext, issues:[],
    });
    groups.push({
      id:'join-group', label:'Attach', status:'ready', stepIds:['join-step'],
      brickIds:[], brickCount:0, inventory:[],
    });
  }
  const brickIds = bricks.map(({ id }) => id);
  const inventory = [{ key:'1x1:red', w:1, d:1, color:'red', count:bricks.length }];
  const plan = {
    version:1, bricks, steps, inventory, graph:{ edges:[] },
    modules:[{ id:'module-1', label:'Main assembly', brickIds, kind:'grounded', status:'ready', componentIds:['component-1'] }],
  };
  const guide = {
    version:1,
    sections:[{
      id:'section-1', label:'Body panels', semanticLabel:'Body panels', semanticConfidence:'high',
      status:'ready', moduleIds:['module-1'], stepIds:steps.map(({ id }) => id), brickIds,
      brickCount:brickIds.length, inventory, courseRange:{ min:0, max:groupSizes.length - 1 }, groups,
    }],
    stats:{ sectionCount:1, brickCount:bricks.length, coverageComplete:true },
  };
  return { assemblyPlan:plan, guide };
}

function oneGroupGuideSections(result, labels) {
  const source = result.guide.sections[0];
  const bricksById = new Map(result.assemblyPlan.bricks.map(brick => [brick.id, brick]));
  result.guide = {
    version: 1,
    sections: source.groups.map((group, index) => {
      const bricks = group.brickIds.map(brickId => bricksById.get(brickId));
      const label = labels[index];
      const moduleIds = [...new Set(group.stepIds.map(stepId =>
        result.assemblyPlan.steps.find(step => step.id === stepId).moduleId))];
      return {
        ...source,
        id: `section-${index + 1}`,
        label: label.text,
        semanticLabel: label.confidence === 'uncertain' ? null : label.text,
        semanticConfidence: label.confidence,
        semanticEvidence: `Evidence ${index + 1}`,
        moduleIds,
        stepIds: [...group.stepIds],
        brickIds: [...group.brickIds],
        brickCount: group.brickIds.length,
        inventory: [{ key:'1x1:red', w:1, d:1, color:'red', count:group.brickIds.length }],
        courseRange: { min:Math.min(...bricks.map(brick => brick.y)), max:Math.max(...bricks.map(brick => brick.y)) },
        groups: [{ ...group, id:`section-${index + 1}-group-1` }],
      };
    }),
    stats: { sectionCount:source.groups.length, brickCount:source.brickIds.length, coverageComplete:true },
  };
  return result;
}

test('chapter presentation preserves group order, source ids, warnings, and join context', () => {
  const joinContext = { direction: 'down', supportGroups: [{ id: 'support-a' }] };
  const plan = { steps: [
    { id:'step-a',kind:'place',visibleBrickIds:['a'],highlightBrickIds:['a'],insertionDirection:'down',issues:[] },
    { id:'step-b',kind:'join',visibleBrickIds:['a','b'],highlightBrickIds:['b'],insertionDirection:'down',joinContext,issues:[] },
    { id:'step-c',kind:'place',visibleBrickIds:['a','b','c'],highlightBrickIds:['c'],insertionDirection:'up',issues:[{message:'hold'}] },
  ] };
  const section = {
    groups:[{id:'group-1',stepIds:['step-a','step-b']},{id:'group-2',stepIds:['step-c']}],
    parts:[{id:'part-1',groupIds:['group-1']},{id:'part-2',groupIds:['group-2']}],
  };
  const numbering = { byStepId:new Map([['step-a',12],['step-b',13],['step-c',14]]), partRanges:new Map([['part-1',{start:12,end:13}],['part-2',{start:14,end:14}]]) };
  const result = createChapterDiagramData(section,plan,numbering);
  assert.deepEqual(result.specs.map(spec=>spec.stepId),['step-a','step-b','step-c']);
  assert.equal(result.specs[1].joinContext,joinContext);
  assert.equal(result.specs[2].unresolved,true);
  assert.deepEqual(result.parts.map(part=>part.figures.map(spec=>spec.stepId)),[['step-a','step-b'],['step-c']]);
  assert.deepEqual(result.parts.map(part=>part.range),[{start:12,end:13},{start:14,end:14}]);
  const visibleModel = { kind:'bricks', bricks:[] };
  const options = bookletViewerOptions(result.specs[1], visibleModel);
  assert.equal(options.joinContext, joinContext);
  assert.equal(options.frameModel, visibleModel);
  assert.deepEqual([...options.highlightIds], ['b']);
});

test('range markup keeps one number and isolates an escaped range dash', () => {
  assert.equal(guideRangeMarkup({start:7,end:7}),'7');
  assert.equal(guideRangeMarkup({start:'<12',end:'22&'}),'&lt;12<span class="manual-range-dash">–</span>22&amp;');
});

test('fresh readers open the first chapter while restored closed readers stay closed', () => {
  assert.deepEqual(resolveBookletInitialState(null, 4), { partsOpen:false, openChapterIndex:0 });
  assert.deepEqual(resolveBookletInitialState({ partsOpen:false, anchorStepId:'step-a' }, 4), { partsOpen:false, openChapterIndex:-1 });
  assert.deepEqual(resolveBookletInitialState({ partsOpen:true, openChapterIndex:2 }, 4), { partsOpen:true, openChapterIndex:2 });
});

test('a thirteen-diagram chapter stays one flat section', () => {
  const view = createBookletPresentation(bookletFixture([6, 6, 1]));

  assert.equal(view.rawPresentation.sections[0].parts.length, 2);
  assert.equal(view.presentation.sections.length, 1);
  assert.equal(view.presentation.sections[0].stepIds.length, 13);
  assert.equal(view.presentation.stats.splitSectionCount, 0);
  assert.deepEqual(view.numbering.sectionRanges.get('presentation-1'), { start:1, end:13 });
});

test('a long source chapter becomes inventory-accurate peer sections at coherent boundaries', () => {
  const result = bookletFixture([6, 6, 6, 1], { join:true, warningStep:13 });
  const view = createBookletPresentation(result);
  const sections = view.presentation.sections;
  const expectedStepIds = view.rawPresentation.sections[0].stepIds;

  assert.equal(view.rawPresentation.sections.length, 1);
  assert.deepEqual(sections.map(section => section.stepIds.length), [12, 8]);
  assert.deepEqual(sections.map(section => section.baseLabel), ['Body panels', 'Body panels']);
  assert.equal(sections[0].label, 'Body panels');
  assert.notEqual(sections[1].label, sections[0].label);
  assert.equal(new Set(sections.map(section => section.id)).size, 2);
  assert.deepEqual(sections.flatMap(section => section.stepIds), expectedStepIds);
  assert.deepEqual(sections.flatMap(section => section.brickIds), result.assemblyPlan.bricks.map(({ id }) => id));
  assert.deepEqual(sections.map(section => section.inventory.reduce((sum, entry) => sum + entry.count, 0)), [12, 7]);
  assert.deepEqual(sections.map(section => section.parts[0].stepRange), [
    { start:1, end:12 }, { start:1, end:8 },
  ]);
  assert.deepEqual(sections.map(section => view.numbering.sectionRanges.get(section.id)), [
    { start:1, end:12 }, { start:13, end:20 },
  ]);
  assert.deepEqual(view.presentation.sequence.map(entry => entry.sliceIndex), [0, 1]);
  assert.equal(view.presentation.stats.presentationSectionCount, 2);
  assert.equal(view.presentation.stats.sourcePresentationSectionCount, 1);
  assert.equal(view.presentation.stats.splitSectionCount, 1);
  assert.equal(view.presentation.stats.coverageComplete, true);

  const diagrams = sections.flatMap(section => createChapterDiagramData(section, view.plan, view.numbering).specs);
  assert.equal(diagrams.find(spec => spec.stepId === 'step-14').unresolved, true);
  assert.equal(diagrams.find(spec => spec.stepId === 'join-step').joinContext,
    result.assemblyPlan.steps.at(-1).joinContext);
});

test('a long source chapter absorbs a tiny final reading chunk without exceeding eighteen steps', () => {
  const result = bookletFixture([6, 6, 6, 6, 1]);
  const view = createBookletPresentation(result);

  assert.deepEqual(view.rawPresentation.sections[0].parts.map(part => part.stepIds.length), [12, 12, 1]);
  assert.deepEqual(view.presentation.sections.map(section => section.stepIds.length), [12, 13]);
  assert.equal(view.presentation.stats.shortSectionCount, 0);
  assert.equal(view.presentation.stats.maxStepsPerDisplaySection, 13);
  assert.deepEqual(
    view.presentation.sections.flatMap(section => section.stepIds),
    view.rawPresentation.sections[0].stepIds,
  );
});

test('compatible adjacent unnamed tiny sections combine and discard stale range evidence', () => {
  const result = oneGroupGuideSections(bookletFixture([1, 1, 1, 2]), Array.from({ length: 4 }, () => ({
    text: 'Finishing details', confidence: 'uncertain',
  })));
  const view = createBookletPresentation(result);
  const section = view.presentation.sections[0];

  assert.equal(view.rawPresentation.sections.length, 4);
  assert.equal(view.presentation.sections.length, 1);
  assert.equal(view.presentation.stats.mergedSectionCount, 3);
  assert.deepEqual(section.stepIds, result.assemblyPlan.steps.map(step => step.id));
  assert.deepEqual(section.groups.map(group => group.id), result.guide.sections.map(source => source.groups[0].id));
  assert.equal(section.semanticLabel, null);
  assert.equal(section.semanticConfidence, 'uncertain');
  assert.equal(section.semanticEvidence, '');
  assert.deepEqual(section.displayMerge.sourcePresentationSectionIds, [
    'presentation-1', 'presentation-2', 'presentation-3', 'presentation-4',
  ]);
  assert.equal(section.inventory.reduce((sum, entry) => sum + entry.count, 0), 5);
  assert.deepEqual(view.presentation.sequence.map(entry => entry.presentationSectionId), Array(4).fill(section.id));
});

test('short named assembly purposes remain separate truthful exceptions', () => {
  const result = oneGroupGuideSections(bookletFixture([1, 2]), [
    { text:'Tower cap', confidence:'inferred' },
    { text:'Roof', confidence:'high' },
  ]);
  const view = createBookletPresentation(result);

  assert.deepEqual(view.presentation.sections.map(section => section.stepIds.length), [1, 2]);
  assert.deepEqual(view.presentation.sections.map(section => section.label), ['Tower cap', 'Roof']);
  assert.deepEqual(view.presentation.stats.shortSectionReasons.map(entry => entry.reason), [
    'named assembly purpose', 'named assembly purpose',
  ]);
});

test('matching fallback wording alone does not merge spatially disconnected assemblies', () => {
  const result = bookletFixture([1, 1]);
  result.assemblyPlan.bricks[1].x = 100;
  result.assemblyPlan.modules.push({
    id:'module-2', label:'Separate build area', brickIds:['brick-2'], kind:'grounded', status:'ready', componentIds:['component-2'],
  });
  result.assemblyPlan.modules[0].brickIds = ['brick-1'];
  result.assemblyPlan.steps[1].moduleId = 'module-2';
  result.assemblyPlan.steps[1].insertionDirection = 'up';
  oneGroupGuideSections(result, [
    { text:'Finishing details', confidence:'uncertain' },
    { text:'Finishing details', confidence:'uncertain' },
  ]);
  const view = createBookletPresentation(result);

  assert.deepEqual(view.presentation.sections.map(section => section.stepIds.length), [1, 1]);
  assert.equal(view.presentation.stats.mergedSectionCount, 0);
});

test('a complete two-step guide stays unpadded and records its short-guide exception', () => {
  const view = createBookletPresentation(bookletFixture([2]));

  assert.deepEqual(view.presentation.sections.map(section => section.stepIds.length), [2]);
  assert.deepEqual(view.presentation.stats.shortSectionReasons.map(entry => entry.reason), ['complete guide']);
});

test('finishing wording runs after flat splitting so only the actual last range promises an ending', () => {
  const result = bookletFixture([6, 6, 6, 1]);
  result.guide.sections[0].semanticLabel = 'Finishing touches';
  const view = createBookletPresentation(result);
  assert.deepEqual(view.presentation.sections.map(section => section.label), [
    'Finishing touches', 'Finishing touches. For real.',
  ]);
  assert.deepEqual(view.presentation.sections.map(section => section.baseLabel), [
    'Finishing touches', 'Finishing touches',
  ]);
});

test('an open chapter follows its original step when background naming regroups the guide', () => {
  const sections = [
    { groups: [{ stepIds: ['step-1', 'step-2'] }] },
    { groups: [{ stepIds: ['step-3', 'step-4'] }] },
  ];
  assert.deepEqual(resolveBookletInitialState({ partsOpen: true, openChapterStepId: 'step-3' }, 2, sections), {
    partsOpen: true, openChapterIndex: 1,
  });
});

test('a long repeated recipe remains one flat section with all-instance placement data', () => {
  const result = bookletFixture([6, 6, 6, 1]);
  const rawSection = createBookletPresentation(result).rawPresentation.sections[0];
  const repeatedSection = {
    ...rawSection,
    repeatCount:2,
    sectionIds:['section-1', 'section-2'],
    instances:[
      { sectionId:'section-1', brickIds:[...rawSection.brickIds], transform:{ rotationQuarterTurns:0 } },
      { sectionId:'section-2', brickIds:rawSection.brickIds.map(id => `copy-${id}`), transform:{ rotationQuarterTurns:0 } },
    ],
    totalInventory:rawSection.totalInventory.map(entry => ({ ...entry, count:entry.count * 2 })),
  };
  const copyBricks = result.assemblyPlan.bricks.map(brick => ({ ...brick, id:`copy-${brick.id}`, x:brick.x + 30 }));
  const plan = { ...result.assemblyPlan, bricks:[...result.assemblyPlan.bricks, ...copyBricks] };
  const rawPresentation = {
    version:1, sections:[repeatedSection], sequence:[
      { sectionId:'section-1', presentationSectionId:rawSection.id, instanceIndex:0 },
      { sectionId:'section-2', presentationSectionId:rawSection.id, instanceIndex:1 },
    ], inventory:plan.inventory,
    stats:{ presentationSectionCount:1, representedInstanceCount:2, coverageComplete:true },
  };
  const presentation = createFlatBookletPresentation(rawPresentation, plan);

  assert.equal(presentation.sections.length, 1);
  assert.equal(presentation.sections[0].repeatCount, 2);
  assert.equal(presentation.sections[0].stepIds.length, 19);
  assert.equal(presentation.sections[0].parts.length, 2);
  assert.equal(presentation.sections[0].instances.flatMap(instance => instance.brickIds).length, 38);
  assert.equal(presentation.stats.splitSectionCount, 0);
  assert.equal(presentation.stats.coverageComplete, true);
});
