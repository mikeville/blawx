import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertToBricks } from '../src/construction.js';
import { refineConstruction } from '../src/refine-construction.js';
import { prepareAssemblyGuide } from '../src/prepare-assembly-guide.js';
import { repairPreparedConstruction } from '../src/complete-construction.js';
import { planSubassemblies } from '../src/plan-subassemblies.js';
import { createBookletPresentation, createChapterDiagramData } from '../src/assembly-booklet-presentation.js';

test('booklet adapter preserves current saved construction guides', async () => {
  const index = JSON.parse(await readFile(new URL('../public/examples/index.json', import.meta.url)));
  const expectedShortCounts = new Map([[42, 0], [43, 0], [44, 4], [45, 0], [46, 0], [47, 1]]);
  for (let shape = 42; shape <= 47; shape += 1) {
    const record = index.find((entry) => entry.shape === shape);
    assert.ok(record, `Shape ${shape} is present`);
    const rawModel = JSON.parse(await readFile(new URL(`../public${record.url}`, import.meta.url)));
    const refined = refineConstruction(convertToBricks({ rawModel, adjustments: true }));
    const prepared = prepareAssemblyGuide(refined);
    const repaired = repairPreparedConstruction(prepared, { rawModel, allowExtensions: true });
    const result = planSubassemblies(repaired);
    const view = createBookletPresentation(result);
    const byStep = new Map(view.plan.steps.map(step => [step.id, step]));
    const rawDisplayedStepIds = view.rawPresentation.sections.flatMap(section => section.stepIds);
    const displayedStepIds = view.presentation.sections.flatMap(section => section.stepIds);
    const rawOperationIds = rawDisplayedStepIds.flatMap(stepId =>
      byStep.get(stepId).orderedOperations.map(operation => operation.id));
    const displayedOperationIds = displayedStepIds.flatMap(stepId =>
      byStep.get(stepId).orderedOperations.map(operation => operation.id));

    assert.equal(view.presentation.stats.coverageComplete, true, `Shape ${shape} coverage`);
    assert.equal(view.presentation.stats.shortSectionCount, expectedShortCounts.get(shape), `Shape ${shape} short sections`);
    assert.deepEqual(displayedStepIds, rawDisplayedStepIds, `Shape ${shape} displayed step order`);
    assert.deepEqual(displayedOperationIds, rawOperationIds, `Shape ${shape} source operation order`);
    assert.equal(
      view.presentation.sections.reduce((sum, section) =>
        sum + section.totalInventory.reduce((count, entry) => count + entry.count, 0), 0),
      view.plan.bricks.length,
      `Shape ${shape} inventory`,
    );
    for (const section of view.presentation.sections) {
      if (section.repeatCount === 1) {
        assert.equal(section.stepIds.length <= 18, true, `Shape ${shape} maximum ordinary section size`);
      }
      if (section.stepIds.length < 3) {
        const reason = view.presentation.stats.shortSectionReasons.find(entry => entry.sectionId === section.id)?.reason;
        assert.match(reason ?? '', /^(?:complete guide|named assembly purpose|attachment sequence|distinct assembly purpose)$/u);
      }
      const chapter = createChapterDiagramData(section, view.plan, view.numbering);
      assert.deepEqual(chapter.specs.map(spec => spec.stepId), section.groups.flatMap(group => group.stepIds));
      for (const spec of chapter.specs) {
        const step = byStep.get(spec.stepId);
        assert.deepEqual(spec.visible, step.visibleBrickIds);
        assert.deepEqual(spec.highlight, step.highlightBrickIds);
        assert.equal(spec.joinContext, step.kind === 'join' ? step.joinContext : null);
      }
      for (const part of chapter.parts) {
        if (part.id) assert.deepEqual(part.figures.map(spec => spec.stepId), part.stepIds);
      }
      if (section.repeatCount > 1) {
        const raw = view.rawPresentation.sections.find(candidate => candidate.id === section.id);
        assert.equal(section.repeatCount, raw.repeatCount, `Shape ${shape} repeat count`);
        assert.deepEqual(section.instances, raw.instances, `Shape ${shape} repeat instances`);
        assert.equal(section.instances.flatMap(instance => instance.brickIds).length > 0, true);
      }
    }
  }
});
